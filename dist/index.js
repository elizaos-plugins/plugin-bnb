// src/actions/swap.ts
import {
  composeContext,
  elizaLogger as elizaLogger2,
  generateObjectDeprecated,
  ModelClass
} from "@elizaos/core";
import { executeRoute, getRoutes } from "@lifi/sdk";
import { parseEther } from "viem";

// src/providers/wallet.ts
import { EVM, createConfig, getToken } from "@lifi/sdk";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  erc20Abi
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as viemChains from "viem/chains";
import { createWeb3Name } from "@web3-name-sdk/core";
import { elizaLogger } from "@elizaos/core";
var WalletProvider = class _WalletProvider {
  currentChain = "bsc";
  chains = { bsc: viemChains.bsc };
  account;
  constructor(privateKey, chains) {
    this.setAccount(privateKey);
    this.setChains(chains);
    if (chains && Object.keys(chains).length > 0) {
      this.setCurrentChain(Object.keys(chains)[0]);
    }
  }
  getAccount() {
    return this.account;
  }
  getAddress() {
    return this.account.address;
  }
  getCurrentChain() {
    return this.chains[this.currentChain];
  }
  getPublicClient(chainName) {
    const transport = this.createHttpTransport(chainName);
    const publicClient = createPublicClient({
      chain: this.chains[chainName],
      transport
    });
    return publicClient;
  }
  getWalletClient(chainName) {
    const transport = this.createHttpTransport(chainName);
    const walletClient = createWalletClient({
      chain: this.chains[chainName],
      transport,
      account: this.account
    });
    return walletClient;
  }
  getChainConfigs(chainName) {
    const chain = viemChains[chainName];
    if (!chain?.id) {
      throw new Error("Invalid chain name");
    }
    return chain;
  }
  configureLiFiSdk(chainName) {
    const chains = Object.values(this.chains);
    const walletClient = this.getWalletClient(chainName);
    createConfig({
      integrator: "eliza",
      providers: [
        EVM({
          getWalletClient: async () => walletClient,
          switchChain: async (chainId) => createWalletClient({
            account: this.account,
            chain: chains.find(
              (chain) => chain.id === chainId
            ),
            transport: http()
          })
        })
      ]
    });
  }
  async formatAddress(address) {
    if (address === null || address === void 0) {
      elizaLogger.debug("Address is null or undefined, using wallet's own address");
      return this.getAddress();
    }
    if (typeof address === "string" && address.trim().length === 0) {
      elizaLogger.debug("Address is empty string, using wallet's own address");
      return this.getAddress();
    }
    const addressStr = String(address).trim();
    if (addressStr.startsWith("0x") && addressStr.length === 42) {
      elizaLogger.debug(`Using valid hex address: ${addressStr}`);
      return addressStr;
    }
    const commonTokens = ["USDT", "USDC", "BNB", "ETC", "WETC", "BUSD", "WBNB", "TRON", "LINK", "OM", "UNI", "PEPE", "AAVE", "ATOM"];
    if (commonTokens.includes(addressStr.toUpperCase())) {
      elizaLogger.debug(`Value appears to be a token symbol, not an address: ${addressStr}. Using wallet's own address.`);
      return this.getAddress();
    }
    try {
      elizaLogger.debug(`Attempting to resolve as Web3Name: ${addressStr}`);
      const resolvedAddress = await this.resolveWeb3Name(addressStr);
      if (resolvedAddress) {
        elizaLogger.debug(`Resolved Web3Name to address: ${resolvedAddress}`);
        return resolvedAddress;
      }
    } catch (error) {
      elizaLogger.debug(`Failed to resolve Web3Name '${addressStr}': ${error.message}. Will try other methods.`);
    }
    if (addressStr.startsWith("0x")) {
      elizaLogger.debug(`Address "${addressStr}" doesn't look like a standard Ethereum address but will be used as is`);
      return addressStr;
    }
    elizaLogger.debug(`Could not resolve address '${addressStr}'. Using wallet's own address.`);
    return this.getAddress();
  }
  async resolveWeb3Name(name) {
    if (name === null || name === void 0 || name === "null") {
      elizaLogger.debug(`Web3Name resolution skipped for null/undefined value`);
      return null;
    }
    const nameStr = String(name).trim();
    if (nameStr.length === 0) {
      elizaLogger.debug(`Web3Name resolution skipped for empty string`);
      return null;
    }
    if (nameStr.startsWith("0x") && nameStr.length === 42) {
      elizaLogger.debug(`Value is already a valid address: ${nameStr}`);
      return nameStr;
    }
    const commonTokens = ["USDT", "USDC", "BNB", "ETH", "BTC", "BUSD", "DAI", "WETC", "WBNB", "TRON", "LINK", "OM", "UNI", "PEPE", "AAVE", "ATOM"];
    if (commonTokens.includes(nameStr.toUpperCase())) {
      elizaLogger.debug(`Skipping Web3Name resolution for common token: ${nameStr}`);
      return null;
    }
    try {
      const chain = this.getCurrentChain();
      const rpcUrl = chain.rpcUrls.custom?.http[0] || chain.rpcUrls.default.http[0];
      elizaLogger.debug(`Resolving Web3Name: ${nameStr} using chain ${chain.name} and RPC: ${rpcUrl}`);
      const nameService = createWeb3Name({
        rpcUrl
      });
      const result = await Promise.race([
        nameService.getAddress(nameStr),
        new Promise(
          (resolve) => setTimeout(() => {
            elizaLogger.debug(`Web3Name resolution timeout for ${nameStr}`);
            resolve(null);
          }, 5e3)
          // 5 second timeout
        )
      ]);
      if (result) {
        elizaLogger.debug(`Web3Name resolved: ${nameStr} \u2192 ${result}`);
        return result;
      } else {
        elizaLogger.debug(`Web3Name not resolved: ${nameStr}`);
        return null;
      }
    } catch (error) {
      elizaLogger.debug(`Error resolving Web3Name ${nameStr}: ${error.message}`);
      return null;
    }
  }
  async checkERC20Allowance(chain, token, owner, spender) {
    const publicClient = this.getPublicClient(chain);
    return await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, spender]
    });
  }
  async approveERC20(chain, token, spender, amount) {
    const publicClient = this.getPublicClient(chain);
    const walletClient = this.getWalletClient(chain);
    const { request } = await publicClient.simulateContract({
      account: this.account,
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, amount]
    });
    return await walletClient.writeContract(request);
  }
  async transfer(chain, toAddress, amount, options) {
    const walletClient = this.getWalletClient(chain);
    return await walletClient.sendTransaction({
      account: this.account,
      to: toAddress,
      value: amount,
      chain: this.getChainConfigs(chain),
      ...options
    });
  }
  async transferERC20(chain, tokenAddress, toAddress, amount, options) {
    const publicClient = this.getPublicClient(chain);
    const walletClient = this.getWalletClient(chain);
    const { request } = await publicClient.simulateContract({
      account: this.account,
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "transfer",
      args: [toAddress, amount],
      ...options
    });
    return await walletClient.writeContract(request);
  }
  async getBalance() {
    const client = this.getPublicClient(this.currentChain);
    const balance = await client.getBalance({
      address: this.account.address
    });
    return formatUnits(balance, 18);
  }
  async getTokenAddress(chainName, tokenSymbol) {
    const token = await getToken(
      this.getChainConfigs(chainName).id,
      tokenSymbol
    );
    return token.address;
  }
  /**
   * Gets testnet token address from predefined mapping
   * This is a custom method for testnet tokens since the regular token lookup
   * doesn't work on testnets.
   */
  getTestnetTokenAddress(tokenSymbol) {
    const TESTNET_TOKEN_ADDRESSES2 = {
      "BNB": "0x64544969ed7EBf5f083679233325356EbE738930",
      "BUSD": "0x48D87A2d14De41E2308A764905B93E05c9377cE1",
      "DAI": "0x46B48c1Ef4B5F15B7DdC415290CEC2f774cD1021",
      "ETH": "0x635780E5D02Ab29d7aE14d266936A38d3D5B0CC5",
      "USDC": "0x053Fc65249dF91a02Ddb294A081f774615aB45F4"
    };
    const normalizedSymbol = tokenSymbol.toUpperCase();
    if (TESTNET_TOKEN_ADDRESSES2[normalizedSymbol]) {
      elizaLogger.debug(`Found testnet token address for ${normalizedSymbol}: ${TESTNET_TOKEN_ADDRESSES2[normalizedSymbol]}`);
      return TESTNET_TOKEN_ADDRESSES2[normalizedSymbol];
    }
    elizaLogger.debug(`No testnet address found for token ${normalizedSymbol}`);
    return null;
  }
  addChain(chain) {
    this.setChains(chain);
  }
  switchChain(chainName, customRpcUrl) {
    if (!this.chains[chainName]) {
      const chain = _WalletProvider.genChainFromName(
        chainName,
        customRpcUrl
      );
      this.addChain({ [chainName]: chain });
    }
    this.setCurrentChain(chainName);
  }
  setAccount = (pk) => {
    this.account = privateKeyToAccount(pk);
  };
  setChains = (chains) => {
    if (!chains) {
      return;
    }
    for (const chain of Object.keys(chains)) {
      this.chains[chain] = chains[chain];
    }
  };
  setCurrentChain = (chain) => {
    this.currentChain = chain;
  };
  createHttpTransport = (chainName) => {
    const chain = this.chains[chainName];
    if (chain.rpcUrls.custom) {
      return http(chain.rpcUrls.custom.http[0]);
    }
    return http(chain.rpcUrls.default.http[0]);
  };
  static genChainFromName(chainName, customRpcUrl) {
    const baseChain = viemChains[chainName];
    if (!baseChain?.id) {
      throw new Error("Invalid chain name");
    }
    const viemChain = customRpcUrl ? {
      ...baseChain,
      rpcUrls: {
        ...baseChain.rpcUrls,
        custom: {
          http: [customRpcUrl]
        }
      }
    } : baseChain;
    return viemChain;
  }
};
var genChainsFromRuntime = (runtime) => {
  const chainNames = ["bsc", "bscTestnet", "opBNB", "opBNBTestnet"];
  const chains = {};
  for (const chainName of chainNames) {
    const chain = WalletProvider.genChainFromName(chainName);
    chains[chainName] = chain;
  }
  const mainnet_rpcurl = runtime.getSetting("BSC_PROVIDER_URL");
  if (mainnet_rpcurl) {
    const chain = WalletProvider.genChainFromName("bsc", mainnet_rpcurl);
    chains["bsc"] = chain;
  }
  const testnet_rpcurl = runtime.getSetting("BSC_TESTNET_PROVIDER_URL");
  if (testnet_rpcurl) {
    const chain = WalletProvider.genChainFromName("bscTestnet", testnet_rpcurl);
    chains["bscTestnet"] = chain;
  }
  const opbnb_rpcurl = runtime.getSetting("OPBNB_PROVIDER_URL");
  if (opbnb_rpcurl) {
    const chain = WalletProvider.genChainFromName("opBNB", opbnb_rpcurl);
    chains["opBNB"] = chain;
  }
  return chains;
};
var initWalletProvider = (runtime) => {
  const privateKey = runtime.getSetting("BNB_PRIVATE_KEY");
  if (!privateKey) {
    throw new Error("BNB_PRIVATE_KEY is missing");
  }
  const chains = genChainsFromRuntime(runtime);
  return new WalletProvider(privateKey, chains);
};
var bnbWalletProvider = {
  async get(runtime, _message, _state) {
    try {
      const walletProvider = initWalletProvider(runtime);
      const address = walletProvider.getAddress();
      const balance = await walletProvider.getBalance();
      const chain = walletProvider.getCurrentChain();
      return `BNB chain Wallet Address: ${address}
Balance: ${balance} ${chain.nativeCurrency.symbol}
Chain ID: ${chain.id}, Name: ${chain.name}`;
    } catch (error) {
      console.error("Error in BNB chain wallet provider:", error);
      return null;
    }
  }
};

// src/templates/index.ts
var getBalanceTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested check balance:
- Chain to execute on. Must be one of ["bsc", "bscTestnet", "opBNB", "opBNBTestnet"]. Default is "bsc".
- Address to check balance for. Optional, must be a valid Ethereum address starting with "0x" or a web3 domain name. If not provided, use the BNB chain Wallet Address.
- Token symbol or address. Could be a token symbol or address. If the address is provided, it must be a valid Ethereum address starting with "0x". Default is "BNB".
If any field is not provided, use the default value. If no default value is specified, use null.

Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined:

\`\`\`json
{
    "chain": SUPPORTED_CHAINS,
    "address": string | null,
    "token": string
}
\`\`\`
`;
var transferTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested transfer:
- Chain to execute on. Must be one of ["bsc", "bscTestnet", "opBNB", "opBNBTestnet"]. Default is "bsc".
- Token symbol or address(string starting with "0x"). Optional.
- Amount to transfer. Optional. Must be a string representing the amount in ether (only number without coin symbol, e.g., "0.1").
- Recipient address. Must be a valid Ethereum address starting with "0x" or a web3 domain name.
- Data. Optional, data to be included in the transaction.
If any field is not provided, use the default value. If no default value is specified, use null.

Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined:

\`\`\`json
{
    "chain": SUPPORTED_CHAINS,
    "token": string | null,
    "amount": string | null,
    "toAddress": string,
    "data": string | null
}
\`\`\`
`;
var swapTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested token swap:
- Chain to execute on. Must be one of ["bsc", "bscTestnet", "opBNB", "opBNBTestnet"]. Default is "bsc".
- Input token symbol or address(string starting with "0x").
- Output token symbol or address(string starting with "0x").
- Amount to swap. Must be a string representing the amount in ether (only number without coin symbol, e.g., "0.1").
- Slippage. Optional, expressed as decimal proportion, 0.03 represents 3%.
If any field is not provided, use the default value. If no default value is specified, use null.

Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined:

\`\`\`json
{
    "chain": SUPPORTED_CHAINS,
    "inputToken": string | null,
    "outputToken": string | null,
    "amount": string | null,
    "slippage": number | null
}
\`\`\`
`;
var bridgeTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested token bridge:
- From chain. Must be one of ["bsc", "opBNB"].
- To chain. Must be one of ["bsc", "opBNB"].
- From token address. Optional, must be a valid Ethereum address starting with "0x".
- To token address. Optional, must be a valid Ethereum address starting with "0x".
- Amount to bridge. Must be a string representing the amount in ether (only number without coin symbol, e.g., "0.1").
- To address. Optional, must be a valid Ethereum address starting with "0x" or a web3 domain name.

Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined:

\`\`\`json
{
    "fromChain": "bsc" | "opBNB",
    "toChain": "bsc" | "opBNB",
    "fromToken": string | null,
    "toToken": string | null,
    "amount": string,
    "toAddress": string | null
}
\`\`\`
`;
var stakeTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested stake action:
- Chain to execute on. Must be one of ["bsc", "bscTestnet", "opBNB", "opBNBTestnet"]. Default is "bsc".
- Action to execute. Must be one of ["deposit", "withdraw", "claim"].
- Amount to execute. Optional, must be a string representing the amount in ether (only number without coin symbol, e.g., "0.1"). If the action is "deposit" or "withdraw", amount is required.
If any field is not provided, use the default value. If no default value is specified, use null.

Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined:

\`\`\`json
{
    "chain": SUPPORTED_CHAINS,
    "action": "deposit" | "withdraw" | "claim",
    "amount": string | null,
}
\`\`\`
`;
var faucetTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

Extract the following information about the requested faucet request:
- Token. Token to request. Could be one of ["BNB", "BTC", "BUSD", "DAI", "ETH", "USDC"]. Optional.
- Recipient address. Optional, must be a valid Ethereum address starting with "0x" or a web3 domain name. If not provided, use the BNB chain Wallet Address.
If any field is not provided, use the default value. If no default value is specified, use null.

Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined:

\`\`\`json
{
    "token": string | null,
    "toAddress": string | null
}
\`\`\`
`;
var ercContractTemplate = `Given the recent messages and wallet information below:

{{recentMessages}}

{{walletInfo}}

When user wants to deploy any type of token contract (ERC20/721/1155), this will trigger the DEPLOY_TOKEN action.

Extract the following details for deploying a token contract:
- Chain to execute on. Must be one of ["bsc", "bscTestnet", "opBNB", "opBNBTestnet"]. Default is "bsc".
- contractType: The type of token contract to deploy
  - For ERC20: Extract name, symbol, decimals, totalSupply
  - For ERC721: Extract name, symbol, baseURI
  - For ERC1155: Extract name, baseURI
- name: The name of the token.
- symbol: The token symbol (only for ERC20/721).
- decimals: Token decimals (only for ERC20). Default is 18.
- totalSupply: Total supply with decimals (only for ERC20). Default is "1000000000000000000".
- baseURI: Base URI for token metadata (only for ERC721/1155).
If any field is not provided, use the default value. If no default value is provided, use empty string.

Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined:

\`\`\`json
{
    "chain": SUPPORTED_CHAINS,
    "contractType": "ERC20" | "ERC721" | "ERC1155",
    "name": string,
    "symbol": string | null,
    "decimals": number | null,
    "totalSupply": string | null,
    "baseURI": string | null
}
\`\`\`
`;
var greenfieldTemplate = `Given the recent messages and wallet information below(only including 'Greenfield' keyword):

{{recentMessages}}

{{walletInfo}}

Extract the following details for Greenfield operations:
- **actionType** (string): The type of operation to perform (e.g., "createBucket", "uploadObject", "deleteObject", "crossChainTransfer")
- **bucketName** (string, optional): The name of the bucket to operate
- **objectName** (string, optional): The name of the object for upload operations
- **visibility** (string, optional): Bucket visibility setting ("private" or "public")
- **amount** (string, optional): BNB transfer to greenfield token amount.

Required response format:
\`\`\`json
{
    "actionType": "createBucket" | "uploadObject" | "deleteObject" | "crossChainTransfer",
    "bucketName": string,
    "objectName": string,
    "visibility": "private" | "public",
    "amount": number
}
\`\`\`
`;

// src/actions/swap.ts
var SwapAction = class {
  constructor(walletProvider) {
    this.walletProvider = walletProvider;
  }
  async swap(params) {
    elizaLogger2.debug("Starting swap with params:", JSON.stringify(params, null, 2));
    this.validateAndNormalizeParams(params);
    elizaLogger2.debug("After validation, params:", JSON.stringify(params, null, 2));
    const fromAddress = this.walletProvider.getAddress();
    elizaLogger2.debug(`From address: ${fromAddress}`);
    const chainId = this.walletProvider.getChainConfigs(params.chain).id;
    elizaLogger2.debug(`Chain ID: ${chainId}`);
    elizaLogger2.debug(`Configuring LI.FI SDK for chain: ${params.chain}`);
    this.walletProvider.configureLiFiSdk(params.chain);
    let fromTokenAddress = params.fromToken;
    let toTokenAddress = params.toToken;
    if (!params.fromToken.startsWith("0x")) {
      try {
        elizaLogger2.debug(`Resolving from token symbol: ${params.fromToken}`);
        fromTokenAddress = await this.walletProvider.getTokenAddress(
          params.chain,
          params.fromToken
        );
        elizaLogger2.debug(`Resolved from token address: ${fromTokenAddress}`);
        if (params.fromToken.toUpperCase() === "BNB") {
          elizaLogger2.debug("Using special native token address for BNB");
          fromTokenAddress = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
        }
      } catch (error) {
        elizaLogger2.error(`Error resolving from token address for ${params.fromToken}:`, error);
        throw new Error(`Could not find token ${params.fromToken} on chain ${params.chain}. Please check the token symbol.`);
      }
    } else {
      elizaLogger2.debug(`Using direct from token address: ${fromTokenAddress}`);
    }
    if (!params.toToken.startsWith("0x")) {
      try {
        elizaLogger2.debug(`Resolving to token symbol: ${params.toToken}`);
        toTokenAddress = await this.walletProvider.getTokenAddress(
          params.chain,
          params.toToken
        );
        elizaLogger2.debug(`Resolved to token address: ${toTokenAddress}`);
        if (params.toToken.toUpperCase() === "BNB") {
          elizaLogger2.debug("Using special native token address for BNB");
          toTokenAddress = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
        }
      } catch (error) {
        elizaLogger2.error(`Error resolving to token address for ${params.toToken}:`, error);
        throw new Error(`Could not find token ${params.toToken} on chain ${params.chain}. Please check the token symbol.`);
      }
    } else {
      elizaLogger2.debug(`Using direct to token address: ${toTokenAddress}`);
    }
    const resp = {
      chain: params.chain,
      txHash: "0x",
      fromToken: params.fromToken,
      toToken: params.toToken,
      amount: params.amount
    };
    elizaLogger2.debug(`Getting routes from ${fromTokenAddress} to ${toTokenAddress}`);
    const slippage = params.slippage || 0.05;
    elizaLogger2.debug(`Using slippage: ${slippage}`);
    try {
      const routes = await getRoutes({
        fromChainId: chainId,
        toChainId: chainId,
        fromTokenAddress,
        toTokenAddress,
        fromAmount: parseEther(params.amount).toString(),
        fromAddress,
        options: {
          slippage,
          order: "RECOMMENDED"
        }
      });
      elizaLogger2.debug(`Found ${routes.routes.length} routes`);
      if (!routes.routes.length) {
        throw new Error(`No routes found from ${params.fromToken} to ${params.toToken} with amount ${params.amount}`);
      }
      elizaLogger2.debug(`Executing route: ${JSON.stringify(routes.routes[0].steps, null, 2)}`);
      const execution = await executeRoute(routes.routes[0]);
      elizaLogger2.debug(`Execution: ${JSON.stringify(execution.steps, null, 2)}`);
      const process2 = execution.steps[0]?.execution?.process[execution.steps[0]?.execution?.process.length - 1];
      if (!process2?.status || process2.status === "FAILED") {
        throw new Error(`Transaction failed: ${process2?.status || "unknown error"}`);
      }
      resp.txHash = process2.txHash;
      elizaLogger2.debug(`Swap successful with tx hash: ${resp.txHash}`);
      return resp;
    } catch (error) {
      elizaLogger2.error(`Error during swap execution:`, error);
      let errorMessage = error.message;
      if (error.message.includes("insufficient funds")) {
        elizaLogger2.error(`Insufficient funds for swap`);
        throw new Error(`Insufficient funds for swapping ${params.amount} ${params.fromToken}. Please check your balance.`);
      } else if (error.message.includes("Cannot read properties")) {
        elizaLogger2.error(`SDK response parsing error`);
        throw new Error(`Error processing swap response. This might be due to rate limits or invalid token parameters.`);
      }
      throw error;
    }
  }
  validateAndNormalizeParams(params) {
    elizaLogger2.debug(`Validating swap params: chain=${params.chain}, from=${params.fromToken}, to=${params.toToken}, amount=${params.amount}`);
    if (!params.chain) {
      elizaLogger2.debug(`No chain specified, defaulting to bsc`);
      params.chain = "bsc";
    } else if (params.chain !== "bsc") {
      elizaLogger2.error(`Unsupported chain: ${params.chain}`);
      throw new Error("Only BSC mainnet is supported for swaps");
    }
    if (!params.fromToken) {
      elizaLogger2.error(`From token not specified`);
      throw new Error("From token is required for swap");
    }
    if (!params.toToken) {
      elizaLogger2.error(`To token not specified`);
      throw new Error("To token is required for swap");
    }
    if (params.fromToken === params.toToken) {
      elizaLogger2.error(`Cannot swap from and to the same token: ${params.fromToken}`);
      throw new Error(`Cannot swap from and to the same token: ${params.fromToken}`);
    }
    if (!params.amount) {
      elizaLogger2.error(`Amount not specified`);
      throw new Error("Amount is required for swap");
    }
    try {
      const amountBigInt = parseEther(params.amount);
      if (amountBigInt <= 0n) {
        elizaLogger2.error(`Invalid amount: ${params.amount} (must be greater than 0)`);
        throw new Error("Swap amount must be greater than 0");
      }
      elizaLogger2.debug(`Amount parsed: ${amountBigInt.toString()} wei`);
    } catch (error) {
      elizaLogger2.error(`Failed to parse amount: ${params.amount}`, error);
      throw new Error(`Invalid swap amount: ${params.amount}. Please provide a valid number.`);
    }
    if (params.slippage !== void 0) {
      if (typeof params.slippage !== "number") {
        elizaLogger2.error(`Invalid slippage type: ${typeof params.slippage}`);
        throw new Error("Slippage must be a number");
      }
      if (params.slippage <= 0 || params.slippage > 1) {
        elizaLogger2.error(`Invalid slippage value: ${params.slippage} (must be between 0 and 1)`);
        throw new Error("Slippage must be between 0 and 1 (e.g., 0.05 for 5%)");
      }
    } else {
      params.slippage = 0.05;
      elizaLogger2.debug(`Using default slippage: ${params.slippage}`);
    }
  }
};
var swapAction = {
  name: "swap",
  description: "Swap tokens on the same chain",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger2.log("Starting swap action...");
    elizaLogger2.debug("Message content:", JSON.stringify(message.content, null, 2));
    const promptText = typeof message.content.text === "string" ? message.content.text.trim() : "";
    elizaLogger2.debug(`Raw prompt text: "${promptText}"`);
    const promptLower = promptText.toLowerCase();
    const basicSwapRegex = /swap\s+([0-9.]+)\s+([a-zA-Z0-9]+)\s+(?:for|to)\s+([a-zA-Z0-9]+)/i;
    const advancedSwapRegex = /(?:swap|exchange|trade|convert)\s+([0-9.]+)\s+([a-zA-Z0-9]+)\s+(?:for|to|into)\s+([a-zA-Z0-9]+)/i;
    let directFromToken = null;
    let directToToken = null;
    let directAmount = null;
    const match = promptText.match(basicSwapRegex) || promptText.match(advancedSwapRegex);
    if (match && match.length >= 4) {
      directAmount = match[1];
      directFromToken = match[2].toUpperCase();
      directToToken = match[3].toUpperCase();
      elizaLogger2.debug(`Directly extracted from prompt - Amount: ${directAmount}, From: ${directFromToken}, To: ${directToToken}`);
    }
    const tokenMentions = {};
    const commonTokens = ["USDT", "USDC", "BNB", "ETH", "BTC", "BUSD", "DAI", "WETC", "WBNB", "TRON", "LINK", "OM", "UNI", "PEPE", "AAVE", "ATOM"];
    for (const token of commonTokens) {
      const regex = new RegExp(`\\b${token}\\b`, "i");
      if (regex.test(promptText)) {
        tokenMentions[token] = true;
        elizaLogger2.debug(`Detected token in prompt: ${token}`);
      }
    }
    const promptAnalysis = {
      directFromToken,
      directToToken,
      directAmount,
      tokenMentions
    };
    elizaLogger2.debug("Prompt analysis result:", promptAnalysis);
    let currentState = state;
    if (!currentState) {
      currentState = await runtime.composeState(message);
    } else {
      currentState = await runtime.updateRecentMessageState(currentState);
    }
    state.walletInfo = await bnbWalletProvider.get(
      runtime,
      message,
      currentState
    );
    const swapContext = composeContext({
      state: currentState,
      template: swapTemplate
    });
    const content = await generateObjectDeprecated({
      runtime,
      context: swapContext,
      modelClass: ModelClass.LARGE
    });
    elizaLogger2.debug("Generated swap content:", JSON.stringify(content, null, 2));
    let chain = content.chain?.toLowerCase() || "bsc";
    elizaLogger2.debug(`Chain parameter: ${chain}`);
    let fromToken;
    if (directFromToken) {
      fromToken = directFromToken;
      elizaLogger2.debug(`Using from token directly extracted from prompt: ${fromToken}`);
    } else if (content.inputToken) {
      fromToken = content.inputToken;
      elizaLogger2.debug(`Using from token from generated content: ${fromToken}`);
    } else if (tokenMentions["BNB"]) {
      fromToken = "BNB";
      elizaLogger2.debug(`Defaulting to BNB as from token based on mention`);
    } else {
      fromToken = "BNB";
      elizaLogger2.debug(`No from token detected, defaulting to BNB`);
    }
    let toToken = "USDC";
    if (directToToken) {
      toToken = directToToken;
      elizaLogger2.debug(`Using to token directly extracted from prompt: ${toToken}`);
    } else if (content.outputToken) {
      toToken = content.outputToken;
      elizaLogger2.debug(`Using to token from generated content: ${toToken}`);
    } else {
      let tokenFound = false;
      for (const token of ["USDC", "USDT", "BUSD"]) {
        if (token !== fromToken && tokenMentions[token]) {
          toToken = token;
          elizaLogger2.debug(`Using ${token} as to token based on mention`);
          tokenFound = true;
          break;
        }
      }
      if (!tokenFound) {
        toToken = fromToken === "BNB" ? "USDC" : "BNB";
        elizaLogger2.debug(`No to token detected, defaulting to ${toToken}`);
      }
    }
    let amount;
    if (directAmount) {
      amount = directAmount;
      elizaLogger2.debug(`Using amount directly extracted from prompt: ${amount}`);
    } else if (content.amount) {
      amount = content.amount;
      elizaLogger2.debug(`Using amount from generated content: ${amount}`);
    } else {
      amount = "0.001";
      elizaLogger2.debug(`No amount detected, defaulting to ${amount}`);
    }
    let slippage = content.slippage;
    if (typeof slippage !== "number" || slippage <= 0 || slippage > 1) {
      slippage = 0.05;
      elizaLogger2.debug(`Invalid or missing slippage, using default: ${slippage}`);
    } else {
      elizaLogger2.debug(`Using slippage from content: ${slippage}`);
    }
    const walletProvider = initWalletProvider(runtime);
    const action = new SwapAction(walletProvider);
    const swapOptions = {
      chain,
      fromToken,
      toToken,
      amount,
      slippage
    };
    elizaLogger2.debug("Final swap options:", JSON.stringify(swapOptions, null, 2));
    try {
      elizaLogger2.debug("Calling swap with params:", JSON.stringify(swapOptions, null, 2));
      const swapResp = await action.swap(swapOptions);
      callback?.({
        text: `Successfully swapped ${swapResp.amount} ${swapResp.fromToken} to ${swapResp.toToken}
Transaction Hash: ${swapResp.txHash}`,
        content: { ...swapResp }
      });
      return true;
    } catch (error) {
      elizaLogger2.error("Error during swap:", error.message);
      try {
        elizaLogger2.error("Full error details:", JSON.stringify(error, null, 2));
      } catch (e) {
        elizaLogger2.error("Error object not serializable, logging properties individually:");
        for (const key in error) {
          try {
            elizaLogger2.error(`${key}:`, error[key]);
          } catch (e2) {
            elizaLogger2.error(`${key}: [Error serializing property]`);
          }
        }
      }
      let errorMessage = error.message;
      if (error.message.includes("No routes found")) {
        errorMessage = `No swap route found from ${swapOptions.fromToken} to ${swapOptions.toToken}. Please check that both tokens exist and have liquidity.`;
      } else if (error.message.includes("insufficient funds")) {
        errorMessage = `Insufficient funds for the swap. Please check your balance and try with a smaller amount.`;
      } else if (error.message.includes("high slippage")) {
        errorMessage = `Swap failed due to high price impact. Try reducing the amount or using a different token pair.`;
      }
      callback?.({
        text: `Swap failed: ${errorMessage}`,
        content: {
          error: errorMessage,
          fromToken: swapOptions.fromToken,
          toToken: swapOptions.toToken
        }
      });
      return false;
    }
  },
  template: swapTemplate,
  validate: async (runtime) => {
    const privateKey = runtime.getSetting("BNB_PRIVATE_KEY");
    return typeof privateKey === "string" && privateKey.startsWith("0x");
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Swap 0.001 BNB for USDC on BSC"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll help you swap 0.001 BNB for USDC on BSC",
          action: "SWAP",
          content: {
            chain: "bsc",
            inputToken: "BNB",
            outputToken: "USDC",
            amount: "0.001",
            slippage: void 0
          }
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Buy some token of 0x1234 using 0.001 USDC on BSC. The slippage should be no more than 5%"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll help you swap 0.001 USDC for token 0x1234 on BSC",
          action: "SWAP",
          content: {
            chain: "bsc",
            inputToken: "USDC",
            outputToken: "0x1234",
            amount: "0.001",
            slippage: 0.05
          }
        }
      }
    ]
  ],
  similes: ["SWAP", "TOKEN_SWAP", "EXCHANGE_TOKENS", "TRADE_TOKENS"]
};

// src/actions/transfer.ts
import {
  composeContext as composeContext2,
  elizaLogger as elizaLogger3,
  generateObjectDeprecated as generateObjectDeprecated2,
  ModelClass as ModelClass2
} from "@elizaos/core";
import {
  formatEther,
  formatUnits as formatUnits2,
  parseEther as parseEther2,
  parseUnits,
  erc20Abi as erc20Abi2
} from "viem";
var TransferAction = class {
  // 3 Gwei
  constructor(walletProvider) {
    this.walletProvider = walletProvider;
  }
  TRANSFER_GAS = 21000n;
  DEFAULT_GAS_PRICE = 3000000000n;
  async transfer(params) {
    elizaLogger3.debug("Starting transfer with params:", JSON.stringify(params, null, 2));
    elizaLogger3.debug(`Chain before validation: ${params.chain}`);
    elizaLogger3.debug(`Available chains:`, Object.keys(this.walletProvider.chains));
    if (!this.walletProvider.chains[params.chain]) {
      elizaLogger3.error(`Chain '${params.chain}' is not supported. Available chains: ${Object.keys(this.walletProvider.chains).join(", ")}`);
      throw new Error(`Chain '${params.chain}' is not supported. Please use one of: ${Object.keys(this.walletProvider.chains).join(", ")}`);
    }
    let dataParam = void 0;
    if (params.data && typeof params.data === "string" && params.data.startsWith("0x")) {
      dataParam = params.data;
      elizaLogger3.debug(`Using data parameter: ${dataParam}`);
    } else if (params.data) {
      elizaLogger3.debug(`Ignoring invalid data parameter: ${params.data}`);
    }
    await this.validateAndNormalizeParams(params);
    elizaLogger3.debug("After address validation, params:", JSON.stringify(params, null, 2));
    const fromAddress = this.walletProvider.getAddress();
    elizaLogger3.debug(`From address: ${fromAddress}`);
    elizaLogger3.debug(`Switching to chain: ${params.chain}`);
    this.walletProvider.switchChain(params.chain);
    const nativeToken = this.walletProvider.chains[params.chain].nativeCurrency.symbol;
    elizaLogger3.debug(`Native token for chain ${params.chain}: ${nativeToken}`);
    if (!params.token) {
      params.token = nativeToken;
      elizaLogger3.debug(`Setting null token to native token: ${nativeToken}`);
    } else if (params.token.toLowerCase() === nativeToken.toLowerCase()) {
      params.token = nativeToken;
      elizaLogger3.debug(`Standardized token case to match native token: ${nativeToken}`);
    }
    elizaLogger3.debug(`Final transfer token: ${params.token}`);
    const resp = {
      chain: params.chain,
      txHash: "0x",
      recipient: params.toAddress,
      amount: "",
      token: params.token
    };
    if (!params.token || params.token == "null" || params.token === nativeToken) {
      elizaLogger3.debug("Native token transfer:", nativeToken);
      const options = {
        data: dataParam
      };
      let value;
      if (!params.amount) {
        const publicClient2 = this.walletProvider.getPublicClient(
          params.chain
        );
        const balance = await publicClient2.getBalance({
          address: fromAddress
        });
        value = balance - this.DEFAULT_GAS_PRICE * 21000n;
        options.gas = this.TRANSFER_GAS;
        options.gasPrice = this.DEFAULT_GAS_PRICE;
      } else {
        value = parseEther2(params.amount);
      }
      resp.amount = formatEther(value);
      resp.txHash = await this.walletProvider.transfer(
        params.chain,
        params.toAddress,
        value,
        options
      );
    } else {
      elizaLogger3.debug("ERC20 token transfer");
      let tokenAddress = params.token;
      elizaLogger3.debug(`Token before address resolution: ${params.token}`);
      if (params.token === "BNB" || params.token === "bnb") {
        elizaLogger3.debug(`Detected native token (BNB) passed to ERC20 handling branch - switching to native token handling`);
        resp.token = nativeToken;
        const options = {
          data: dataParam
        };
        let value2;
        if (!params.amount) {
          const publicClient3 = this.walletProvider.getPublicClient(
            params.chain
          );
          const balance = await publicClient3.getBalance({
            address: fromAddress
          });
          value2 = balance - this.DEFAULT_GAS_PRICE * 21000n;
          options.gas = this.TRANSFER_GAS;
          options.gasPrice = this.DEFAULT_GAS_PRICE;
        } else {
          value2 = parseEther2(params.amount);
        }
        resp.amount = formatEther(value2);
        resp.txHash = await this.walletProvider.transfer(
          params.chain,
          params.toAddress,
          value2,
          options
        );
        elizaLogger3.debug(`Native BNB transfer completed via transfer branch`);
        return resp;
      } else if (!params.token.startsWith("0x")) {
        try {
          elizaLogger3.debug(`Attempting to resolve token symbol: ${params.token} on chain ${params.chain}`);
          this.walletProvider.configureLiFiSdk(params.chain);
          tokenAddress = await this.walletProvider.getTokenAddress(
            params.chain,
            params.token
          );
          elizaLogger3.debug(`Resolved token address: ${tokenAddress} for ${params.token}`);
          if (!tokenAddress || !tokenAddress.startsWith("0x")) {
            elizaLogger3.error(`Failed to resolve token to proper address: ${tokenAddress}`);
            throw new Error(`Could not resolve token symbol ${params.token} to a valid address`);
          }
        } catch (error) {
          elizaLogger3.error(`Error resolving token address for ${params.token}:`, error);
          throw new Error(`Could not find token ${params.token} on chain ${params.chain}. Please check the token symbol or use the contract address.`);
        }
      } else {
        elizaLogger3.debug(`Using token address directly: ${tokenAddress}`);
      }
      elizaLogger3.debug(`Final token address for ERC20 transfer: ${tokenAddress}`);
      const publicClient2 = this.walletProvider.getPublicClient(
        params.chain
      );
      const decimals = await publicClient2.readContract({
        address: tokenAddress,
        abi: erc20Abi2,
        functionName: "decimals"
      });
      let value;
      if (!params.amount) {
        value = await publicClient2.readContract({
          address: tokenAddress,
          abi: erc20Abi2,
          functionName: "balanceOf",
          args: [fromAddress]
        });
      } else {
        value = parseUnits(params.amount, decimals);
      }
      resp.amount = formatUnits2(value, decimals);
      resp.txHash = await this.walletProvider.transferERC20(
        params.chain,
        tokenAddress,
        params.toAddress,
        value
      );
    }
    if (!resp.txHash || resp.txHash === "0x") {
      throw new Error("Get transaction hash failed");
    }
    const publicClient = this.walletProvider.getPublicClient(params.chain);
    await publicClient.waitForTransactionReceipt({
      hash: resp.txHash
    });
    return resp;
  }
  async validateAndNormalizeParams(params) {
    if (!params.toAddress) {
      throw new Error("To address is required");
    }
    params.toAddress = await this.walletProvider.formatAddress(
      params.toAddress
    );
    params.data = "null" == params.data + "" ? "0x" : params.data;
    elizaLogger3.debug("params.data", params.data);
  }
};
var transferAction = {
  name: "transfer",
  description: "Transfer tokens between addresses on the same chain",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger3.log("Starting transfer action...");
    elizaLogger3.debug("Message content:", JSON.stringify(message.content, null, 2));
    const promptText = typeof message.content.text === "string" ? message.content.text.trim() : "";
    elizaLogger3.debug(`Raw prompt text: "${promptText}"`);
    const promptLower = promptText.toLowerCase();
    const containsBnb = promptLower.includes("bnb") || promptLower.includes("binance coin") || promptLower.includes("binance smart chain");
    let directTokenMatch = null;
    const transferRegex = /transfer\s+([0-9.]+)\s+([a-zA-Z0-9]+)\s+to\s+(0x[a-fA-F0-9]{40})/i;
    const match = promptText.match(transferRegex);
    if (match && match.length >= 3) {
      const [_, amount, tokenSymbol, toAddress] = match;
      directTokenMatch = tokenSymbol.toUpperCase();
      elizaLogger3.debug(`Directly extracted from prompt - Amount: ${amount}, Token: ${directTokenMatch}, To: ${toAddress}`);
    }
    if (containsBnb) {
      elizaLogger3.debug(`BNB transfer detected in prompt text: "${promptText}"`);
    }
    const promptAnalysis = {
      containsBnb,
      directTokenMatch
    };
    elizaLogger3.debug("Prompt analysis result:", promptAnalysis);
    if (!(message.content.source === "direct")) {
      callback?.({
        text: "I can't do that for you.",
        content: { error: "Transfer not allowed" }
      });
      return false;
    }
    let currentState = state;
    if (!currentState) {
      currentState = await runtime.composeState(message);
    } else {
      currentState = await runtime.updateRecentMessageState(currentState);
    }
    try {
      state.walletInfo = await bnbWalletProvider.get(
        runtime,
        message,
        currentState
      );
      elizaLogger3.debug("Wallet info:", state.walletInfo);
    } catch (error) {
      elizaLogger3.error("Error getting wallet info:", error.message);
    }
    elizaLogger3.debug("Available runtime settings:");
    const bscProviderUrl = runtime.getSetting("BSC_PROVIDER_URL");
    const bscTestnetProviderUrl = runtime.getSetting("BSC_TESTNET_PROVIDER_URL");
    elizaLogger3.debug(`BSC_PROVIDER_URL: ${bscProviderUrl ? "set" : "not set"}`);
    elizaLogger3.debug(`BSC_TESTNET_PROVIDER_URL: ${bscTestnetProviderUrl ? "set" : "not set"}`);
    const transferContext = composeContext2({
      state: currentState,
      template: transferTemplate
    });
    const content = await generateObjectDeprecated2({
      runtime,
      context: transferContext,
      modelClass: ModelClass2.LARGE
    });
    elizaLogger3.debug("Generated transfer content:", JSON.stringify(content, null, 2));
    let chain = content.chain?.toLowerCase() || "bsc";
    elizaLogger3.debug(`Chain parameter: ${chain}`);
    elizaLogger3.debug("Token from content:", content.token);
    elizaLogger3.debug("Content object keys:", Object.keys(content));
    let token;
    if (directTokenMatch) {
      token = directTokenMatch;
      elizaLogger3.debug(`Using token directly extracted from prompt: ${token}`);
    } else if (content.token) {
      token = content.token;
      elizaLogger3.debug(`Using token from generated content: ${token}`);
    } else if (containsBnb) {
      token = "BNB";
      elizaLogger3.debug(`Using BNB as detected in prompt`);
    } else {
      token = "BNB";
      elizaLogger3.debug(`No token detected, defaulting to native token BNB`);
    }
    if (!token) {
      token = "BNB";
      elizaLogger3.debug(`Final safeguard: ensuring token is not null/undefined`);
    }
    elizaLogger3.debug(`Final token parameter: ${token}`);
    const walletProvider = initWalletProvider(runtime);
    const action = new TransferAction(walletProvider);
    let dataParam = void 0;
    if (content.data && typeof content.data === "string") {
      if (content.data.startsWith("0x") && content.data !== "0x") {
        dataParam = content.data;
        elizaLogger3.debug(`Using valid hex data: ${dataParam}`);
      } else {
        elizaLogger3.debug(`Invalid data format or value: ${content.data}, ignoring`);
      }
    }
    const paramOptions = {
      chain,
      token,
      amount: content.amount,
      toAddress: content.toAddress,
      data: dataParam
    };
    elizaLogger3.debug("Transfer params before action:", JSON.stringify(paramOptions, null, 2));
    try {
      elizaLogger3.debug("Calling transfer with params:", JSON.stringify(paramOptions, null, 2));
      const transferResp = await action.transfer(paramOptions);
      callback?.({
        text: `Successfully transferred ${transferResp.amount} ${transferResp.token} to ${transferResp.recipient}
Transaction Hash: ${transferResp.txHash}`,
        content: { ...transferResp }
      });
      return true;
    } catch (error) {
      elizaLogger3.error("Error during transfer:", error.message);
      try {
        elizaLogger3.error("Full error details:", JSON.stringify(error, null, 2));
      } catch (e) {
        elizaLogger3.error("Error object not serializable, logging properties individually:");
        for (const key in error) {
          try {
            elizaLogger3.error(`${key}:`, error[key]);
          } catch (e2) {
            elizaLogger3.error(`${key}: [Error serializing property]`);
          }
        }
      }
      let errorMessage = error.message;
      if (error.message.includes("LI.FI SDK")) {
        elizaLogger3.error("LI.FI SDK error detected");
        if (error.message.includes("Request failed with status code 404") && error.message.includes("Could not find token")) {
          const tokenMatch = error.message.match(/Could not find token (.*?) on chain/);
          const tokenValue = tokenMatch ? tokenMatch[1] : paramOptions.token;
          errorMessage = `Could not find the token '${tokenValue}' on ${paramOptions.chain}. 
                    Please check the token symbol or address and try again.`;
          elizaLogger3.error(`Token not found: ${tokenValue}`);
          elizaLogger3.debug(`Original token from params: ${paramOptions.token}`);
          if (tokenValue === "null" || tokenValue === "undefined" || !tokenValue) {
            errorMessage += " For BNB transfers, please explicitly specify 'BNB' as the token.";
          }
        } else if (error.message.includes("400 Bad Request") && error.message.includes("chain must be")) {
          errorMessage = `Chain validation error: '${paramOptions.chain}' is not a valid chain for the LI.FI SDK. 
                    Please use 'bsc' for BSC mainnet.`;
        }
      }
      if (error.message.includes("insufficient funds")) {
        errorMessage = `Insufficient funds for the transaction. Please check your balance and try again with a smaller amount.`;
      } else if (error.message.includes("transaction underpriced")) {
        errorMessage = `Transaction underpriced. Please try again with a higher gas price.`;
      }
      callback?.({
        text: `Transfer failed: ${errorMessage}`,
        content: { error: errorMessage }
      });
      return false;
    }
  },
  template: transferTemplate,
  validate: async (runtime) => {
    const privateKey = runtime.getSetting("BNB_PRIVATE_KEY");
    return typeof privateKey === "string" && privateKey.startsWith("0x");
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Transfer 0.001 BNB to 0x2CE4EaF47CACFbC6590686f8f7521e0385822334"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll help you transfer 0.001 BNB to 0x2CE4EaF47CACFbC6590686f8f7521e0385822334 on BSC",
          action: "TRANSFER",
          content: {
            chain: "bsc",
            token: "BNB",
            amount: "1",
            toAddress: "0x2CE4EaF47CACFbC6590686f8f7521e0385822334"
          }
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Transfer 1 token of 0x1234 to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll help you transfer 1 token of 0x1234 to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e on BSC",
          action: "TRANSFER",
          content: {
            chain: "bsc",
            token: "0x1234",
            amount: "1",
            toAddress: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"
          }
        }
      }
    ]
  ],
  similes: ["TRANSFER", "SEND_TOKENS", "TOKEN_TRANSFER", "MOVE_TOKENS"]
};

// src/actions/bridge.ts
import {
  composeContext as composeContext3,
  elizaLogger as elizaLogger4,
  generateObjectDeprecated as generateObjectDeprecated3,
  ModelClass as ModelClass3
} from "@elizaos/core";
import { parseEther as parseEther3, getContract, parseUnits as parseUnits2, erc20Abi as erc20Abi3 } from "viem";

// src/types/index.ts
var L1StandardBridgeAbi = [
  {
    type: "constructor",
    inputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "receive",
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "MESSENGER",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract CrossDomainMessenger"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "OTHER_BRIDGE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract StandardBridge"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "bridgeERC20",
    inputs: [
      {
        name: "_localToken",
        type: "address",
        internalType: "address"
      },
      {
        name: "_remoteToken",
        type: "address",
        internalType: "address"
      },
      {
        name: "_amount",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "_minGasLimit",
        type: "uint32",
        internalType: "uint32"
      },
      {
        name: "_extraData",
        type: "bytes",
        internalType: "bytes"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "bridgeERC20To",
    inputs: [
      {
        name: "_localToken",
        type: "address",
        internalType: "address"
      },
      {
        name: "_remoteToken",
        type: "address",
        internalType: "address"
      },
      {
        name: "_to",
        type: "address",
        internalType: "address"
      },
      {
        name: "_amount",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "_minGasLimit",
        type: "uint32",
        internalType: "uint32"
      },
      {
        name: "_extraData",
        type: "bytes",
        internalType: "bytes"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "bridgeETH",
    inputs: [
      {
        name: "_minGasLimit",
        type: "uint32",
        internalType: "uint32"
      },
      {
        name: "_extraData",
        type: "bytes",
        internalType: "bytes"
      }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "bridgeETHTo",
    inputs: [
      {
        name: "_to",
        type: "address",
        internalType: "address"
      },
      {
        name: "_minGasLimit",
        type: "uint32",
        internalType: "uint32"
      },
      {
        name: "_extraData",
        type: "bytes",
        internalType: "bytes"
      }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "depositERC20",
    inputs: [
      {
        name: "_l1Token",
        type: "address",
        internalType: "address"
      },
      {
        name: "_l2Token",
        type: "address",
        internalType: "address"
      },
      {
        name: "_amount",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "_minGasLimit",
        type: "uint32",
        internalType: "uint32"
      },
      {
        name: "_extraData",
        type: "bytes",
        internalType: "bytes"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "depositERC20To",
    inputs: [
      {
        name: "_l1Token",
        type: "address",
        internalType: "address"
      },
      {
        name: "_l2Token",
        type: "address",
        internalType: "address"
      },
      {
        name: "_to",
        type: "address",
        internalType: "address"
      },
      {
        name: "_amount",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "_minGasLimit",
        type: "uint32",
        internalType: "uint32"
      },
      {
        name: "_extraData",
        type: "bytes",
        internalType: "bytes"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "depositETH",
    inputs: [
      {
        name: "_minGasLimit",
        type: "uint32",
        internalType: "uint32"
      },
      {
        name: "_extraData",
        type: "bytes",
        internalType: "bytes"
      }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "depositETHTo",
    inputs: [
      {
        name: "_to",
        type: "address",
        internalType: "address"
      },
      {
        name: "_minGasLimit",
        type: "uint32",
        internalType: "uint32"
      },
      {
        name: "_extraData",
        type: "bytes",
        internalType: "bytes"
      }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "deposits",
    inputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      },
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "finalizeBridgeERC20",
    inputs: [
      {
        name: "_localToken",
        type: "address",
        internalType: "address"
      },
      {
        name: "_remoteToken",
        type: "address",
        internalType: "address"
      },
      {
        name: "_from",
        type: "address",
        internalType: "address"
      },
      {
        name: "_to",
        type: "address",
        internalType: "address"
      },
      {
        name: "_amount",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "_extraData",
        type: "bytes",
        internalType: "bytes"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "finalizeBridgeETH",
    inputs: [
      {
        name: "_from",
        type: "address",
        internalType: "address"
      },
      {
        name: "_to",
        type: "address",
        internalType: "address"
      },
      {
        name: "_amount",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "_extraData",
        type: "bytes",
        internalType: "bytes"
      }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "finalizeERC20Withdrawal",
    inputs: [
      {
        name: "_l1Token",
        type: "address",
        internalType: "address"
      },
      {
        name: "_l2Token",
        type: "address",
        internalType: "address"
      },
      {
        name: "_from",
        type: "address",
        internalType: "address"
      },
      {
        name: "_to",
        type: "address",
        internalType: "address"
      },
      {
        name: "_amount",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "_extraData",
        type: "bytes",
        internalType: "bytes"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "finalizeETHWithdrawal",
    inputs: [
      {
        name: "_from",
        type: "address",
        internalType: "address"
      },
      {
        name: "_to",
        type: "address",
        internalType: "address"
      },
      {
        name: "_amount",
        type: "uint256",
        internalType: "uint256"
      },
      {
        name: "_extraData",
        type: "bytes",
        internalType: "bytes"
      }
    ],
    outputs: [],
    stateMutability: "payable"
  },
  {
    type: "function",
    name: "initialize",
    inputs: [
      {
        name: "_messenger",
        type: "address",
        internalType: "contract CrossDomainMessenger"
      },
      {
        name: "_superchainConfig",
        type: "address",
        internalType: "contract SuperchainConfig"
      },
      {
        name: "_systemConfig",
        type: "address",
        internalType: "contract SystemConfig"
      }
    ],
    outputs: [],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "l2TokenBridge",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "messenger",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract CrossDomainMessenger"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "otherBridge",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract StandardBridge"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "paused",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "superchainConfig",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract SuperchainConfig"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "systemConfig",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract SystemConfig"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "version",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "string",
        internalType: "string"
      }
    ],
    stateMutability: "view"
  },
  {
    type: "event",
    name: "ERC20BridgeFinalized",
    inputs: [
      {
        name: "localToken",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "remoteToken",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "from",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "to",
        type: "address",
        indexed: false,
        internalType: "address"
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      },
      {
        name: "extraData",
        type: "bytes",
        indexed: false,
        internalType: "bytes"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "ERC20BridgeInitiated",
    inputs: [
      {
        name: "localToken",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "remoteToken",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "from",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "to",
        type: "address",
        indexed: false,
        internalType: "address"
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      },
      {
        name: "extraData",
        type: "bytes",
        indexed: false,
        internalType: "bytes"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "ERC20DepositInitiated",
    inputs: [
      {
        name: "l1Token",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "l2Token",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "from",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "to",
        type: "address",
        indexed: false,
        internalType: "address"
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      },
      {
        name: "extraData",
        type: "bytes",
        indexed: false,
        internalType: "bytes"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "ERC20WithdrawalFinalized",
    inputs: [
      {
        name: "l1Token",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "l2Token",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "from",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "to",
        type: "address",
        indexed: false,
        internalType: "address"
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      },
      {
        name: "extraData",
        type: "bytes",
        indexed: false,
        internalType: "bytes"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "ETHBridgeFinalized",
    inputs: [
      {
        name: "from",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "to",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      },
      {
        name: "extraData",
        type: "bytes",
        indexed: false,
        internalType: "bytes"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "ETHBridgeInitiated",
    inputs: [
      {
        name: "from",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "to",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      },
      {
        name: "extraData",
        type: "bytes",
        indexed: false,
        internalType: "bytes"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "ETHDepositInitiated",
    inputs: [
      {
        name: "from",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "to",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      },
      {
        name: "extraData",
        type: "bytes",
        indexed: false,
        internalType: "bytes"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "ETHWithdrawalFinalized",
    inputs: [
      {
        name: "from",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "to",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      },
      {
        name: "extraData",
        type: "bytes",
        indexed: false,
        internalType: "bytes"
      }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "Initialized",
    inputs: [
      {
        name: "version",
        type: "uint8",
        indexed: false,
        internalType: "uint8"
      }
    ],
    anonymous: false
  }
];
var L2StandardBridgeAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "_owner",
        type: "address",
        internalType: "address payable"
      },
      {
        name: "_delegationFee",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    stateMutability: "nonpayable"
  },
  {
    name: "AddressEmptyCode",
    type: "error",
    inputs: [{ name: "target", type: "address", internalType: "address" }]
  },
  {
    name: "AddressInsufficientBalance",
    type: "error",
    inputs: [{ name: "account", type: "address", internalType: "address" }]
  },
  { name: "FailedInnerCall", type: "error", inputs: [] },
  {
    name: "OwnableInvalidOwner",
    type: "error",
    inputs: [{ name: "owner", type: "address", internalType: "address" }]
  },
  {
    name: "OwnableUnauthorizedAccount",
    type: "error",
    inputs: [{ name: "account", type: "address", internalType: "address" }]
  },
  {
    name: "SafeERC20FailedOperation",
    type: "error",
    inputs: [{ name: "token", type: "address", internalType: "address" }]
  },
  {
    name: "OwnershipTransferred",
    type: "event",
    inputs: [
      {
        name: "previousOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "newOwner",
        type: "address",
        indexed: true,
        internalType: "address"
      }
    ],
    anonymous: false,
    signature: "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0"
  },
  {
    name: "SetDelegationFee",
    type: "event",
    inputs: [
      {
        name: "_delegationFee",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      }
    ],
    anonymous: false,
    signature: "0x0322f3257c2afe5fe8da7ab561f0d3384148487412fe2751678f2188731c0815"
  },
  {
    name: "WithdrawTo",
    type: "event",
    inputs: [
      {
        name: "from",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "l2Token",
        type: "address",
        indexed: true,
        internalType: "address"
      },
      {
        name: "to",
        type: "address",
        indexed: false,
        internalType: "address"
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256"
      },
      {
        name: "minGasLimit",
        type: "uint32",
        indexed: false,
        internalType: "uint32"
      },
      {
        name: "extraData",
        type: "bytes",
        indexed: false,
        internalType: "bytes"
      }
    ],
    anonymous: false,
    signature: "0x56f66275d9ebc94b7d6895aa0d96a3783550d0183ba106408d387d19f2e877f1"
  },
  {
    name: "L2_STANDARD_BRIDGE",
    type: "function",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        value: "0x4200000000000000000000000000000000000010",
        internalType: "contract IL2StandardBridge"
      }
    ],
    constant: true,
    signature: "0x21d12763",
    stateMutability: "view"
  },
  {
    name: "L2_STANDARD_BRIDGE_ADDRESS",
    type: "function",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        value: "0x4200000000000000000000000000000000000010",
        internalType: "address"
      }
    ],
    constant: true,
    signature: "0x2cb7cb06",
    stateMutability: "view"
  },
  {
    name: "delegationFee",
    type: "function",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        value: "2000000000000000",
        internalType: "uint256"
      }
    ],
    constant: true,
    signature: "0xc5f0a58f",
    stateMutability: "view"
  },
  {
    name: "owner",
    type: "function",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        value: "0xCe4750fDc02A07Eb0d99cA798CD5c170D8F8410A",
        internalType: "address"
      }
    ],
    constant: true,
    signature: "0x8da5cb5b",
    stateMutability: "view"
  },
  {
    name: "renounceOwnership",
    type: "function",
    inputs: [],
    outputs: [],
    signature: "0x715018a6",
    stateMutability: "nonpayable"
  },
  {
    name: "setDelegationFee",
    type: "function",
    inputs: [
      {
        name: "_delegationFee",
        type: "uint256",
        internalType: "uint256"
      }
    ],
    outputs: [],
    signature: "0x55bfc81c",
    stateMutability: "nonpayable"
  },
  {
    name: "transferOwnership",
    type: "function",
    inputs: [
      { name: "newOwner", type: "address", internalType: "address" }
    ],
    outputs: [],
    signature: "0xf2fde38b",
    stateMutability: "nonpayable"
  },
  {
    name: "withdraw",
    type: "function",
    inputs: [
      { name: "_l2Token", type: "address", internalType: "address" },
      { name: "_amount", type: "uint256", internalType: "uint256" },
      { name: "_minGasLimit", type: "uint32", internalType: "uint32" },
      { name: "_extraData", type: "bytes", internalType: "bytes" }
    ],
    outputs: [],
    payable: true,
    signature: "0x32b7006d",
    stateMutability: "payable"
  },
  {
    name: "withdrawFee",
    type: "function",
    inputs: [
      { name: "_recipient", type: "address", internalType: "address" }
    ],
    outputs: [],
    signature: "0x1ac3ddeb",
    stateMutability: "nonpayable"
  },
  {
    name: "withdrawFeeToL1",
    type: "function",
    inputs: [
      { name: "_recipient", type: "address", internalType: "address" },
      { name: "_minGasLimit", type: "uint32", internalType: "uint32" },
      { name: "_extraData", type: "bytes", internalType: "bytes" }
    ],
    outputs: [],
    signature: "0x244cafe0",
    stateMutability: "nonpayable"
  },
  {
    name: "withdrawTo",
    type: "function",
    inputs: [
      { name: "_l2Token", type: "address", internalType: "address" },
      { name: "_to", type: "address", internalType: "address" },
      { name: "_amount", type: "uint256", internalType: "uint256" },
      { name: "_minGasLimit", type: "uint32", internalType: "uint32" },
      { name: "_extraData", type: "bytes", internalType: "bytes" }
    ],
    outputs: [],
    payable: true,
    signature: "0xa3a79548",
    stateMutability: "payable"
  }
];
var ListaDaoAbi = [
  { inputs: [], stateMutability: "nonpayable", type: "constructor" },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "_account",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_amount",
        type: "uint256"
      }
    ],
    name: "ClaimAllWithdrawals",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "_uuid",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_amount",
        type: "uint256"
      }
    ],
    name: "ClaimUndelegated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "_validator",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_uuid",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_amount",
        type: "uint256"
      }
    ],
    name: "ClaimUndelegatedFrom",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "_account",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_idx",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_amount",
        type: "uint256"
      }
    ],
    name: "ClaimWithdrawal",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "_amount",
        type: "uint256"
      }
    ],
    name: "Delegate",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "_validator",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_amount",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "bool",
        name: "_delegateVotePower",
        type: "bool"
      }
    ],
    name: "DelegateTo",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "_delegateTo",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_votesChange",
        type: "uint256"
      }
    ],
    name: "DelegateVoteTo",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "_src",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_amount",
        type: "uint256"
      }
    ],
    name: "Deposit",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "_address",
        type: "address"
      }
    ],
    name: "DisableValidator",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint8",
        name: "version",
        type: "uint8"
      }
    ],
    name: "Initialized",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "Paused",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "_address",
        type: "address"
      }
    ],
    name: "ProposeManager",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "_src",
        type: "address"
      },
      {
        indexed: false,
        internalType: "address",
        name: "_dest",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_amount",
        type: "uint256"
      }
    ],
    name: "ReDelegate",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "_rewardsId",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_amount",
        type: "uint256"
      }
    ],
    name: "Redelegate",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "_address",
        type: "address"
      }
    ],
    name: "RemoveValidator",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "_account",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_amountInSlisBnb",
        type: "uint256"
      }
    ],
    name: "RequestWithdraw",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "_amount",
        type: "uint256"
      }
    ],
    name: "RewardsCompounded",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "previousAdminRole",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "newAdminRole",
        type: "bytes32"
      }
    ],
    name: "RoleAdminChanged",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "RoleGranted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "role",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address"
      },
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address"
      }
    ],
    name: "RoleRevoked",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "_annualRate",
        type: "uint256"
      }
    ],
    name: "SetAnnualRate",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "_address",
        type: "address"
      }
    ],
    name: "SetBSCValidator",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "_address",
        type: "address"
      }
    ],
    name: "SetManager",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "_minBnb",
        type: "uint256"
      }
    ],
    name: "SetMinBnb",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "_address",
        type: "address"
      }
    ],
    name: "SetRedirectAddress",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "_amount",
        type: "uint256"
      }
    ],
    name: "SetReserveAmount",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "_address",
        type: "address"
      }
    ],
    name: "SetRevenuePool",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "_synFee",
        type: "uint256"
      }
    ],
    name: "SetSynFee",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "_validator",
        type: "address"
      },
      {
        indexed: false,
        internalType: "address",
        name: "_credit",
        type: "address"
      },
      {
        indexed: false,
        internalType: "bool",
        name: "toRemove",
        type: "bool"
      }
    ],
    name: "SyncCreditContract",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "_nextUndelegatedRequestIndex",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_bnbAmount",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_shares",
        type: "uint256"
      }
    ],
    name: "Undelegate",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "_operator",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_bnbAmount",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_shares",
        type: "uint256"
      }
    ],
    name: "UndelegateFrom",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "_amount",
        type: "uint256"
      }
    ],
    name: "UndelegateReserve",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "account",
        type: "address"
      }
    ],
    name: "Unpaused",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "_address",
        type: "address"
      }
    ],
    name: "WhitelistValidator",
    type: "event"
  },
  {
    inputs: [],
    name: "BOT",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "DEFAULT_ADMIN_ROLE",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "GUARDIAN",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "TEN_DECIMALS",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "acceptNewManager",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "amountToDelegate",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "annualRate",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "uint256", name: "_bnbAmount", type: "uint256" }
    ],
    name: "binarySearchCoveredMaxIndex",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_validator", type: "address" }
    ],
    name: "claimUndelegated",
    outputs: [
      { internalType: "uint256", name: "_uuid", type: "uint256" },
      { internalType: "uint256", name: "_amount", type: "uint256" }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "_idx", type: "uint256" }],
    name: "claimWithdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_user", type: "address" },
      { internalType: "uint256", name: "_idx", type: "uint256" }
    ],
    name: "claimWithdrawFor",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "compoundRewards",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_operator", type: "address" },
      { internalType: "uint256", name: "_bnbAmount", type: "uint256" }
    ],
    name: "convertBnbToShares",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "_amount", type: "uint256" }],
    name: "convertBnbToSnBnb",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_operator", type: "address" },
      { internalType: "uint256", name: "_shares", type: "uint256" }
    ],
    name: "convertSharesToBnb",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_amountInSlisBnb",
        type: "uint256"
      }
    ],
    name: "convertSnBnbToBnb",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "creditContracts",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "creditStates",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_validator", type: "address" },
      { internalType: "uint256", name: "_amount", type: "uint256" }
    ],
    name: "delegateTo",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "delegateVotePower",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_delegateTo", type: "address" }
    ],
    name: "delegateVoteTo",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [],
    name: "depositReserve",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_address", type: "address" }
    ],
    name: "disableValidator",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "getAmountToUndelegate",
    outputs: [
      {
        internalType: "uint256",
        name: "_amountToUndelegate",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "_uuid", type: "uint256" }],
    name: "getBotUndelegateRequest",
    outputs: [
      {
        components: [
          {
            internalType: "uint256",
            name: "startTime",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "endTime",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "amount",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "amountInSnBnb",
            type: "uint256"
          }
        ],
        internalType: "struct IStakeManager.BotUndelegateRequest",
        name: "",
        type: "tuple"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_validator", type: "address" }
    ],
    name: "getClaimableAmount",
    outputs: [
      { internalType: "uint256", name: "_amount", type: "uint256" }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getContracts",
    outputs: [
      { internalType: "address", name: "_manager", type: "address" },
      { internalType: "address", name: "_slisBnb", type: "address" },
      { internalType: "address", name: "_bscValidator", type: "address" }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_validator", type: "address" }
    ],
    name: "getDelegated",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "_amount", type: "uint256" }],
    name: "getRedelegateFee",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "bytes32", name: "role", type: "bytes32" }],
    name: "getRoleAdmin",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getSlisBnbWithdrawLimit",
    outputs: [
      {
        internalType: "uint256",
        name: "_slisBnbWithdrawLimit",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getTotalBnbInValidators",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getTotalPooledBnb",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_user", type: "address" },
      { internalType: "uint256", name: "_idx", type: "uint256" }
    ],
    name: "getUserRequestStatus",
    outputs: [
      { internalType: "bool", name: "_isClaimable", type: "bool" },
      { internalType: "uint256", name: "_amount", type: "uint256" }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_address", type: "address" }
    ],
    name: "getUserWithdrawalRequests",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "uuid", type: "uint256" },
          {
            internalType: "uint256",
            name: "amountInSnBnb",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "startTime",
            type: "uint256"
          }
        ],
        internalType: "struct IStakeManager.WithdrawalRequest[]",
        name: "",
        type: "tuple[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "bytes32", name: "role", type: "bytes32" },
      { internalType: "address", name: "account", type: "address" }
    ],
    name: "grantRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "bytes32", name: "role", type: "bytes32" },
      { internalType: "address", name: "account", type: "address" }
    ],
    name: "hasRole",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_slisBnb", type: "address" },
      { internalType: "address", name: "_admin", type: "address" },
      { internalType: "address", name: "_manager", type: "address" },
      { internalType: "address", name: "_bot", type: "address" },
      { internalType: "uint256", name: "_synFee", type: "uint256" },
      { internalType: "address", name: "_revenuePool", type: "address" },
      { internalType: "address", name: "_validator", type: "address" }
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "minBnb",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "nextConfirmedRequestUUID",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "pause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "paused",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "placeholder",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_address", type: "address" }
    ],
    name: "proposeNewManager",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "srcValidator", type: "address" },
      { internalType: "address", name: "dstValidator", type: "address" },
      { internalType: "uint256", name: "_amount", type: "uint256" }
    ],
    name: "redelegate",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "redirectAddress",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_address", type: "address" }
    ],
    name: "removeValidator",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "bytes32", name: "role", type: "bytes32" },
      { internalType: "address", name: "account", type: "address" }
    ],
    name: "renounceRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "requestIndexMap",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "requestUUID",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_amountInSlisBnb",
        type: "uint256"
      }
    ],
    name: "requestWithdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "reserveAmount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "revenuePool",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_address", type: "address" }
    ],
    name: "revokeBotRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "bytes32", name: "role", type: "bytes32" },
      { internalType: "address", name: "account", type: "address" }
    ],
    name: "revokeRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "uint256", name: "_annualRate", type: "uint256" }
    ],
    name: "setAnnualRate",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_address", type: "address" }
    ],
    name: "setBSCValidator",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_address", type: "address" }
    ],
    name: "setBotRole",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "_amount", type: "uint256" }],
    name: "setMinBnb",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_address", type: "address" }
    ],
    name: "setRedirectAddress",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "amount", type: "uint256" }],
    name: "setReserveAmount",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_address", type: "address" }
    ],
    name: "setRevenuePool",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "_synFee", type: "uint256" }],
    name: "setSynFee",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "bytes4", name: "interfaceId", type: "bytes4" }
    ],
    name: "supportsInterface",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "synFee",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "togglePause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "toggleVote",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "totalDelegated",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "totalReserveAmount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "unbondingBnb",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "undelegate",
    outputs: [
      { internalType: "uint256", name: "_uuid", type: "uint256" },
      { internalType: "uint256", name: "_amount", type: "uint256" }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_operator", type: "address" },
      { internalType: "uint256", name: "_amount", type: "uint256" }
    ],
    name: "undelegateFrom",
    outputs: [
      {
        internalType: "uint256",
        name: "_actualBnbAmount",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "undelegatedQuota",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "validators",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "_address", type: "address" }
    ],
    name: "whitelistValidator",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "amount", type: "uint256" }],
    name: "withdrawReserve",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  { stateMutability: "payable", type: "receive" }
];

// src/actions/bridge.ts
function convertNullStringToUndefined(value) {
  if (value === "null" || value === null) {
    return void 0;
  }
  return value;
}
var BridgeAction = class {
  constructor(walletProvider) {
    this.walletProvider = walletProvider;
  }
  L1_BRIDGE_ADDRESS = "0xF05F0e4362859c3331Cb9395CBC201E3Fa6757Ea";
  L2_BRIDGE_ADDRESS = "0x4000698e3De52120DE28181BaACda82B21568416";
  LEGACY_ERC20_ETH = "0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000";
  async bridge(params) {
    elizaLogger4.debug("Starting bridge operation with params:", JSON.stringify(params, null, 2));
    await this.validateAndNormalizeParams(params);
    elizaLogger4.debug("After validation, bridge params:", JSON.stringify(params, null, 2));
    const fromAddress = this.walletProvider.getAddress();
    elizaLogger4.debug(`From address: ${fromAddress}`);
    elizaLogger4.debug(`Switching to chain: ${params.fromChain}`);
    this.walletProvider.switchChain(params.fromChain);
    const walletClient = this.walletProvider.getWalletClient(params.fromChain);
    const publicClient = this.walletProvider.getPublicClient(params.fromChain);
    const nativeToken = this.walletProvider.chains[params.fromChain].nativeCurrency.symbol;
    elizaLogger4.debug(`Native token for chain ${params.fromChain}: ${nativeToken}`);
    const resp = {
      fromChain: params.fromChain,
      toChain: params.toChain,
      txHash: "0x",
      recipient: params.toAddress ?? fromAddress,
      amount: params.amount,
      fromToken: params.fromToken ?? nativeToken,
      toToken: params.toToken ?? nativeToken
    };
    elizaLogger4.debug(`Bridge response initialized:`, JSON.stringify(resp, null, 2));
    const account = this.walletProvider.getAccount();
    const chain = this.walletProvider.getChainConfigs(params.fromChain);
    elizaLogger4.debug(`Using account: ${account.address}`);
    elizaLogger4.debug(`Chain config: ${chain.name} (ID: ${chain.id})`);
    const selfBridge = !params.toAddress || params.toAddress === fromAddress;
    const nativeTokenBridge = !params.fromToken || params.fromToken === nativeToken;
    elizaLogger4.debug(`Self bridge: ${selfBridge}`);
    elizaLogger4.debug(`Native token bridge: ${nativeTokenBridge}`);
    let amount;
    if (nativeTokenBridge) {
      amount = parseEther3(params.amount);
      elizaLogger4.debug(`Native token amount: ${amount} wei (${params.amount} ${nativeToken})`);
    } else {
      elizaLogger4.debug(`Reading decimals for token: ${params.fromToken}`);
      const decimals = await publicClient.readContract({
        address: params.fromToken,
        abi: erc20Abi3,
        functionName: "decimals"
      });
      amount = parseUnits2(params.amount, decimals);
      elizaLogger4.debug(`Token amount: ${amount} (${params.amount} tokens with ${decimals} decimals)`);
    }
    try {
      if (params.fromChain === "bsc" && params.toChain === "opBNB") {
        elizaLogger4.debug(`Bridging from L1 (BSC) to L2 (opBNB)`);
        elizaLogger4.debug(`Using L1 bridge contract: ${this.L1_BRIDGE_ADDRESS}`);
        const l1BridgeContract = getContract({
          address: this.L1_BRIDGE_ADDRESS,
          abi: L1StandardBridgeAbi,
          client: {
            public: publicClient,
            wallet: walletClient
          }
        });
        if (!nativeTokenBridge) {
          elizaLogger4.debug(`Checking ERC20 allowance for L1 bridge`);
          const allowance = await this.walletProvider.checkERC20Allowance(
            params.fromChain,
            params.fromToken,
            fromAddress,
            this.L1_BRIDGE_ADDRESS
          );
          elizaLogger4.debug(`Current allowance: ${allowance}`);
          if (allowance < amount) {
            const neededAllowance = amount - allowance;
            elizaLogger4.debug(`Increasing ERC20 allowance by ${neededAllowance}`);
            const txHash = await this.walletProvider.approveERC20(
              params.fromChain,
              params.fromToken,
              this.L1_BRIDGE_ADDRESS,
              amount
            );
            elizaLogger4.debug(`Approval transaction submitted with hash: ${txHash}`);
            await publicClient.waitForTransactionReceipt({
              hash: txHash
            });
            elizaLogger4.debug(`Approval transaction confirmed`);
          } else {
            elizaLogger4.debug(`Sufficient allowance already granted`);
          }
        }
        if (selfBridge && nativeTokenBridge) {
          elizaLogger4.debug(`Self bridge with native token - using depositETH`);
          const args = [1, "0x"];
          elizaLogger4.debug(`Simulating depositETH with value: ${amount}`);
          await l1BridgeContract.simulate.depositETH(args, {
            value: amount
          });
          elizaLogger4.debug(`Executing depositETH transaction`);
          resp.txHash = await l1BridgeContract.write.depositETH(args, {
            account,
            chain,
            value: amount
          });
          elizaLogger4.debug(`Transaction submitted with hash: ${resp.txHash}`);
        } else if (selfBridge && !nativeTokenBridge) {
          elizaLogger4.debug(`Self bridge with ERC20 token - using depositERC20`);
          elizaLogger4.debug(`From token: ${params.fromToken}, To token: ${params.toToken}`);
          const args = [
            params.fromToken,
            params.toToken,
            amount,
            1,
            "0x"
          ];
          elizaLogger4.debug(`Simulating depositERC20`);
          await l1BridgeContract.simulate.depositERC20(args, {
            account
          });
          elizaLogger4.debug(`Executing depositERC20 transaction`);
          resp.txHash = await l1BridgeContract.write.depositERC20(args, {
            account,
            chain
          });
          elizaLogger4.debug(`Transaction submitted with hash: ${resp.txHash}`);
        } else if (!selfBridge && nativeTokenBridge) {
          elizaLogger4.debug(`Bridge to another address with native token - using depositETHTo`);
          elizaLogger4.debug(`Recipient address: ${params.toAddress}`);
          const args = [params.toAddress, 1, "0x"];
          elizaLogger4.debug(`Simulating depositETHTo with value: ${amount}`);
          await l1BridgeContract.simulate.depositETHTo(args, {
            value: amount
          });
          elizaLogger4.debug(`Executing depositETHTo transaction`);
          resp.txHash = await l1BridgeContract.write.depositETHTo(args, {
            account,
            chain,
            value: amount
          });
          elizaLogger4.debug(`Transaction submitted with hash: ${resp.txHash}`);
        } else {
          elizaLogger4.debug(`Bridge to another address with ERC20 token - using depositERC20To`);
          elizaLogger4.debug(`From token: ${params.fromToken}, To token: ${params.toToken}`);
          elizaLogger4.debug(`Recipient address: ${params.toAddress}`);
          const args = [
            params.fromToken,
            params.toToken,
            params.toAddress,
            amount,
            1,
            "0x"
          ];
          elizaLogger4.debug(`Simulating depositERC20To`);
          await l1BridgeContract.simulate.depositERC20To(args, {
            account
          });
          elizaLogger4.debug(`Executing depositERC20To transaction`);
          resp.txHash = await l1BridgeContract.write.depositERC20To(
            args,
            {
              account,
              chain
            }
          );
          elizaLogger4.debug(`Transaction submitted with hash: ${resp.txHash}`);
        }
      } else if (params.fromChain === "opBNB" && params.toChain === "bsc") {
        elizaLogger4.debug(`Bridging from L2 (opBNB) to L1 (BSC)`);
        elizaLogger4.debug(`Using L2 bridge contract: ${this.L2_BRIDGE_ADDRESS}`);
        const l2BridgeContract = getContract({
          address: this.L2_BRIDGE_ADDRESS,
          abi: L2StandardBridgeAbi,
          client: {
            public: publicClient,
            wallet: walletClient
          }
        });
        elizaLogger4.debug(`Reading delegation fee from bridge contract`);
        const delegationFee = await publicClient.readContract({
          address: this.L2_BRIDGE_ADDRESS,
          abi: L2StandardBridgeAbi,
          functionName: "delegationFee"
        });
        elizaLogger4.debug(`Delegation fee: ${delegationFee}`);
        if (!nativeTokenBridge) {
          elizaLogger4.debug(`Checking ERC20 allowance for L2 bridge`);
          const allowance = await this.walletProvider.checkERC20Allowance(
            params.fromChain,
            params.fromToken,
            fromAddress,
            this.L2_BRIDGE_ADDRESS
          );
          elizaLogger4.debug(`Current allowance: ${allowance}`);
          if (allowance < amount) {
            const neededAllowance = amount - allowance;
            elizaLogger4.debug(`Increasing ERC20 allowance by ${neededAllowance}`);
            const txHash = await this.walletProvider.approveERC20(
              params.fromChain,
              params.fromToken,
              this.L2_BRIDGE_ADDRESS,
              amount
            );
            elizaLogger4.debug(`Approval transaction submitted with hash: ${txHash}`);
            await publicClient.waitForTransactionReceipt({
              hash: txHash
            });
            elizaLogger4.debug(`Approval transaction confirmed`);
          } else {
            elizaLogger4.debug(`Sufficient allowance already granted`);
          }
        }
        if (selfBridge && nativeTokenBridge) {
          elizaLogger4.debug(`Self bridge with native token - using withdraw with LEGACY_ERC20_ETH`);
          const args = [this.LEGACY_ERC20_ETH, amount, 1, "0x"];
          const value = amount + delegationFee;
          elizaLogger4.debug(`Simulating withdraw with value: ${value} (amount + delegationFee)`);
          await l2BridgeContract.simulate.withdraw(args, { value });
          elizaLogger4.debug(`Executing withdraw transaction`);
          resp.txHash = await l2BridgeContract.write.withdraw(args, {
            account,
            chain,
            value
          });
          elizaLogger4.debug(`Transaction submitted with hash: ${resp.txHash}`);
        } else if (selfBridge && !nativeTokenBridge) {
          elizaLogger4.debug(`Self bridge with ERC20 token - using withdraw`);
          elizaLogger4.debug(`Token: ${params.fromToken}`);
          const args = [params.fromToken, amount, 1, "0x"];
          const value = delegationFee;
          elizaLogger4.debug(`Simulating withdraw with delegationFee: ${value}`);
          await l2BridgeContract.simulate.withdraw(args, {
            account,
            value
          });
          elizaLogger4.debug(`Executing withdraw transaction`);
          resp.txHash = await l2BridgeContract.write.withdraw(args, {
            account,
            chain,
            value
          });
          elizaLogger4.debug(`Transaction submitted with hash: ${resp.txHash}`);
        } else if (!selfBridge && nativeTokenBridge) {
          elizaLogger4.debug(`Bridge to another address with native token - using withdrawTo with LEGACY_ERC20_ETH`);
          elizaLogger4.debug(`Recipient address: ${params.toAddress}`);
          const args = [
            this.LEGACY_ERC20_ETH,
            params.toAddress,
            amount,
            1,
            "0x"
          ];
          const value = amount + delegationFee;
          elizaLogger4.debug(`Simulating withdrawTo with value: ${value} (amount + delegationFee)`);
          await l2BridgeContract.simulate.withdrawTo(args, { value });
          elizaLogger4.debug(`Executing withdrawTo transaction`);
          resp.txHash = await l2BridgeContract.write.withdrawTo(args, {
            account,
            chain,
            value
          });
          elizaLogger4.debug(`Transaction submitted with hash: ${resp.txHash}`);
        } else {
          elizaLogger4.debug(`Bridge to another address with ERC20 token - using withdrawTo`);
          elizaLogger4.debug(`Token: ${params.fromToken}`);
          elizaLogger4.debug(`Recipient address: ${params.toAddress}`);
          const args = [
            params.fromToken,
            params.toAddress,
            amount,
            1,
            "0x"
          ];
          const value = delegationFee;
          elizaLogger4.debug(`Simulating withdrawTo with delegationFee: ${value}`);
          await l2BridgeContract.simulate.withdrawTo(args, {
            account,
            value
          });
          elizaLogger4.debug(`Executing withdrawTo transaction`);
          resp.txHash = await l2BridgeContract.write.withdrawTo(args, {
            account,
            chain,
            value
          });
          elizaLogger4.debug(`Transaction submitted with hash: ${resp.txHash}`);
        }
      } else {
        elizaLogger4.error(`Unsupported bridge direction: ${params.fromChain} to ${params.toChain}`);
        throw new Error(`Unsupported bridge direction: ${params.fromChain} to ${params.toChain}. Only BSC \u2194 opBNB is supported.`);
      }
      if (!resp.txHash || resp.txHash === "0x") {
        elizaLogger4.error("Failed to get transaction hash");
        throw new Error("Get transaction hash failed");
      }
      elizaLogger4.debug(`Waiting for transaction confirmation: ${resp.txHash}`);
      await publicClient.waitForTransactionReceipt({
        hash: resp.txHash
      });
      elizaLogger4.debug(`Transaction confirmed: ${resp.txHash}`);
      return resp;
    } catch (error) {
      elizaLogger4.error(`Error executing bridge operation:`, error);
      if (error.message.includes("insufficient funds")) {
        throw new Error(`Insufficient funds to bridge ${params.amount} ${resp.fromToken}. Please check your balance.`);
      } else if (error.message.includes("user rejected")) {
        throw new Error("Transaction rejected by user.");
      } else if (error.message.includes("execution reverted")) {
        throw new Error(`Bridge transaction reverted. This could be due to contract restrictions or incorrect parameters.`);
      }
      throw error;
    }
  }
  async validateAndNormalizeParams(params) {
    elizaLogger4.debug(`Validating bridge params:`, JSON.stringify(params, null, 2));
    if (!params.fromChain) {
      elizaLogger4.error("From chain is required");
      throw new Error("From chain is required for bridging");
    }
    if (!params.toChain) {
      elizaLogger4.error("To chain is required");
      throw new Error("To chain is required for bridging");
    }
    const supportedBridges = [
      { from: "bsc", to: "opBNB" },
      { from: "opBNB", to: "bsc" }
    ];
    const isSupported = supportedBridges.some(
      (bridge) => bridge.from === params.fromChain && bridge.to === params.toChain
    );
    if (!isSupported) {
      elizaLogger4.error(`Unsupported bridge direction: ${params.fromChain} to ${params.toChain}`);
      throw new Error(`Unsupported bridge direction. Currently only supporting: BSC \u2194 opBNB`);
    }
    if (!params.amount) {
      elizaLogger4.error("Amount is required");
      throw new Error("Amount is required for bridging");
    }
    try {
      const amountValue = parseFloat(params.amount);
      if (isNaN(amountValue) || amountValue <= 0) {
        elizaLogger4.error(`Invalid amount: ${params.amount}`);
        throw new Error(`Invalid amount: ${params.amount}. Please provide a positive number.`);
      }
      elizaLogger4.debug(`Amount validation passed: ${params.amount}`);
    } catch (error) {
      elizaLogger4.error(`Failed to parse amount: ${params.amount}`, error);
      throw new Error(`Invalid amount format: ${params.amount}. Please provide a valid number.`);
    }
    params.fromToken = convertNullStringToUndefined(params.fromToken);
    params.toToken = convertNullStringToUndefined(params.toToken);
    params.toAddress = convertNullStringToUndefined(params.toAddress);
    if (!params.toAddress) {
      params.toAddress = this.walletProvider.getAddress();
      elizaLogger4.debug(`No valid toAddress provided, using wallet address: ${params.toAddress}`);
    } else {
      elizaLogger4.debug(`Formatting address: ${params.toAddress}`);
      params.toAddress = await this.walletProvider.formatAddress(params.toAddress);
      elizaLogger4.debug(`Formatted address: ${params.toAddress}`);
    }
    if (params.fromChain === "bsc" && params.toChain === "opBNB") {
      if (params.fromToken && !params.toToken) {
        elizaLogger4.error("Missing L2 token address for ERC20 bridging");
        throw new Error("Token address on opBNB is required when bridging ERC20 from BSC to opBNB");
      }
      if (params.fromToken && !params.fromToken.startsWith("0x")) {
        elizaLogger4.error(`Invalid fromToken address format: ${params.fromToken}`);
        throw new Error(`Invalid token address format: ${params.fromToken}. Must start with 0x.`);
      }
      if (params.toToken && !params.toToken.startsWith("0x")) {
        elizaLogger4.error(`Invalid toToken address format: ${params.toToken}`);
        throw new Error(`Invalid token address format: ${params.toToken}. Must start with 0x.`);
      }
    }
    elizaLogger4.debug(`Validation passed for bridge params`);
  }
};
var bridgeAction = {
  name: "bridge",
  description: "Bridge tokens between BSC and opBNB",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger4.log("Starting bridge action...");
    elizaLogger4.debug("Message content:", JSON.stringify(message.content, null, 2));
    const promptText = typeof message.content.text === "string" ? message.content.text.trim() : "";
    elizaLogger4.debug(`Raw prompt text: "${promptText}"`);
    const promptLower = promptText.toLowerCase();
    const depositRegex = /(?:deposit|bridge|send)\s+([0-9.]+)\s+([a-zA-Z0-9]+)(?:\s+from)?\s+(?:bsc|binance)(?:\s+to)\s+(?:opbnb|op)/i;
    const withdrawRegex = /(?:withdraw|bridge|send)\s+([0-9.]+)\s+([a-zA-Z0-9]+)(?:\s+from)?\s+(?:opbnb|op)(?:\s+to)\s+(?:bsc|binance)/i;
    const toAddressRegex = /(?:to|address|recipient)\s+(0x[a-fA-F0-9]{40})/i;
    let directFromChain = null;
    let directToChain = null;
    let directAmount = null;
    let directToken = null;
    let directToAddress = null;
    let match = promptText.match(depositRegex);
    if (match && match.length >= 3) {
      directFromChain = "bsc";
      directToChain = "opBNB";
      directAmount = match[1];
      directToken = match[2].toUpperCase();
      elizaLogger4.debug(`Directly extracted BSC to opBNB bridge - Amount: ${directAmount}, Token: ${directToken}`);
    } else {
      match = promptText.match(withdrawRegex);
      if (match && match.length >= 3) {
        directFromChain = "opBNB";
        directToChain = "bsc";
        directAmount = match[1];
        directToken = match[2].toUpperCase();
        elizaLogger4.debug(`Directly extracted opBNB to BSC bridge - Amount: ${directAmount}, Token: ${directToken}`);
      }
    }
    match = promptText.match(toAddressRegex);
    if (match && match.length >= 2) {
      directToAddress = match[1];
      elizaLogger4.debug(`Directly extracted recipient address: ${directToAddress}`);
    }
    if (!directFromChain || !directToChain) {
      if (promptLower.includes("bsc to opbnb") || promptLower.includes("binance to opbnb") || promptLower.includes("bsc to op") || promptLower.includes("deposit to opbnb")) {
        directFromChain = "bsc";
        directToChain = "opBNB";
        elizaLogger4.debug(`Detected BSC to opBNB direction from keywords`);
      } else if (promptLower.includes("opbnb to bsc") || promptLower.includes("opbnb to binance") || promptLower.includes("op to bsc") || promptLower.includes("withdraw to bsc")) {
        directFromChain = "opBNB";
        directToChain = "bsc";
        elizaLogger4.debug(`Detected opBNB to BSC direction from keywords`);
      }
    }
    if (!directAmount) {
      const amountRegex = /([0-9]+(?:\.[0-9]+)?)/;
      const amountMatch = promptText.match(amountRegex);
      if (amountMatch && amountMatch.length >= 2) {
        directAmount = amountMatch[1];
        elizaLogger4.debug(`Extracted amount from prompt: ${directAmount}`);
      }
    }
    if (!directToken) {
      const tokenRegex = /\b(bnb|eth|usdt|usdc|busd|dai|btc)\b/i;
      const tokenMatch = promptLower.match(tokenRegex);
      if (tokenMatch && tokenMatch.length >= 2) {
        directToken = tokenMatch[1].toUpperCase();
        elizaLogger4.debug(`Extracted token from prompt: ${directToken}`);
      }
    }
    const promptAnalysis = {
      directFromChain,
      directToChain,
      directAmount,
      directToken,
      directToAddress,
      containsBSC: promptLower.includes("bsc") || promptLower.includes("binance"),
      containsOpBNB: promptLower.includes("opbnb") || promptLower.includes("op bnb") || promptLower.includes("op-bnb"),
      isDeposit: promptLower.includes("deposit"),
      isWithdraw: promptLower.includes("withdraw")
    };
    elizaLogger4.debug("Prompt analysis result:", promptAnalysis);
    let currentState = state;
    if (!currentState) {
      currentState = await runtime.composeState(message);
    } else {
      currentState = await runtime.updateRecentMessageState(currentState);
    }
    try {
      state.walletInfo = await bnbWalletProvider.get(runtime, message, currentState);
      elizaLogger4.debug("Wallet info:", state.walletInfo);
    } catch (error) {
      elizaLogger4.error("Error getting wallet info:", error.message);
      callback?.({
        text: `Unable to access wallet: ${error.message}`,
        content: { error: error.message }
      });
      return false;
    }
    const bridgeContext = composeContext3({
      state: currentState,
      template: bridgeTemplate
    });
    const content = await generateObjectDeprecated3({
      runtime,
      context: bridgeContext,
      modelClass: ModelClass3.LARGE
    });
    elizaLogger4.debug("Generated bridge content:", JSON.stringify(content, null, 2));
    let fromChain;
    let toChain;
    let amount;
    let fromToken;
    let toToken;
    let toAddress;
    if (directFromChain === "bsc" || directFromChain === "opBNB") {
      fromChain = directFromChain;
      elizaLogger4.debug(`Using from chain directly extracted from prompt: ${fromChain}`);
    } else if (content.fromChain) {
      fromChain = content.fromChain;
      elizaLogger4.debug(`Using from chain from generated content: ${fromChain}`);
    } else {
      fromChain = "bsc";
      elizaLogger4.debug(`No from chain detected, defaulting to ${fromChain}`);
    }
    if (directToChain === "bsc" || directToChain === "opBNB") {
      toChain = directToChain;
      elizaLogger4.debug(`Using to chain directly extracted from prompt: ${toChain}`);
    } else if (content.toChain) {
      toChain = content.toChain;
      elizaLogger4.debug(`Using to chain from generated content: ${toChain}`);
    } else {
      toChain = fromChain === "bsc" ? "opBNB" : "bsc";
      elizaLogger4.debug(`No to chain detected, using opposite of fromChain: ${toChain}`);
    }
    if (directAmount) {
      amount = directAmount;
      elizaLogger4.debug(`Using amount directly extracted from prompt: ${amount}`);
    } else if (content.amount) {
      amount = content.amount;
      elizaLogger4.debug(`Using amount from generated content: ${amount}`);
    } else {
      amount = "0.001";
      elizaLogger4.debug(`No amount detected, defaulting to ${amount}`);
    }
    if (directToken && fromChain) {
      if (directToken !== "BNB" && directToken.startsWith("0x")) {
        fromToken = directToken;
        elizaLogger4.debug(`Using token address directly extracted from prompt: ${fromToken}`);
      } else {
        fromToken = void 0;
        elizaLogger4.debug(`Using native token (${directToken || "BNB"})`);
      }
    } else if (content.fromToken) {
      fromToken = content.fromToken;
      elizaLogger4.debug(`Using from token from generated content: ${fromToken}`);
    }
    if (content.toToken) {
      toToken = convertNullStringToUndefined(content.toToken);
      if (toToken) {
        elizaLogger4.debug(`Using to token from generated content: ${toToken}`);
      } else {
        elizaLogger4.debug(`Content contained null/invalid toToken, using undefined instead`);
      }
    }
    if (fromChain === "bsc" && fromToken && !toToken) {
      elizaLogger4.error(`Missing destination token address for ERC20 bridge`);
      callback?.({
        text: `Cannot bridge ERC20 token from BSC to opBNB without destination token address. Please provide the token address on opBNB.`,
        content: { error: "Missing destination token address" }
      });
      return false;
    }
    if (directToAddress && directToAddress.startsWith("0x")) {
      toAddress = directToAddress;
      elizaLogger4.debug(`Using to address directly extracted from prompt: ${toAddress}`);
    } else if (content.toAddress) {
      toAddress = convertNullStringToUndefined(content.toAddress);
      if (toAddress) {
        elizaLogger4.debug(`Using to address from generated content: ${toAddress}`);
      } else {
        elizaLogger4.debug(`Content contained null/invalid toAddress, using undefined instead`);
      }
    }
    const walletProvider = initWalletProvider(runtime);
    const action = new BridgeAction(walletProvider);
    const paramOptions = {
      fromChain,
      toChain,
      fromToken,
      toToken,
      amount,
      toAddress
    };
    elizaLogger4.debug("Final bridge options:", JSON.stringify(paramOptions, null, 2));
    try {
      elizaLogger4.debug("Calling bridge with params:", JSON.stringify(paramOptions, null, 2));
      const bridgeResp = await action.bridge(paramOptions);
      let successText = `Successfully bridged ${bridgeResp.amount} ${bridgeResp.fromToken} from ${bridgeResp.fromChain} to ${bridgeResp.toChain}`;
      if (bridgeResp.recipient && bridgeResp.recipient !== walletProvider.getAddress()) {
        successText += ` (recipient: ${bridgeResp.recipient})`;
      }
      successText += `
Transaction Hash: ${bridgeResp.txHash}`;
      callback?.({
        text: successText,
        content: { ...bridgeResp }
      });
      return true;
    } catch (error) {
      elizaLogger4.error("Error during token bridge:", error.message);
      try {
        elizaLogger4.error("Full error details:", JSON.stringify(error, null, 2));
      } catch (e) {
        elizaLogger4.error("Error object not serializable, logging properties individually:");
        for (const key in error) {
          try {
            elizaLogger4.error(`${key}:`, error[key]);
          } catch (e2) {
            elizaLogger4.error(`${key}: [Error serializing property]`);
          }
        }
      }
      let errorMessage = error.message;
      if (error.message.includes("insufficient funds")) {
        errorMessage = `Insufficient funds for the bridge operation. Please check your balance and try with a smaller amount.`;
      } else if (error.message.includes("user rejected")) {
        errorMessage = `Transaction was rejected. Please try again if you want to proceed with the bridge operation.`;
      } else if (error.message.includes("token address on opBNB is required")) {
        errorMessage = `When bridging ERC20 tokens from BSC to opBNB, you must specify the token address on opBNB.`;
      } else if (error.message.includes("Unsupported bridge direction")) {
        errorMessage = `Only bridges between BSC and opBNB are supported. Valid directions are BSC\u2192opBNB and opBNB\u2192BSC.`;
      }
      callback?.({
        text: `Bridge failed: ${errorMessage}`,
        content: { error: errorMessage }
      });
      return false;
    }
  },
  template: bridgeTemplate,
  validate: async (runtime) => {
    const privateKey = runtime.getSetting("BNB_PRIVATE_KEY");
    return typeof privateKey === "string" && privateKey.startsWith("0x");
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Deposit 0.001 BNB from BSC to opBNB"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll help you bridge 0.001 BNB from BSC to opBNB",
          action: "BRIDGE",
          content: {
            fromChain: "bsc",
            toChain: "opBNB",
            fromToken: void 0,
            toToken: void 0,
            amount: "0.001"
          }
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Transfer 0.001 BNB from BSC to address 0x1234 on opBNB"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll help you bridge 0.001 BNB from BSC to address 0x1234 on opBNB",
          action: "BRIDGE",
          content: {
            fromChain: "bsc",
            toChain: "opBNB",
            fromToken: void 0,
            toToken: void 0,
            amount: "0.001",
            toAddress: "0x1234"
          }
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Deposit 0.001 0x123 token from BSC to address 0x456 on opBNB. The corresponding token address on opBNB is 0x789"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll help you bridge 0.001 0x123 token from BSC to address 0x456 on opBNB",
          action: "BRIDGE",
          content: {
            fromChain: "bsc",
            toChain: "opBNB",
            fromToken: "0x123",
            toToken: "0x789",
            amount: "0.001",
            toAddress: "0x456"
          }
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Withdraw 0.001 BNB from opBNB to BSC"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll help you bridge 0.001 BNB from opBNB to BSC",
          action: "BRIDGE",
          content: {
            fromChain: "opBNB",
            toChain: "bsc",
            fromToken: void 0,
            toToken: void 0,
            amount: "0.001"
          }
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Withdraw 0.001 0x1234 token from opBNB to address 0x5678 on BSC"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll help you bridge 0.001 0x1234 token from opBNB to address 0x5678 on BSC",
          action: "BRIDGE",
          content: {
            fromChain: "opBNB",
            toChain: "bsc",
            fromToken: "0x1234",
            toToken: void 0,
            amount: "0.001",
            toAddress: "0x5678"
          }
        }
      }
    ]
  ],
  similes: ["BRIDGE", "TOKEN_BRIDGE", "DEPOSIT", "WITHDRAW"]
};

// src/actions/deploy.ts
import {
  composeContext as composeContext4,
  elizaLogger as elizaLogger6,
  generateObjectDeprecated as generateObjectDeprecated4,
  ModelClass as ModelClass4
} from "@elizaos/core";
import solc2 from "solc";
import { parseUnits as parseUnits3 } from "viem";

// src/utils/contracts.ts
import { elizaLogger as elizaLogger5 } from "@elizaos/core";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
var require2 = createRequire(import.meta.url);
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var baseDir = path.resolve(__dirname, "../../plugin-bnb/src/contracts");
function getContractSource(contractPath) {
  return fs.readFileSync(contractPath, "utf8");
}
function findImports(importPath) {
  try {
    if (importPath.startsWith("@openzeppelin/")) {
      const modPath = require2.resolve(importPath);
      return { contents: fs.readFileSync(modPath, "utf8") };
    }
    const localPath = path.resolve("./contracts", importPath);
    if (fs.existsSync(localPath)) {
      return { contents: fs.readFileSync(localPath, "utf8") };
    }
    return { error: "File not found" };
  } catch {
    return { error: `File not found: ${importPath}` };
  }
}
async function compileSolidity(contractFileName) {
  const contractPath = path.join(baseDir, `${contractFileName}.sol`);
  const source = getContractSource(contractPath);
  const input = {
    language: "Solidity",
    sources: {
      [contractFileName]: {
        content: source
      }
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      outputSelection: {
        "*": {
          "*": ["*"]
        }
      }
    }
  };
  elizaLogger5.debug("Compiling contract...");
  try {
    const output = JSON.parse(
      solc.compile(JSON.stringify(input), { import: findImports })
    );
    if (output.errors) {
      const hasError = output.errors.some(
        (error) => error.type === "Error"
      );
      if (hasError) {
        throw new Error(
          `Compilation errors: ${JSON.stringify(output.errors, null, 2)}`
        );
      }
      elizaLogger5.warn("Compilation warnings:", output.errors);
    }
    const contractName = path.basename(contractFileName, ".sol");
    const contract = output.contracts[contractFileName][contractName];
    if (!contract) {
      throw new Error("Contract compilation result is empty");
    }
    elizaLogger5.debug("Contract compiled successfully");
    return {
      abi: contract.abi,
      bytecode: contract.evm.bytecode.object
    };
  } catch (error) {
    elizaLogger5.error("Compilation failed:", error.message);
    throw error;
  }
}

// src/actions/deploy.ts
var DeployAction = class {
  constructor(walletProvider) {
    this.walletProvider = walletProvider;
  }
  async compileSolidity(contractName, source) {
    elizaLogger6.debug(`Compiling Solidity contract: ${contractName}`);
    const solName = `${contractName}.sol`;
    const input = {
      language: "Solidity",
      sources: {
        [solName]: {
          content: source
        }
      },
      settings: {
        outputSelection: {
          "*": {
            "*": ["*"]
          }
        }
      }
    };
    elizaLogger6.debug("Preparing to compile contract...");
    try {
      const output = JSON.parse(solc2.compile(JSON.stringify(input)));
      elizaLogger6.debug("Compilation completed, checking for errors...");
      if (output.errors) {
        const errors = output.errors;
        const hasError = errors.some((error) => error.type === "Error");
        if (hasError) {
          elizaLogger6.error(`Compilation errors:`, JSON.stringify(errors, null, 2));
          const errorMessages = errors.map((e) => e.formattedMessage || e.message).join("\n");
          throw new Error(`Contract compilation failed: ${errorMessages}`);
        } else {
          elizaLogger6.warn(`Compilation warnings:`, JSON.stringify(errors, null, 2));
        }
      }
      const contract = output.contracts[solName][contractName];
      if (!contract) {
        elizaLogger6.error(`Compilation result is empty for ${contractName}`);
        throw new Error(`Compilation result is empty for ${contractName}`);
      }
      elizaLogger6.debug(`Contract ${contractName} compiled successfully`);
      return {
        abi: contract.abi,
        bytecode: contract.evm.bytecode.object
      };
    } catch (error) {
      elizaLogger6.error(`Error compiling contract ${contractName}:`, error);
      throw new Error(`Failed to compile contract: ${error.message}`);
    }
  }
  async deployERC20(deployTokenParams) {
    elizaLogger6.debug("Deploying ERC20 token with params:", JSON.stringify(deployTokenParams, null, 2));
    const { name, symbol, decimals, totalSupply, chain } = deployTokenParams;
    if (!name || name === "") {
      elizaLogger6.error("Token name is required");
      throw new Error("Token name is required");
    }
    if (!symbol || symbol === "") {
      elizaLogger6.error("Token symbol is required");
      throw new Error("Token symbol is required");
    }
    if (!decimals || decimals === 0) {
      elizaLogger6.error("Token decimals is required");
      throw new Error("Token decimals is required");
    }
    if (!totalSupply || totalSupply === "") {
      elizaLogger6.error("Token total supply is required");
      throw new Error("Token total supply is required");
    }
    elizaLogger6.debug(`Deploying ERC20 token: ${name} (${symbol}) with ${decimals} decimals and total supply ${totalSupply}`);
    try {
      elizaLogger6.debug(`Converting total supply ${totalSupply} to wei with ${decimals} decimals`);
      const totalSupplyWithDecimals = parseUnits3(totalSupply, decimals);
      elizaLogger6.debug(`Total supply in wei: ${totalSupplyWithDecimals.toString()}`);
      const args = [name, symbol, decimals, totalSupplyWithDecimals];
      elizaLogger6.debug(`Contract constructor arguments:`, args);
      elizaLogger6.debug(`Deploying ERC20 contract on chain ${chain}...`);
      const contractAddress = await this.deployContract(
        chain,
        "ERC20Contract",
        args
      );
      if (!contractAddress) {
        elizaLogger6.error("Failed to deploy ERC20 contract - no address returned");
        throw new Error("Failed to deploy ERC20 contract");
      }
      elizaLogger6.debug(`ERC20 contract deployed successfully at address: ${contractAddress}`);
      return {
        address: contractAddress
      };
    } catch (error) {
      elizaLogger6.error("Deploy ERC20 failed:", error.message);
      throw error;
    }
  }
  async deployERC721(deployNftParams) {
    elizaLogger6.debug("Deploying ERC721 NFT with params:", JSON.stringify(deployNftParams, null, 2));
    const { baseURI, name, symbol, chain } = deployNftParams;
    if (!name || name === "") {
      elizaLogger6.error("NFT name is required");
      throw new Error("NFT name is required");
    }
    if (!symbol || symbol === "") {
      elizaLogger6.error("NFT symbol is required");
      throw new Error("NFT symbol is required");
    }
    if (!baseURI || baseURI === "") {
      elizaLogger6.error("NFT baseURI is required");
      throw new Error("NFT baseURI is required");
    }
    elizaLogger6.debug(`Deploying ERC721 NFT: ${name} (${symbol}) with baseURI ${baseURI}`);
    try {
      const args = [name, symbol, baseURI];
      elizaLogger6.debug(`Contract constructor arguments:`, args);
      elizaLogger6.debug(`Deploying ERC721 contract on chain ${chain}...`);
      const contractAddress = await this.deployContract(
        chain,
        "ERC721Contract",
        args
      );
      if (!contractAddress) {
        elizaLogger6.error("Failed to deploy ERC721 contract - no address returned");
        throw new Error("Failed to deploy ERC721 contract");
      }
      elizaLogger6.debug(`ERC721 contract deployed successfully at address: ${contractAddress}`);
      return {
        address: contractAddress
      };
    } catch (error) {
      elizaLogger6.error("Deploy ERC721 failed:", error.message);
      throw error;
    }
  }
  async deployERC1155(deploy1155Params) {
    elizaLogger6.debug("Deploying ERC1155 token with params:", JSON.stringify(deploy1155Params, null, 2));
    const { baseURI, name, chain } = deploy1155Params;
    if (!name || name === "") {
      elizaLogger6.error("Token name is required");
      throw new Error("Token name is required");
    }
    if (!baseURI || baseURI === "") {
      elizaLogger6.error("Token baseURI is required");
      throw new Error("Token baseURI is required");
    }
    elizaLogger6.debug(`Deploying ERC1155 token: ${name} with baseURI ${baseURI}`);
    try {
      const args = [name, baseURI];
      elizaLogger6.debug(`Contract constructor arguments:`, args);
      elizaLogger6.debug(`Deploying ERC1155 contract on chain ${chain}...`);
      const contractAddress = await this.deployContract(
        chain,
        "ERC1155Contract",
        args
      );
      if (!contractAddress) {
        elizaLogger6.error("Failed to deploy ERC1155 contract - no address returned");
        throw new Error("Failed to deploy ERC1155 contract");
      }
      elizaLogger6.debug(`ERC1155 contract deployed successfully at address: ${contractAddress}`);
      return {
        address: contractAddress
      };
    } catch (error) {
      elizaLogger6.error("Deploy ERC1155 failed:", error.message);
      throw error;
    }
  }
  async deployContract(chain, contractName, args) {
    elizaLogger6.debug(`Starting contract deployment process for ${contractName} on chain ${chain}`);
    try {
      elizaLogger6.debug(`Compiling ${contractName}...`);
      const { abi, bytecode } = await compileSolidity(contractName);
      if (!abi) {
        elizaLogger6.error(`No ABI found for ${contractName}`);
        throw new Error(`Compilation failed: No ABI found for ${contractName}`);
      }
      if (!bytecode) {
        elizaLogger6.error(`No bytecode found for ${contractName}`);
        throw new Error("Bytecode is empty after compilation");
      }
      elizaLogger6.debug(`Compilation successful, bytecode length: ${bytecode.length}`);
      elizaLogger6.debug(`Switching to chain ${chain} for deployment`);
      this.walletProvider.switchChain(chain);
      const chainConfig = this.walletProvider.getChainConfigs(chain);
      elizaLogger6.debug(`Using chain config: ${chainConfig.name} (ID: ${chainConfig.id})`);
      const walletClient = this.walletProvider.getWalletClient(chain);
      const account = this.walletProvider.getAccount();
      elizaLogger6.debug(`Deploying from account: ${account.address}`);
      const publicClient = this.walletProvider.getPublicClient(chain);
      elizaLogger6.debug(`Submitting deployment transaction...`);
      const hash = await walletClient.deployContract({
        account,
        abi,
        bytecode,
        args,
        chain: chainConfig
      });
      elizaLogger6.debug(`Deployment transaction submitted with hash: ${hash}`);
      elizaLogger6.debug(`Waiting for deployment transaction confirmation...`);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash
      });
      if (receipt.status === "success") {
        elizaLogger6.debug(`Contract deployed successfully at address: ${receipt.contractAddress}`);
      } else {
        elizaLogger6.error(`Deployment transaction failed with status: ${receipt.status}`);
        throw new Error("Contract deployment transaction failed");
      }
      return receipt.contractAddress;
    } catch (error) {
      elizaLogger6.error(`Error deploying contract ${contractName}:`, error);
      if (error.message.includes("insufficient funds")) {
        throw new Error(`Insufficient funds to deploy the contract. Please check your balance.`);
      } else if (error.message.includes("user rejected")) {
        throw new Error("Transaction rejected by user.");
      }
      throw error;
    }
  }
};
var deployAction = {
  name: "deploy_token",
  description: "Deploy token contracts (ERC20/721/1155) based on user specifications",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger6.log("Starting deploy action...");
    elizaLogger6.debug("Message content:", JSON.stringify(message.content, null, 2));
    const promptText = typeof message.content.text === "string" ? message.content.text.trim() : "";
    elizaLogger6.debug(`Raw prompt text: "${promptText}"`);
    const promptLower = promptText.toLowerCase();
    const erc20Regex = /(?:deploy|create)\s+(?:an?\s+)?(?:erc20|token)(?:\s+token)?\s+(?:with|having|named)?\s+(?:name\s+['"]?([^'"]+)['"]?|['"]?([^'"]+)['"]?\s+token)/i;
    const erc721Regex = /(?:deploy|create)\s+(?:an?\s+)?(?:erc721|nft)(?:\s+token)?\s+(?:with|having|named)?\s+(?:name\s+['"]?([^'"]+)['"]?|['"]?([^'"]+)['"]?\s+nft)/i;
    const erc1155Regex = /(?:deploy|create)\s+(?:an?\s+)?(?:erc1155|multi-token)(?:\s+token)?\s+(?:with|having|named)?\s+(?:name\s+['"]?([^'"]+)['"]?|['"]?([^'"]+)['"]?\s+token)/i;
    const symbolRegex = /symbol\s+['"]?([^'"]+)['"]?/i;
    const decimalsRegex = /decimals\s+([0-9]+)/i;
    const totalSupplyRegex = /(?:total\s+supply|supply)\s+([0-9]+(?:\.[0-9]+)?(?:\s*[kmbt])?)/i;
    const baseURIRegex = /(?:base\s*uri|baseuri|uri)\s+['"]?(https?:\/\/[^'"]+)['"]?/i;
    let directContractType = null;
    let directName = null;
    let directSymbol = null;
    let directDecimals = null;
    let directTotalSupply = null;
    let directBaseURI = null;
    let directChain = null;
    let match = promptText.match(erc20Regex);
    if (match) {
      directContractType = "erc20";
      directName = match[1] || match[2] || null;
      elizaLogger6.debug(`Detected ERC20 token deployment with name: ${directName}`);
    }
    if (!directContractType) {
      match = promptText.match(erc721Regex);
      if (match) {
        directContractType = "erc721";
        directName = match[1] || match[2] || null;
        elizaLogger6.debug(`Detected ERC721 NFT deployment with name: ${directName}`);
      }
    }
    if (!directContractType) {
      match = promptText.match(erc1155Regex);
      if (match) {
        directContractType = "erc1155";
        directName = match[1] || match[2] || null;
        elizaLogger6.debug(`Detected ERC1155 token deployment with name: ${directName}`);
      }
    }
    if (!directContractType) {
      if (promptLower.includes("erc20") || promptLower.includes("fungible token")) {
        directContractType = "erc20";
        elizaLogger6.debug("Detected ERC20 token deployment from keywords");
      } else if (promptLower.includes("erc721") || promptLower.includes("nft") || promptLower.includes("non-fungible")) {
        directContractType = "erc721";
        elizaLogger6.debug("Detected ERC721 token deployment from keywords");
      } else if (promptLower.includes("erc1155") || promptLower.includes("multi") || promptLower.includes("1155")) {
        directContractType = "erc1155";
        elizaLogger6.debug("Detected ERC1155 token deployment from keywords");
      }
    }
    match = promptText.match(symbolRegex);
    if (match && match.length >= 2) {
      directSymbol = match[1].trim();
      elizaLogger6.debug(`Extracted token symbol: ${directSymbol}`);
    }
    match = promptText.match(decimalsRegex);
    if (match && match.length >= 2) {
      directDecimals = parseInt(match[1], 10);
      elizaLogger6.debug(`Extracted token decimals: ${directDecimals}`);
    }
    match = promptText.match(totalSupplyRegex);
    if (match && match.length >= 2) {
      directTotalSupply = match[1].trim();
      if (directTotalSupply.endsWith("k") || directTotalSupply.endsWith("K")) {
        directTotalSupply = (parseFloat(directTotalSupply) * 1e3).toString();
      } else if (directTotalSupply.endsWith("m") || directTotalSupply.endsWith("M")) {
        directTotalSupply = (parseFloat(directTotalSupply) * 1e6).toString();
      } else if (directTotalSupply.endsWith("b") || directTotalSupply.endsWith("B")) {
        directTotalSupply = (parseFloat(directTotalSupply) * 1e9).toString();
      } else if (directTotalSupply.endsWith("t") || directTotalSupply.endsWith("T")) {
        directTotalSupply = (parseFloat(directTotalSupply) * 1e12).toString();
      }
      elizaLogger6.debug(`Extracted token total supply: ${directTotalSupply}`);
    }
    match = promptText.match(baseURIRegex);
    if (match && match.length >= 2) {
      directBaseURI = match[1].trim();
      elizaLogger6.debug(`Extracted token baseURI: ${directBaseURI}`);
    }
    if (promptLower.includes("bsc") || promptLower.includes("binance")) {
      directChain = "bsc";
      elizaLogger6.debug("Detected BSC chain from prompt");
    } else if (promptLower.includes("opbnb") || promptLower.includes("op bnb")) {
      directChain = "opBNB";
      elizaLogger6.debug("Detected opBNB chain from prompt");
    }
    const promptAnalysis = {
      directContractType,
      directName,
      directSymbol,
      directDecimals,
      directTotalSupply,
      directBaseURI,
      directChain
    };
    elizaLogger6.debug("Prompt analysis result:", promptAnalysis);
    let currentState = state;
    if (!currentState) {
      currentState = await runtime.composeState(message);
    } else {
      currentState = await runtime.updateRecentMessageState(currentState);
    }
    try {
      elizaLogger6.debug("Getting wallet info...");
      state.walletInfo = await bnbWalletProvider.get(runtime, message, currentState);
      elizaLogger6.debug("Wallet info retrieved:", state.walletInfo);
    } catch (error) {
      elizaLogger6.error("Error getting wallet info:", error.message);
      callback?.({
        text: `Unable to access wallet: ${error.message}`,
        content: { error: error.message }
      });
      return false;
    }
    elizaLogger6.debug("Composing contract template context...");
    const context = composeContext4({
      state: currentState,
      template: ercContractTemplate
    });
    elizaLogger6.debug("Generating contract parameters via model...");
    const content = await generateObjectDeprecated4({
      runtime,
      context,
      modelClass: ModelClass4.LARGE
    });
    elizaLogger6.debug("Generated contract content:", JSON.stringify(content, null, 2));
    let contractType;
    if (directContractType) {
      contractType = directContractType;
      elizaLogger6.debug(`Using contract type directly extracted from prompt: ${contractType}`);
    } else if (content.contractType) {
      contractType = content.contractType.toLowerCase();
      elizaLogger6.debug(`Using contract type from generated content: ${contractType}`);
    } else {
      contractType = "erc20";
      elizaLogger6.debug(`No contract type detected, defaulting to ${contractType}`);
    }
    let chain = "bsc";
    if (directChain) {
      chain = directChain;
      elizaLogger6.debug(`Using chain directly extracted from prompt: ${chain}`);
    } else if (content.chain) {
      chain = content.chain;
      elizaLogger6.debug(`Using chain from generated content: ${chain}`);
    } else {
      elizaLogger6.debug(`No chain detected, defaulting to ${chain}`);
    }
    elizaLogger6.debug("Initializing wallet provider...");
    const walletProvider = initWalletProvider(runtime);
    const action = new DeployAction(walletProvider);
    try {
      elizaLogger6.debug(`Starting deployment process for ${contractType.toUpperCase()} contract on ${chain}...`);
      let result;
      switch (contractType.toLowerCase()) {
        case "erc20":
          const name = directName || content.name || "DefaultToken";
          const symbol = directSymbol || content.symbol || "DTK";
          const decimals = directDecimals || content.decimals || 18;
          const totalSupply = directTotalSupply || content.totalSupply || "1000000";
          elizaLogger6.debug(`Deploying ERC20 with params: name=${name}, symbol=${symbol}, decimals=${decimals}, totalSupply=${totalSupply}`);
          result = await action.deployERC20({
            chain,
            decimals,
            symbol,
            name,
            totalSupply
          });
          break;
        case "erc721":
          const nftName = directName || content.name || "DefaultNFT";
          const nftSymbol = directSymbol || content.symbol || "DNFT";
          const nftBaseURI = directBaseURI || content.baseURI || "https://example.com/token/";
          elizaLogger6.debug(`Deploying ERC721 with params: name=${nftName}, symbol=${nftSymbol}, baseURI=${nftBaseURI}`);
          result = await action.deployERC721({
            chain,
            name: nftName,
            symbol: nftSymbol,
            baseURI: nftBaseURI
          });
          break;
        case "erc1155":
          const multiName = directName || content.name || "DefaultMultiToken";
          const multiBaseURI = directBaseURI || content.baseURI || "https://example.com/multi-token/";
          elizaLogger6.debug(`Deploying ERC1155 with params: name=${multiName}, baseURI=${multiBaseURI}`);
          result = await action.deployERC1155({
            chain,
            name: multiName,
            baseURI: multiBaseURI
          });
          break;
        default:
          elizaLogger6.error(`Unsupported contract type: ${contractType}`);
          throw new Error(`Unsupported contract type: ${contractType}. Supported types are: erc20, erc721, erc1155`);
      }
      if (result && result.address) {
        elizaLogger6.debug(`Contract deployed successfully at address: ${result.address}`);
        const contractTypeName = contractType.toUpperCase();
        const chainName = chain === "bsc" ? "Binance Smart Chain" : "opBNB";
        callback?.({
          text: `Successfully deployed ${contractTypeName} contract on ${chainName} at address: ${result.address}`,
          content: {
            ...result,
            contractType,
            chain
          }
        });
      } else {
        elizaLogger6.error("Contract deployment failed - no address returned");
        callback?.({
          text: "Contract deployment failed",
          content: { error: "No contract address returned" }
        });
      }
      return true;
    } catch (error) {
      elizaLogger6.error("Error during contract deployment:", error.message);
      try {
        elizaLogger6.error("Full error details:", JSON.stringify(error, null, 2));
      } catch (e) {
        elizaLogger6.error("Error object not serializable, logging properties individually:");
        for (const key in error) {
          try {
            elizaLogger6.error(`${key}:`, error[key]);
          } catch (e2) {
            elizaLogger6.error(`${key}: [Error serializing property]`);
          }
        }
      }
      let errorMessage = error.message;
      if (error.message.includes("insufficient funds")) {
        errorMessage = `Insufficient funds for contract deployment. Please check your wallet balance.`;
      } else if (error.message.includes("user rejected")) {
        errorMessage = `Transaction was rejected. Please try again if you want to proceed with the deployment.`;
      } else if (error.message.includes("compilation failed")) {
        errorMessage = `Contract compilation failed. This might be due to syntax errors in the contract code.`;
      }
      callback?.({
        text: `Deployment failed: ${errorMessage}`,
        content: {
          error: errorMessage,
          contractType
        }
      });
      return false;
    }
  },
  template: ercContractTemplate,
  validate: async (_runtime) => {
    return true;
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Deploy an ERC20 token with name 'elizayolo', symbol 'ELIYOYO', decimals 18, total supply 10000",
          action: "DEPLOY_TOKEN"
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Deploy an ERC721 NFT contract with name 'MyNFT', symbol 'MNFT', baseURI 'https://my-nft-base-uri.com'",
          action: "DEPLOY_TOKEN"
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Deploy an ERC1155 contract with name 'My1155', baseURI 'https://my-1155-base-uri.com'",
          action: "DEPLOY_TOKEN"
        }
      }
    ]
  ],
  similes: [
    "DEPLOY_ERC20",
    "DEPLOY_ERC721",
    "DEPLOY_ERC1155",
    "CREATE_TOKEN",
    "CREATE_NFT",
    "CREATE_1155"
  ]
};

// ../../node_modules/.pnpm/zod@3.24.2/node_modules/zod/lib/index.mjs
var util;
(function(util2) {
  util2.assertEqual = (val) => val;
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
        fieldErrors[sub.path[0]].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var overrideErrorMap = errorMap;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}
var makeIssue = (params) => {
  const { data, path: path2, errorMaps, issueData } = params;
  const fullPath = [...path2, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === errorMap ? void 0 : errorMap
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;
function __classPrivateFieldGet(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
function __classPrivateFieldSet(receiver, state, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
}
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message === null || message === void 0 ? void 0 : message.message;
})(errorUtil || (errorUtil = {}));
var _ZodEnum_cache;
var _ZodNativeEnum_cache;
var ParseInputLazyPath = class {
  constructor(parent, value, path2, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path2;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (this._key instanceof Array) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    var _a, _b;
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message !== null && message !== void 0 ? message : ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: (_a = message !== null && message !== void 0 ? message : required_error) !== null && _a !== void 0 ? _a : ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: (_b = message !== null && message !== void 0 ? message : invalid_type_error) !== null && _b !== void 0 ? _b : ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    var _a;
    const ctx = {
      common: {
        issues: [],
        async: (_a = params === null || params === void 0 ? void 0 : params.async) !== null && _a !== void 0 ? _a : false,
        contextualErrorMap: params === null || params === void 0 ? void 0 : params.errorMap
      },
      path: (params === null || params === void 0 ? void 0 : params.path) || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    var _a, _b;
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if ((_b = (_a = err === null || err === void 0 ? void 0 : err.message) === null || _a === void 0 ? void 0 : _a.toLowerCase()) === null || _b === void 0 ? void 0 : _b.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params === null || params === void 0 ? void 0 : params.errorMap,
        async: true
      },
      path: (params === null || params === void 0 ? void 0 : params.path) || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let regex = `([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d`;
  if (args.precision) {
    regex = `${regex}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    regex = `${regex}(\\.\\d+)?`;
  }
  return regex;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if (!decoded.typ || !decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch (_a) {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch (_a) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    var _a, _b;
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof (options === null || options === void 0 ? void 0 : options.precision) === "undefined" ? null : options === null || options === void 0 ? void 0 : options.precision,
      offset: (_a = options === null || options === void 0 ? void 0 : options.offset) !== null && _a !== void 0 ? _a : false,
      local: (_b = options === null || options === void 0 ? void 0 : options.local) !== null && _b !== void 0 ? _b : false,
      ...errorUtil.errToObj(options === null || options === void 0 ? void 0 : options.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof (options === null || options === void 0 ? void 0 : options.precision) === "undefined" ? null : options === null || options === void 0 ? void 0 : options.precision,
      ...errorUtil.errToObj(options === null || options === void 0 ? void 0 : options.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options === null || options === void 0 ? void 0 : options.position,
      ...errorUtil.errToObj(options === null || options === void 0 ? void 0 : options.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  var _a;
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: (_a = params === null || params === void 0 ? void 0 : params.coerce) !== null && _a !== void 0 ? _a : false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / Math.pow(10, decCount);
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null, min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: (params === null || params === void 0 ? void 0 : params.coerce) || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch (_a) {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  var _a;
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: (_a = params === null || params === void 0 ? void 0 : params.coerce) !== null && _a !== void 0 ? _a : false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: (params === null || params === void 0 ? void 0 : params.coerce) || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: (params === null || params === void 0 ? void 0 : params.coerce) || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    return this._cached = { shape, keys };
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") ;
      else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          var _a, _b, _c, _d;
          const defaultError = (_c = (_b = (_a = this._def).errorMap) === null || _b === void 0 ? void 0 : _b.call(_a, issue, ctx).message) !== null && _c !== void 0 ? _c : ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: (_d = errorUtil.errToObj(message).message) !== null && _d !== void 0 ? _d : defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    util.objectKeys(mask).forEach((key) => {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    });
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    util.objectKeys(this.shape).forEach((key) => {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    });
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    util.objectKeys(this.shape).forEach((key) => {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    });
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    util.objectKeys(this.shape).forEach((key) => {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    });
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [
          ctx.common.contextualErrorMap,
          ctx.schemaErrorMap,
          getErrorMap(),
          errorMap
        ].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [
          ctx.common.contextualErrorMap,
          ctx.schemaErrorMap,
          getErrorMap(),
          errorMap
        ].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  constructor() {
    super(...arguments);
    _ZodEnum_cache.set(this, void 0);
  }
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!__classPrivateFieldGet(this, _ZodEnum_cache, "f")) {
      __classPrivateFieldSet(this, _ZodEnum_cache, new Set(this._def.values), "f");
    }
    if (!__classPrivateFieldGet(this, _ZodEnum_cache, "f").has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
_ZodEnum_cache = /* @__PURE__ */ new WeakMap();
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  constructor() {
    super(...arguments);
    _ZodNativeEnum_cache.set(this, void 0);
  }
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!__classPrivateFieldGet(this, _ZodNativeEnum_cache, "f")) {
      __classPrivateFieldSet(this, _ZodNativeEnum_cache, new Set(util.getValidEnumValues(this._def.values)), "f");
    }
    if (!__classPrivateFieldGet(this, _ZodNativeEnum_cache, "f").has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
_ZodNativeEnum_cache = /* @__PURE__ */ new WeakMap();
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return base;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return base;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({ status: status.value, value: result }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      var _a, _b;
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          var _a2, _b2;
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = (_b2 = (_a2 = params.fatal) !== null && _a2 !== void 0 ? _a2 : fatal) !== null && _b2 !== void 0 ? _b2 : true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = (_b = (_a = params.fatal) !== null && _a !== void 0 ? _a : fatal) !== null && _b !== void 0 ? _b : true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: (arg) => ZodString.create({ ...arg, coerce: true }),
  number: (arg) => ZodNumber.create({ ...arg, coerce: true }),
  boolean: (arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  }),
  bigint: (arg) => ZodBigInt.create({ ...arg, coerce: true }),
  date: (arg) => ZodDate.create({ ...arg, coerce: true })
};
var NEVER = INVALID;
var z = /* @__PURE__ */ Object.freeze({
  __proto__: null,
  defaultErrorMap: errorMap,
  setErrorMap,
  getErrorMap,
  makeIssue,
  EMPTY_PATH,
  addIssueToContext,
  ParseStatus,
  INVALID,
  DIRTY,
  OK,
  isAborted,
  isDirty,
  isValid,
  isAsync,
  get util() {
    return util;
  },
  get objectUtil() {
    return objectUtil;
  },
  ZodParsedType,
  getParsedType,
  ZodType,
  datetimeRegex,
  ZodString,
  ZodNumber,
  ZodBigInt,
  ZodBoolean,
  ZodDate,
  ZodSymbol,
  ZodUndefined,
  ZodNull,
  ZodAny,
  ZodUnknown,
  ZodNever,
  ZodVoid,
  ZodArray,
  ZodObject,
  ZodUnion,
  ZodDiscriminatedUnion,
  ZodIntersection,
  ZodTuple,
  ZodRecord,
  ZodMap,
  ZodSet,
  ZodFunction,
  ZodLazy,
  ZodLiteral,
  ZodEnum,
  ZodNativeEnum,
  ZodPromise,
  ZodEffects,
  ZodTransformer: ZodEffects,
  ZodOptional,
  ZodNullable,
  ZodDefault,
  ZodCatch,
  ZodNaN,
  BRAND,
  ZodBranded,
  ZodPipeline,
  ZodReadonly,
  custom,
  Schema: ZodType,
  ZodSchema: ZodType,
  late,
  get ZodFirstPartyTypeKind() {
    return ZodFirstPartyTypeKind;
  },
  coerce,
  any: anyType,
  array: arrayType,
  bigint: bigIntType,
  boolean: booleanType,
  date: dateType,
  discriminatedUnion: discriminatedUnionType,
  effect: effectsType,
  "enum": enumType,
  "function": functionType,
  "instanceof": instanceOfType,
  intersection: intersectionType,
  lazy: lazyType,
  literal: literalType,
  map: mapType,
  nan: nanType,
  nativeEnum: nativeEnumType,
  never: neverType,
  "null": nullType,
  nullable: nullableType,
  number: numberType,
  object: objectType,
  oboolean,
  onumber,
  optional: optionalType,
  ostring,
  pipeline: pipelineType,
  preprocess: preprocessType,
  promise: promiseType,
  record: recordType,
  set: setType,
  strictObject: strictObjectType,
  string: stringType,
  symbol: symbolType,
  transformer: effectsType,
  tuple: tupleType,
  "undefined": undefinedType,
  union: unionType,
  unknown: unknownType,
  "void": voidType,
  NEVER,
  ZodIssueCode,
  quotelessJson,
  ZodError
});

// src/environment.ts
var DEFAULT_BSC_PROVIDER_URL = "https://bsc-mainnet.nodereal.io/v1/64a9df0874fb4a93b9d0a3849de012d3";
var DEFAULT_BSC_TESTNET_PROVIDER_URL = "https://data-seed-prebsc-2-s3.bnbchain.org:8545";
var DEFAULT_OPBNB_PROVIDER_URL = "https://opbnb-mainnet-rpc.bnbchain.org";
var bnbEnvSchema = z.object({
  BNB_PRIVATE_KEY: z.string().optional(),
  BNB_PUBLIC_KEY: z.string().optional(),
  BSC_PROVIDER_URL: z.string().default(DEFAULT_BSC_PROVIDER_URL),
  BSC_TESTNET_PROVIDER_URL: z.string().default(DEFAULT_BSC_TESTNET_PROVIDER_URL),
  OPBNB_PROVIDER_URL: z.string().default(DEFAULT_OPBNB_PROVIDER_URL)
});
function getConfig() {
  return {
    BNB_PRIVATE_KEY: process.env.BNB_PRIVATE_KEY,
    BNB_PUBLIC_KEY: process.env.BNB_PUBLIC_KEY,
    BSC_PROVIDER_URL: process.env.BSC_PROVIDER_URL || DEFAULT_BSC_PROVIDER_URL,
    BSC_TESTNET_PROVIDER_URL: process.env.BSC_TESTNET_PROVIDER_URL || DEFAULT_BSC_TESTNET_PROVIDER_URL,
    OPBNB_PROVIDER_URL: process.env.OPBNB_PROVIDER_URL || DEFAULT_OPBNB_PROVIDER_URL
  };
}
async function validateBnbConfig(runtime) {
  try {
    const config = {
      BNB_PRIVATE_KEY: runtime.getSetting("BNB_PRIVATE_KEY") || process.env.BNB_PRIVATE_KEY,
      BNB_PUBLIC_KEY: runtime.getSetting("BNB_PUBLIC_KEY") || process.env.BNB_PUBLIC_KEY,
      BSC_PROVIDER_URL: runtime.getSetting("BSC_PROVIDER_URL") || process.env.BSC_PROVIDER_URL || DEFAULT_BSC_PROVIDER_URL,
      BSC_TESTNET_PROVIDER_URL: runtime.getSetting("BSC_TESTNET_PROVIDER_URL") || process.env.BSC_TESTNET_PROVIDER_URL || DEFAULT_BSC_TESTNET_PROVIDER_URL,
      OPBNB_PROVIDER_URL: runtime.getSetting("OPBNB_PROVIDER_URL") || process.env.OPBNB_PROVIDER_URL || DEFAULT_OPBNB_PROVIDER_URL
    };
    return bnbEnvSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join("\n");
      throw new Error(
        `BNB configuration validation failed:
${errorMessages}`
      );
    }
    throw error;
  }
}
function hasWalletConfigured(config) {
  return !!(config.BNB_PRIVATE_KEY || config.BNB_PUBLIC_KEY);
}

// src/actions/getBalanceTestnet.ts
import {
  composeContext as composeContext5,
  elizaLogger as elizaLogger7,
  generateObjectDeprecated as generateObjectDeprecated5,
  ModelClass as ModelClass5
} from "@elizaos/core";
import { erc20Abi as erc20Abi4, formatEther as formatEther2, formatUnits as formatUnits3, isAddress } from "viem";
var SUPPORTED_TESTNET_TOKENS = ["BNB", "BUSD", "DAI", "ETH", "USDC"];
var TESTNET_TOKEN_ADDRESSES = {
  "BNB": "0x64544969ed7EBf5f083679233325356EbE738930",
  "BUSD": "0x48D87A2d14De41E2308A764905B93E05c9377cE1",
  "DAI": "0x46B48c1Ef4B5F15B7DdC415290CEC2f774cD1021",
  "ETH": "0x635780E5D02Ab29d7aE14d266936A38d3D5B0CC5",
  "USDC": "0x053Fc65249dF91a02Ddb294A081f774615aB45F4"
};
elizaLogger7.debug("TESTNET TOKEN ADDRESSES:", TESTNET_TOKEN_ADDRESSES);
var GetBalanceTestnetAction = class {
  constructor(walletProvider) {
    this.walletProvider = walletProvider;
    elizaLogger7.debug(
      "GetBalanceTestnetAction initialized with provider:",
      { providerType: walletProvider.constructor.name }
    );
  }
  // Helper function to clean and validate token address
  normalizeTokenAddress(address) {
    const cleanedAddress = address.trim().toLowerCase();
    const isValidFormat = /^0x[0-9a-f]{40}$/i.test(cleanedAddress);
    if (!isValidFormat) {
      elizaLogger7.error(`Invalid token address format: ${address}`);
      return null;
    }
    return cleanedAddress;
  }
  // Debug helper to check chain and token information
  async debugChainAndToken(chain, token) {
    try {
      const chainConfig = this.walletProvider.getChainConfigs(chain);
      elizaLogger7.debug(`Chain config for ${chain}:`, {
        id: chainConfig.id,
        name: chainConfig.name,
        nativeCurrency: chainConfig.nativeCurrency,
        rpcUrls: chainConfig.rpcUrls
      });
      if (token) {
        if (token.startsWith("0x") && token.length === 42) {
          try {
            const publicClient = this.walletProvider.getPublicClient(chain);
            elizaLogger7.debug(
              `Public client for ${chain}:`,
              { clientType: publicClient.constructor.name }
            );
            elizaLogger7.debug(`Attempting to read token contract at ${token}`);
            const decimals = await publicClient.readContract({
              address: token,
              abi: erc20Abi4,
              functionName: "decimals"
            }).catch((e) => {
              elizaLogger7.debug(`Failed to get decimals for token ${token}:`, e.message);
              return null;
            });
            const symbol = await publicClient.readContract({
              address: token,
              abi: erc20Abi4,
              functionName: "symbol"
            }).catch((e) => {
              elizaLogger7.debug(`Failed to get symbol for token ${token}:`, e.message);
              return null;
            });
            elizaLogger7.debug(`Token information for ${token}:`, {
              symbol,
              decimals
            });
          } catch (error) {
            elizaLogger7.error(`Error getting token info:`, error.message, error.stack);
          }
        } else {
          const upperToken = token.toUpperCase();
          const mappedAddress = TESTNET_TOKEN_ADDRESSES[upperToken];
          elizaLogger7.debug(`Token symbol ${token} maps to address:`, mappedAddress || "Not found in mapping");
          if (!mappedAddress) {
            elizaLogger7.error(
              `Token ${token} not found in mapping. Available tokens:`,
              Object.keys(TESTNET_TOKEN_ADDRESSES)
            );
          }
        }
      }
    } catch (error) {
      elizaLogger7.error("Error in debugChainAndToken:", error.message, error.stack);
    }
  }
  // Debug helper to directly check balance via BSCScan API
  async checkBalanceViaBscScan(address) {
    try {
      elizaLogger7.debug(`Checking balance via BSCScan API for address: ${address}`);
      const url = `https://api-testnet.bscscan.com/api?module=account&action=balance&address=${address}&tag=latest`;
      elizaLogger7.debug(`Fetching from URL: ${url}`);
      const response = await fetch(url);
      const data = await response.json();
      elizaLogger7.debug(`BSCScan API response:`, data);
      if (data.status === "1" && data.message === "OK") {
        const weiBalance = data.result;
        const ethBalance = formatEther2(BigInt(weiBalance));
        elizaLogger7.debug(`BSCScan reports balance: ${ethBalance} BNB`);
        return ethBalance;
      } else {
        elizaLogger7.error(`BSCScan API error: ${data.message}`);
        return null;
      }
    } catch (error) {
      elizaLogger7.error(`Error checking BSCScan balance: ${error.message}`);
      return null;
    }
  }
  async getBalance(params) {
    elizaLogger7.debug("Get testnet balance params:", params);
    await this.validateAndNormalizeParams(params);
    elizaLogger7.debug("Normalized get testnet balance params:", params);
    params.chain = "bscTestnet";
    await this.debugChainAndToken("bscTestnet", params.token);
    const { chain, address, token } = params;
    if (!address) {
      elizaLogger7.error("Address is required but was not provided");
      throw new Error("Address is required for getting balance");
    }
    elizaLogger7.debug(`Switching to chain: ${chain}`);
    this.walletProvider.switchChain(chain);
    const nativeSymbol = this.walletProvider.getChainConfigs(chain).nativeCurrency.symbol;
    elizaLogger7.debug(`Native symbol for chain ${chain}: ${nativeSymbol}`);
    let queryNativeToken = false;
    if (!token || token === "" || token.toLowerCase() === "bnb" || token.toLowerCase() === "tbnb") {
      elizaLogger7.debug(`Will query native token (${nativeSymbol}) balance`);
      queryNativeToken = true;
    }
    const resp = {
      chain,
      address
    };
    if (!queryNativeToken) {
      let tokenAddress;
      if (isAddress(token)) {
        elizaLogger7.debug(`Token is already an address: ${token}`);
        const normalizedAddress = this.normalizeTokenAddress(token);
        if (!normalizedAddress) {
          throw new Error(`Invalid token address format: ${token}. Please provide a valid token address or symbol.`);
        }
        tokenAddress = normalizedAddress;
      } else {
        const upperToken = token.toUpperCase();
        elizaLogger7.debug(`Looking up token symbol in testnet mapping: ${upperToken}`);
        const mappedAddress = this.walletProvider.getTestnetTokenAddress(upperToken);
        if (!mappedAddress) {
          elizaLogger7.error(`Token ${token} not found in testnet mapping`);
          throw new Error(`Token ${token} is not supported on BSC testnet. Supported tokens: ${SUPPORTED_TESTNET_TOKENS.join(", ")}`);
        }
        tokenAddress = mappedAddress;
        elizaLogger7.debug(`Resolved token symbol ${token} to address: ${tokenAddress}`);
      }
      elizaLogger7.debug(`Getting ERC20 balance for address ${address} and token ${tokenAddress}`);
      try {
        const amount = await this.getERC20TokenBalance(
          chain,
          address,
          tokenAddress
        );
        elizaLogger7.debug(`ERC20 balance result: ${amount} ${token}`);
        resp.balance = { token, amount };
      } catch (error) {
        elizaLogger7.error(`Error getting ERC20 balance: ${error.message}`, error.stack);
        throw error;
      }
    } else {
      elizaLogger7.debug(`Getting native token balance for address ${address}`);
      try {
        const publicClient = this.walletProvider.getPublicClient(chain);
        const chainConfig = this.walletProvider.getChainConfigs(chain);
        elizaLogger7.debug(`Using RPC URL for chain ${chain}:`, {
          defaultRpc: chainConfig.rpcUrls.default.http[0],
          customRpc: chainConfig.rpcUrls.custom?.http[0],
          usingCustom: !!chainConfig.rpcUrls.custom
        });
        const chainId = await publicClient.getChainId().catch((e) => {
          elizaLogger7.error(`Failed to get chain ID: ${e.message}`);
          return null;
        });
        elizaLogger7.debug(`Connected to chain ID: ${chainId}, expected: ${chainConfig.id}`);
        elizaLogger7.debug(`Requesting balance for address: ${address}`);
        const nativeBalanceWei = await publicClient.getBalance({ address });
        elizaLogger7.debug(`Raw balance result (Wei): ${nativeBalanceWei.toString()}`);
        const formattedBalance = formatEther2(nativeBalanceWei);
        elizaLogger7.debug(`Formatted balance: ${formattedBalance} ${nativeSymbol}`);
        if (nativeBalanceWei === 0n) {
          elizaLogger7.debug(`Balance is 0, double-checking with BSCScan API`);
          const bscScanBalance = await this.checkBalanceViaBscScan(address);
          if (bscScanBalance && parseFloat(bscScanBalance) > 0) {
            elizaLogger7.debug(`BSCScan reports non-zero balance: ${bscScanBalance} BNB`);
            resp.balance = {
              token: nativeSymbol,
              amount: bscScanBalance
            };
            return resp;
          }
        }
        resp.balance = {
          token: nativeSymbol,
          amount: formattedBalance
        };
      } catch (error) {
        elizaLogger7.error(`Error getting native balance: ${error.message}`, error.stack);
        elizaLogger7.debug(`Trying BSCScan API as fallback`);
        const bscScanBalance = await this.checkBalanceViaBscScan(address);
        if (bscScanBalance) {
          elizaLogger7.debug(`BSCScan reports balance: ${bscScanBalance} BNB`);
          resp.balance = {
            token: nativeSymbol,
            amount: bscScanBalance
          };
          return resp;
        }
        throw error;
      }
    }
    elizaLogger7.debug(`Get balance response:`, resp);
    return resp;
  }
  async getERC20TokenBalance(chain, address, tokenAddress) {
    try {
      elizaLogger7.debug(`Getting ERC20 token balance for address ${address} and token ${tokenAddress} on chain ${chain}`);
      const publicClient = this.walletProvider.getPublicClient(chain);
      elizaLogger7.debug(`Public client for chain ${chain}:`, {
        clientType: publicClient.constructor.name
      });
      elizaLogger7.debug(`Reading balanceOf for token ${tokenAddress}`);
      let balance;
      try {
        balance = await publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi4,
          functionName: "balanceOf",
          args: [address]
        });
      } catch (e) {
        elizaLogger7.error(`Contract call to balanceOf failed: ${e.message}`);
        elizaLogger7.debug(`Contract error details:`, e);
        elizaLogger7.warn(`Token ${tokenAddress} might not exist on BSC testnet or isn't a valid ERC20 token`);
        return "0";
      }
      elizaLogger7.debug(`Raw balance result: ${balance.toString()}`);
      let decimals;
      try {
        decimals = await publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi4,
          functionName: "decimals"
        });
      } catch (e) {
        elizaLogger7.error(`Contract call to decimals failed: ${e.message}`);
        elizaLogger7.warn(`Defaulting to 18 decimals for token ${tokenAddress}`);
        decimals = 18;
      }
      elizaLogger7.debug(`Token decimals: ${decimals}`);
      const formattedBalance = formatUnits3(balance, decimals);
      elizaLogger7.debug(`Formatted balance: ${formattedBalance}`);
      return formattedBalance;
    } catch (error) {
      elizaLogger7.error(`Error getting ERC20 balance: ${error.message}`, error.stack);
      return "0";
    }
  }
  async validateAndNormalizeParams(params) {
    try {
      params.chain = "bscTestnet";
      if (!params.address) {
        params.address = this.walletProvider.getAddress();
        elizaLogger7.debug(`No address provided, using wallet address: ${params.address}`);
        return;
      }
      const addressStr = String(params.address);
      if (addressStr === "null" || addressStr === "undefined") {
        params.address = this.walletProvider.getAddress();
        elizaLogger7.debug(`Invalid address string provided, using wallet address: ${params.address}`);
        return;
      }
      if (addressStr.startsWith("0x") && addressStr.length === 42) {
        elizaLogger7.debug(`Using valid hex address: ${params.address}`);
        return;
      }
      const commonTokens = ["USDT", "USDC", "BNB", "ETH", "BUSD", "WBNB", "CAKE"];
      if (commonTokens.includes(addressStr.toUpperCase())) {
        elizaLogger7.debug(`Address looks like a token symbol: ${params.address}, using wallet address instead`);
        params.address = this.walletProvider.getAddress();
        return;
      }
      elizaLogger7.debug(`Web3Name resolution skipped on testnet for: ${params.address}`);
      if (addressStr.startsWith("0x")) {
        elizaLogger7.warn(`Address "${params.address}" doesn't look like a standard Ethereum address but will be used as is`);
        return;
      }
      elizaLogger7.warn(`Could not resolve address: ${params.address}, falling back to wallet address`);
      params.address = this.walletProvider.getAddress();
    } catch (error) {
      elizaLogger7.error(`Error validating address: ${error.message}`);
      params.address = this.walletProvider.getAddress();
    }
  }
};
var getBalanceTestnetAction = {
  name: "getBalanceTestnet",
  description: "Get testnet balance of a token on BSC for the given address",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger7.log("Starting getBalanceTestnet action...");
    try {
      const config = await validateBnbConfig(runtime);
      elizaLogger7.debug("BNB config:", {
        hasPrivateKey: !!config.BNB_PRIVATE_KEY,
        hasPublicKey: !!config.BNB_PUBLIC_KEY,
        bscTestnetUrl: config.BSC_TESTNET_PROVIDER_URL
      });
      elizaLogger7.debug(`Using BSC Testnet RPC URL: ${config.BSC_TESTNET_PROVIDER_URL}`);
      if (config.BSC_TESTNET_PROVIDER_URL === "https://data-seed-prebsc-2-s3.bnbchain.org:8545") {
        elizaLogger7.debug("Using default RPC URL. Consider using a more reliable one like https://data-seed-prebsc-2-s3.bnbchain.org:8545/");
      }
    } catch (error) {
      elizaLogger7.error("Failed to validate BNB config:", error.message);
    }
    let currentState = state;
    if (!currentState) {
      currentState = await runtime.composeState(message);
    } else {
      currentState = await runtime.updateRecentMessageState(currentState);
    }
    try {
      state.walletInfo = await bnbWalletProvider.get(
        runtime,
        message,
        currentState
      );
      elizaLogger7.debug("Wallet info:", state.walletInfo);
    } catch (error) {
      elizaLogger7.error("Error getting wallet info:", error.message, error.stack);
    }
    const getBalanceContext = composeContext5({
      state: currentState,
      template: getBalanceTemplate
    });
    elizaLogger7.debug("Generating content from template...");
    const content = await generateObjectDeprecated5({
      runtime,
      context: getBalanceContext,
      modelClass: ModelClass5.LARGE
    });
    elizaLogger7.debug("Generated content:", content);
    try {
      elizaLogger7.debug("Initializing wallet provider...");
      const walletProvider = initWalletProvider(runtime);
      const action = new GetBalanceTestnetAction(walletProvider);
      let tokenInput = content.token;
      const originalToken = tokenInput;
      elizaLogger7.debug(`Original token input: ${originalToken}`);
      if (tokenInput) {
        tokenInput = tokenInput.trim();
        if (tokenInput.startsWith("0x")) {
          const normalizedAddress = action.normalizeTokenAddress(tokenInput);
          if (normalizedAddress) {
            elizaLogger7.debug(`Using normalized token address: ${normalizedAddress}`);
            tokenInput = normalizedAddress;
          } else {
            const upperToken = tokenInput.replace(/^0x/i, "").toUpperCase();
            const mappedAddress = walletProvider.getTestnetTokenAddress(upperToken);
            if (mappedAddress) {
              elizaLogger7.debug(`Found token symbol in mapping despite 0x prefix: ${upperToken}`);
              tokenInput = mappedAddress;
            } else {
              if (callback) {
                callback({
                  text: `The token address "${tokenInput}" appears to be invalid. Please provide a valid token address or use one of the supported token symbols: ${SUPPORTED_TESTNET_TOKENS.join(", ")}`,
                  content: {
                    error: `Invalid token address: ${tokenInput}`,
                    chain: "bscTestnet",
                    supportedTokens: SUPPORTED_TESTNET_TOKENS
                  }
                });
              }
              return false;
            }
          }
        } else {
          const upperToken = tokenInput.toUpperCase();
          elizaLogger7.debug(`Looking up token symbol: ${upperToken}`);
          const mappedAddress = walletProvider.getTestnetTokenAddress(upperToken);
          if (mappedAddress) {
            elizaLogger7.debug(`Mapped token symbol ${tokenInput} to address: ${mappedAddress}`);
            tokenInput = mappedAddress;
          } else {
            elizaLogger7.error(`Token ${tokenInput} not found in mapping`);
            if (callback) {
              callback({
                text: `Token "${tokenInput}" is not supported on BSC testnet. Supported tokens: ${SUPPORTED_TESTNET_TOKENS.join(", ")}`,
                content: {
                  error: `Unsupported token: ${tokenInput}`,
                  chain: "bscTestnet",
                  supportedTokens: SUPPORTED_TESTNET_TOKENS
                }
              });
            }
            return false;
          }
        }
      } else {
        elizaLogger7.debug("No token specified, will use native token (BNB)");
      }
      const getBalanceOptions = {
        chain: "bscTestnet",
        // Force use of testnet
        address: content.address,
        token: tokenInput
      };
      elizaLogger7.debug("Balance options:", getBalanceOptions);
      try {
        elizaLogger7.debug(`Attempting to get balance for token: ${getBalanceOptions.token}`);
        if (typeof getBalanceOptions.token === "string" && getBalanceOptions.token.startsWith("0x") && getBalanceOptions.token.length === 42) {
          elizaLogger7.debug(`Using direct token address: ${getBalanceOptions.token}`);
        } else {
          elizaLogger7.debug(`Using previously mapped token address: ${getBalanceOptions.token}`);
        }
        const getBalanceResp = await action.getBalance(getBalanceOptions);
        elizaLogger7.debug("Balance response:", getBalanceResp);
        if (callback) {
          let text = `No balance found for ${getBalanceOptions.address} on BSC Testnet`;
          if (getBalanceResp.balance) {
            const displayToken = originalToken ? originalToken.toUpperCase() : "BNB";
            text = `Balance of ${getBalanceResp.address} on BSC Testnet:
${displayToken}: ${getBalanceResp.balance.amount}`;
          }
          elizaLogger7.debug("Callback response text:", text);
          callback({
            text,
            content: { ...getBalanceResp }
          });
        }
        return true;
      } catch (error) {
        elizaLogger7.error("Error during get testnet balance:", error.message, error.stack);
        let userMessage = `Error checking testnet balance on BSC Testnet: ${error.message}`;
        if (error.message.includes("getTldInfo") || error.message.includes("Only BSC mainnet supports looking up tokens")) {
          userMessage = `Could not find token "${originalToken || getBalanceOptions.token}" on BSC Testnet. Supported tokens: ${SUPPORTED_TESTNET_TOKENS.join(", ")}`;
        } else if (error.message.includes("No URL was provided")) {
          userMessage = "Network connection issue. Please check your BSC_TESTNET_PROVIDER_URL configuration.";
        } else if (error.message.includes("Invalid address")) {
          userMessage = "The address provided is invalid. Please provide a valid wallet address.";
        } else if (error.message.includes("not supported on BSC testnet")) {
          userMessage = error.message;
        } else if (error.message.includes("Contract 0x")) {
          userMessage = "Contract error. The token contract at the given address may not be valid on BSC testnet.";
        } else if (originalToken && originalToken.startsWith("0x")) {
          userMessage = `The token address "${originalToken}" could not be queried on BSC Testnet. Please check that it's a valid token contract address.`;
        }
        elizaLogger7.debug("Error user message:", userMessage);
        callback?.({
          text: userMessage,
          content: {
            error: error.message,
            chain: "bscTestnet",
            token: originalToken || getBalanceOptions.token,
            supportedTokens: SUPPORTED_TESTNET_TOKENS
          }
        });
        return false;
      }
    } catch (error) {
      elizaLogger7.error("Critical error in getBalanceTestnet handler:", error.message, error.stack);
      callback?.({
        text: `A critical error occurred while checking testnet balance: ${error.message}`,
        content: {
          error: error.message,
          chain: "bscTestnet"
        }
      });
      return false;
    }
  },
  template: getBalanceTemplate,
  validate: async (_runtime) => {
    return true;
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Check my testnet balance of BNB"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll help you check your balance of BNB on BSC Testnet",
          action: "GET_BALANCE_TESTNET",
          content: {
            chain: "bscTestnet",
            address: "{{walletAddress}}",
            token: "USDC"
          }
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Check my BNB balance on testnet"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll help you check your BNB balance on BSC Testnet",
          action: "GET_BALANCE_TESTNET",
          content: {
            chain: "bscTestnet",
            address: "{{walletAddress}}",
            token: "BNB"
          }
        }
      }
    ]
  ],
  similes: ["GET_BALANCE_TESTNET", "CHECK_TESTNET_BALANCE"]
};

// src/index.ts
import chalk from "chalk";
import Table from "cli-table3";
import ora from "ora";

// src/actions/getBalance.ts
import {
  composeContext as composeContext6,
  elizaLogger as elizaLogger8,
  generateObjectDeprecated as generateObjectDeprecated6,
  ModelClass as ModelClass6
} from "@elizaos/core";
import { getToken as getToken2 } from "@lifi/sdk";
import { erc20Abi as erc20Abi5, formatEther as formatEther3, formatUnits as formatUnits4 } from "viem";
var GetBalanceAction = class {
  constructor(walletProvider) {
    this.walletProvider = walletProvider;
  }
  async getBalance(params) {
    elizaLogger8.debug("Get balance params:", params);
    await this.validateAndNormalizeParams(params);
    elizaLogger8.debug("Normalized get balance params:", params);
    const { chain, address, token } = params;
    if (!address) {
      throw new Error("Address is required for getting balance");
    }
    this.walletProvider.switchChain(chain);
    const nativeSymbol = this.walletProvider.getChainConfigs(chain).nativeCurrency.symbol;
    const chainId = this.walletProvider.getChainConfigs(chain).id;
    let queryNativeToken = false;
    if (!token || token === "" || token.toLowerCase() === "bnb" || token.toLowerCase() === "tbnb") {
      queryNativeToken = true;
    }
    const resp = {
      chain,
      address
    };
    if (!queryNativeToken) {
      let amount;
      if (token.startsWith("0x")) {
        amount = await this.getERC20TokenBalance(
          chain,
          address,
          token
        );
      } else {
        if (chainId !== 56) {
          throw new Error(
            "Only BSC mainnet is supported for querying balance by token symbol"
          );
        }
        this.walletProvider.configureLiFiSdk(chain);
        const tokenInfo = await getToken2(chainId, token);
        amount = await this.getERC20TokenBalance(
          chain,
          address,
          tokenInfo.address
        );
      }
      resp.balance = { token, amount };
    } else {
      const nativeBalanceWei = await this.walletProvider.getPublicClient(chain).getBalance({ address });
      resp.balance = {
        token: nativeSymbol,
        amount: formatEther3(nativeBalanceWei)
      };
    }
    return resp;
  }
  async getERC20TokenBalance(chain, address, tokenAddress) {
    const publicClient = this.walletProvider.getPublicClient(chain);
    const balance = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi5,
      functionName: "balanceOf",
      args: [address]
    });
    const decimals = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi5,
      functionName: "decimals"
    });
    return formatUnits4(balance, decimals);
  }
  async validateAndNormalizeParams(params) {
    try {
      if (!params.chain) {
        params.chain = "bsc";
      }
      if (!params.address) {
        params.address = this.walletProvider.getAddress();
        elizaLogger8.debug(`No address provided, using wallet address: ${params.address}`);
        return;
      }
      const addressStr = String(params.address);
      if (addressStr === "null" || addressStr === "undefined") {
        params.address = this.walletProvider.getAddress();
        elizaLogger8.debug(`Invalid address string provided, using wallet address: ${params.address}`);
        return;
      }
      if (addressStr.startsWith("0x") && addressStr.length === 42) {
        elizaLogger8.debug(`Using valid hex address: ${params.address}`);
        return;
      }
      const commonTokens = ["USDT", "USDC", "BNB", "ETH", "BUSD", "WBNB", "CAKE"];
      if (commonTokens.includes(addressStr.toUpperCase())) {
        elizaLogger8.debug(`Address looks like a token symbol: ${params.address}, using wallet address instead`);
        params.address = this.walletProvider.getAddress();
        return;
      }
      elizaLogger8.debug(`Attempting to resolve address as Web3Name: ${params.address}`);
      const resolvedAddress = await this.walletProvider.resolveWeb3Name(params.address);
      if (resolvedAddress) {
        elizaLogger8.debug(`Resolved Web3Name to address: ${resolvedAddress}`);
        params.address = resolvedAddress;
        return;
      }
      if (addressStr.startsWith("0x")) {
        elizaLogger8.warn(`Address "${params.address}" doesn't look like a standard Ethereum address but will be used as is`);
        return;
      }
      elizaLogger8.warn(`Could not resolve address: ${params.address}, falling back to wallet address`);
      params.address = this.walletProvider.getAddress();
    } catch (error) {
      elizaLogger8.error(`Error validating address: ${error.message}`);
      params.address = this.walletProvider.getAddress();
    }
  }
};
var getBalanceAction = {
  name: "getBalance",
  description: "Get balance of a token or all tokens for the given address",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger8.log("Starting getBalance action...");
    let currentState = state;
    if (!currentState) {
      currentState = await runtime.composeState(message);
    } else {
      currentState = await runtime.updateRecentMessageState(currentState);
    }
    state.walletInfo = await bnbWalletProvider.get(
      runtime,
      message,
      currentState
    );
    const getBalanceContext = composeContext6({
      state: currentState,
      template: getBalanceTemplate
    });
    const content = await generateObjectDeprecated6({
      runtime,
      context: getBalanceContext,
      modelClass: ModelClass6.LARGE
    });
    const walletProvider = initWalletProvider(runtime);
    const action = new GetBalanceAction(walletProvider);
    const getBalanceOptions = {
      chain: content.chain,
      address: content.address,
      token: content.token
    };
    try {
      const getBalanceResp = await action.getBalance(getBalanceOptions);
      if (callback) {
        let text = `No balance found for ${getBalanceOptions.address} on ${getBalanceOptions.chain}`;
        if (getBalanceResp.balance) {
          text = `Balance of ${getBalanceResp.address} on ${getBalanceResp.chain}:
${getBalanceResp.balance.token}: ${getBalanceResp.balance.amount}`;
        }
        callback({
          text,
          content: { ...getBalanceResp }
        });
      }
      return true;
    } catch (error) {
      elizaLogger8.error("Error during get balance:", error);
      let userMessage = `Get balance failed: ${error.message}`;
      if (error.message.includes("getTldInfo")) {
        userMessage = `Could not find token "${getBalanceOptions.token}" on ${getBalanceOptions.chain}. Please check the token symbol or address.`;
      } else if (error.message.includes("No URL was provided")) {
        userMessage = `Network connection issue. Please try again later.`;
      } else if (error.message.includes("Only BSC mainnet is supported")) {
        userMessage = `Only BSC mainnet supports looking up tokens by symbol. Please try using a token address instead.`;
      } else if (error.message.includes("Invalid address")) {
        userMessage = `The address provided is invalid. Please provide a valid wallet address.`;
      } else if (error.message.includes("Cannot read properties")) {
        userMessage = `There was an issue processing your request. Please check your inputs and try again.`;
      }
      callback?.({
        text: userMessage,
        content: {
          error: error.message,
          chain: getBalanceOptions.chain,
          token: getBalanceOptions.token
        }
      });
      return false;
    }
  },
  template: getBalanceTemplate,
  validate: async (_runtime) => {
    return true;
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Check my balance of USDT"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll help you check your balance of USDC",
          action: "GET_BALANCE",
          content: {
            chain: "bsc",
            address: "{{walletAddress}}",
            token: "USDC"
          }
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Check my balance of token 0x1234"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll help you check your balance of token 0x1234",
          action: "GET_BALANCE",
          content: {
            chain: "bsc",
            address: "{{walletAddress}}",
            token: "0x1234"
          }
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Get USDC balance of 0x1234"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll help you check USDC balance of 0x1234",
          action: "GET_BALANCE",
          content: {
            chain: "bsc",
            address: "0x1234",
            token: "USDC"
          }
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Check my wallet balance on BSC"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll help you check your wallet balance on BSC",
          action: "GET_BALANCE",
          content: {
            chain: "bsc",
            address: "{{walletAddress}}",
            token: void 0
          }
        }
      }
    ]
  ],
  similes: ["GET_BALANCE", "CHECK_BALANCE"]
};

// src/actions/stake.ts
import {
  composeContext as composeContext7,
  elizaLogger as elizaLogger9,
  generateObjectDeprecated as generateObjectDeprecated7,
  ModelClass as ModelClass7
} from "@elizaos/core";
import { formatEther as formatEther4, parseEther as parseEther4, erc20Abi as erc20Abi6 } from "viem";
var StakeAction = class {
  constructor(walletProvider) {
    this.walletProvider = walletProvider;
  }
  LISTA_DAO = "0x1adB950d8bB3dA4bE104211D5AB038628e477fE6";
  SLIS_BNB = "0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B";
  async stake(params) {
    elizaLogger9.debug("Starting stake action with params:", JSON.stringify(params, null, 2));
    this.validateStakeParams(params);
    elizaLogger9.debug("After validation, stake params:", JSON.stringify(params, null, 2));
    elizaLogger9.debug("Switching to BSC chain for staking");
    this.walletProvider.switchChain("bsc");
    elizaLogger9.debug(`Using Lista DAO contract: ${this.LISTA_DAO}`);
    elizaLogger9.debug(`Using slisBNB token contract: ${this.SLIS_BNB}`);
    const walletAddress = this.walletProvider.getAddress();
    elizaLogger9.debug(`Wallet address: ${walletAddress}`);
    elizaLogger9.debug(`Executing stake action: ${params.action}`);
    const actions2 = {
      deposit: async () => {
        if (!params.amount) {
          throw new Error("Amount is required for deposit");
        }
        elizaLogger9.debug(`Depositing ${params.amount} BNB to Lista DAO`);
        return await this.doDeposit(params.amount);
      },
      withdraw: async () => {
        elizaLogger9.debug(`Withdrawing ${params.amount || "all"} slisBNB from Lista DAO`);
        return await this.doWithdraw(params.amount);
      },
      claim: async () => {
        elizaLogger9.debug(`Claiming unlocked BNB from Lista DAO`);
        return await this.doClaim();
      }
    };
    try {
      const resp = await actions2[params.action]();
      elizaLogger9.debug(`Stake action completed successfully: ${resp}`);
      return { response: resp };
    } catch (error) {
      elizaLogger9.error(`Error executing stake action ${params.action}:`, error);
      throw error;
    }
  }
  validateStakeParams(params) {
    elizaLogger9.debug(`Validating stake params: chain=${params.chain}, action=${params.action}, amount=${params.amount}`);
    if (!params.chain) {
      elizaLogger9.debug("No chain specified, defaulting to bsc");
      params.chain = "bsc";
    } else if (params.chain !== "bsc") {
      elizaLogger9.error(`Unsupported chain for staking: ${params.chain}`);
      throw new Error("Only BSC mainnet is supported for staking");
    }
    if (!params.action) {
      elizaLogger9.error("No action specified for staking");
      throw new Error("Action is required for staking. Use 'deposit', 'withdraw', or 'claim'");
    }
    const validActions = ["deposit", "withdraw", "claim"];
    if (!validActions.includes(params.action)) {
      elizaLogger9.error(`Invalid staking action: ${params.action}`);
      throw new Error(`Invalid staking action: ${params.action}. Valid actions are: ${validActions.join(", ")}`);
    }
    if (params.action === "deposit" && !params.amount) {
      elizaLogger9.error("Amount is required for deposit");
      throw new Error("Amount is required for deposit");
    }
    if (params.action === "withdraw" && !params.amount) {
      elizaLogger9.debug("No amount specified for withdraw, will withdraw all slisBNB");
    }
    if (params.amount) {
      try {
        const amountValue = parseFloat(params.amount);
        if (isNaN(amountValue) || amountValue <= 0) {
          elizaLogger9.error(`Invalid amount: ${params.amount} (must be a positive number)`);
          throw new Error(`Invalid amount: ${params.amount}. Please provide a positive number.`);
        }
        elizaLogger9.debug(`Amount validation passed: ${params.amount}`);
      } catch (error) {
        elizaLogger9.error(`Failed to parse amount: ${params.amount}`, error);
        throw new Error(`Invalid amount format: ${params.amount}. Please provide a valid number.`);
      }
    }
  }
  async doDeposit(amount) {
    elizaLogger9.debug(`Starting deposit of ${amount} BNB to Lista DAO`);
    const publicClient = this.walletProvider.getPublicClient("bsc");
    const walletClient = this.walletProvider.getWalletClient("bsc");
    const account = walletClient.account;
    if (!account) {
      elizaLogger9.error("Wallet account not found");
      throw new Error("Wallet account not found");
    }
    elizaLogger9.debug(`Using account address: ${account.address}`);
    elizaLogger9.debug(`Preparing to deposit ${amount} BNB with parseEther value: ${parseEther4(amount)}`);
    try {
      elizaLogger9.debug(`Simulating deposit transaction`);
      const { request } = await publicClient.simulateContract({
        account: this.walletProvider.getAccount(),
        address: this.LISTA_DAO,
        abi: ListaDaoAbi,
        functionName: "deposit",
        value: parseEther4(amount)
      });
      elizaLogger9.debug(`Executing deposit transaction`);
      const txHash = await walletClient.writeContract(request);
      elizaLogger9.debug(`Deposit transaction submitted with hash: ${txHash}`);
      elizaLogger9.debug(`Waiting for transaction confirmation`);
      await publicClient.waitForTransactionReceipt({
        hash: txHash
      });
      elizaLogger9.debug(`Transaction confirmed: ${txHash}`);
      elizaLogger9.debug(`Checking updated slisBNB balance`);
      const slisBNBBalance = await publicClient.readContract({
        address: this.SLIS_BNB,
        abi: erc20Abi6,
        functionName: "balanceOf",
        args: [account.address]
      });
      const formattedBalance = formatEther4(slisBNBBalance);
      elizaLogger9.debug(`Updated slisBNB balance: ${formattedBalance}`);
      return `Successfully do deposit. ${formattedBalance} slisBNB held. 
Transaction Hash: ${txHash}`;
    } catch (error) {
      elizaLogger9.error(`Error during deposit operation:`, error);
      if (error.message.includes("insufficient funds")) {
        throw new Error(`Insufficient funds to deposit ${amount} BNB. Please check your balance.`);
      } else if (error.message.includes("user rejected")) {
        throw new Error("Transaction rejected by user.");
      }
      throw error;
    }
  }
  async doWithdraw(amount) {
    elizaLogger9.debug(`Starting withdraw of ${amount || "all"} slisBNB from Lista DAO`);
    const publicClient = this.walletProvider.getPublicClient("bsc");
    const walletClient = this.walletProvider.getWalletClient("bsc");
    const account = walletClient.account;
    if (!account) {
      elizaLogger9.error("Wallet account not found");
      throw new Error("Wallet account not found");
    }
    elizaLogger9.debug(`Using account address: ${account.address}`);
    try {
      let amountToWithdraw;
      if (!amount) {
        elizaLogger9.debug(`No amount specified, checking total slisBNB balance`);
        amountToWithdraw = await publicClient.readContract({
          address: this.SLIS_BNB,
          abi: erc20Abi6,
          functionName: "balanceOf",
          args: [account.address]
        });
        elizaLogger9.debug(`Total slisBNB balance to withdraw: ${formatEther4(amountToWithdraw)}`);
      } else {
        amountToWithdraw = parseEther4(amount);
        elizaLogger9.debug(`Withdrawing specific amount: ${amount} slisBNB (${amountToWithdraw} wei)`);
      }
      if (amountToWithdraw <= 0n) {
        elizaLogger9.error(`No slisBNB to withdraw (amount: ${formatEther4(amountToWithdraw)})`);
        throw new Error("No slisBNB tokens available to withdraw");
      }
      elizaLogger9.debug(`Checking slisBNB allowance for Lista DAO contract`);
      const allowance = await this.walletProvider.checkERC20Allowance(
        "bsc",
        this.SLIS_BNB,
        account.address,
        this.LISTA_DAO
      );
      elizaLogger9.debug(`Current allowance: ${formatEther4(allowance)}`);
      if (allowance < amountToWithdraw) {
        const neededAllowance = amountToWithdraw - allowance;
        elizaLogger9.debug(`Increasing slisBNB allowance by ${formatEther4(neededAllowance)}`);
        const txHash2 = await this.walletProvider.approveERC20(
          "bsc",
          this.SLIS_BNB,
          this.LISTA_DAO,
          amountToWithdraw
        );
        elizaLogger9.debug(`Allowance approval transaction submitted with hash: ${txHash2}`);
        await publicClient.waitForTransactionReceipt({
          hash: txHash2
        });
        elizaLogger9.debug(`Allowance approval transaction confirmed`);
      } else {
        elizaLogger9.debug(`Sufficient allowance already granted`);
      }
      elizaLogger9.debug(`Simulating withdraw request transaction`);
      const { request } = await publicClient.simulateContract({
        account: this.walletProvider.getAccount(),
        address: this.LISTA_DAO,
        abi: ListaDaoAbi,
        functionName: "requestWithdraw",
        args: [amountToWithdraw]
      });
      elizaLogger9.debug(`Executing withdraw request transaction`);
      const txHash = await walletClient.writeContract(request);
      elizaLogger9.debug(`Withdraw request transaction submitted with hash: ${txHash}`);
      elizaLogger9.debug(`Waiting for transaction confirmation`);
      await publicClient.waitForTransactionReceipt({
        hash: txHash
      });
      elizaLogger9.debug(`Transaction confirmed: ${txHash}`);
      elizaLogger9.debug(`Checking remaining slisBNB balance`);
      const slisBNBBalance = await publicClient.readContract({
        address: this.SLIS_BNB,
        abi: erc20Abi6,
        functionName: "balanceOf",
        args: [account.address]
      });
      const formattedBalance = formatEther4(slisBNBBalance);
      elizaLogger9.debug(`Remaining slisBNB balance: ${formattedBalance}`);
      return `Successfully do withdraw. ${formattedBalance} slisBNB left. 
Transaction Hash: ${txHash}`;
    } catch (error) {
      elizaLogger9.error(`Error during withdraw operation:`, error);
      if (error.message.includes("insufficient funds") || error.message.includes("insufficient balance")) {
        throw new Error(`Insufficient slisBNB balance to withdraw. Please check your balance.`);
      } else if (error.message.includes("user rejected")) {
        throw new Error("Transaction rejected by user.");
      }
      throw error;
    }
  }
  async doClaim() {
    elizaLogger9.debug(`Starting claim operation for unlocked BNB from Lista DAO`);
    const publicClient = this.walletProvider.getPublicClient("bsc");
    const walletClient = this.walletProvider.getWalletClient("bsc");
    const account = walletClient.account;
    if (!account) {
      elizaLogger9.error("Wallet account not found");
      throw new Error("Wallet account not found");
    }
    elizaLogger9.debug(`Using account address: ${account.address}`);
    try {
      elizaLogger9.debug(`Fetching user withdrawal requests`);
      const requests = await publicClient.readContract({
        address: this.LISTA_DAO,
        abi: ListaDaoAbi,
        functionName: "getUserWithdrawalRequests",
        args: [account.address]
      });
      elizaLogger9.debug(`Found ${requests.length} withdrawal requests`);
      if (requests.length === 0) {
        elizaLogger9.warn(`No withdrawal requests found for claiming`);
        return `No withdrawal requests found to claim. You need to request a withdrawal first using the 'withdraw' action.`;
      }
      let totalClaimed = 0n;
      let claimedCount = 0;
      for (let idx = 0; idx < requests.length; idx++) {
        elizaLogger9.debug(`Checking request #${idx} status`);
        const [isClaimable, amount] = await publicClient.readContract({
          address: this.LISTA_DAO,
          abi: ListaDaoAbi,
          functionName: "getUserRequestStatus",
          args: [account.address, BigInt(idx)]
        });
        if (isClaimable) {
          elizaLogger9.debug(`Request #${idx} is claimable, amount: ${formatEther4(amount)} BNB`);
          elizaLogger9.debug(`Simulating claim transaction for request #${idx}`);
          const { request } = await publicClient.simulateContract({
            account: this.walletProvider.getAccount(),
            address: this.LISTA_DAO,
            abi: ListaDaoAbi,
            functionName: "claimWithdraw",
            args: [BigInt(idx)]
          });
          elizaLogger9.debug(`Executing claim transaction for request #${idx}`);
          const txHash = await walletClient.writeContract(request);
          elizaLogger9.debug(`Claim transaction submitted with hash: ${txHash}`);
          elizaLogger9.debug(`Waiting for transaction confirmation`);
          await publicClient.waitForTransactionReceipt({
            hash: txHash
          });
          elizaLogger9.debug(`Transaction confirmed: ${txHash}`);
          totalClaimed += amount;
          claimedCount++;
        } else {
          elizaLogger9.debug(`Request #${idx} is not claimable yet, skipping`);
          break;
        }
      }
      const formattedTotal = formatEther4(totalClaimed);
      elizaLogger9.debug(`Total claimed: ${formattedTotal} BNB from ${claimedCount} requests`);
      if (claimedCount === 0) {
        return `No claimable withdrawals found. Withdrawal requests typically need 7-14 days to become claimable.`;
      }
      return `Successfully do claim. ${formattedTotal} BNB claimed.`;
    } catch (error) {
      elizaLogger9.error(`Error during claim operation:`, error);
      if (error.message.includes("user rejected")) {
        throw new Error("Transaction rejected by user.");
      }
      throw error;
    }
  }
};
var stakeAction = {
  name: "stake",
  description: "Stake related actions through Lista DAO",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger9.log("Starting stake action...");
    elizaLogger9.debug("Message content:", JSON.stringify(message.content, null, 2));
    const promptText = typeof message.content.text === "string" ? message.content.text.trim() : "";
    elizaLogger9.debug(`Raw prompt text: "${promptText}"`);
    const promptLower = promptText.toLowerCase();
    const stakeRegex = /(?:stake|deposit)\s+([0-9.]+)\s+(?:bnb|slisBNB)\s+(?:on|in|to|at)?(?:\s+lista\s+dao)?(?:\s+on)?\s+(?:bsc|binance)/i;
    const withdrawRegex = /(?:withdraw|unstake|undelegate)\s+([0-9.]+)\s+(?:bnb|slisBNB)\s+(?:from|on)?\s+(?:lista\s+dao)?(?:\s+on)?\s+(?:bsc|binance)/i;
    const claimRegex = /claim\s+(?:bnb|unlocked\s+bnb|rewards?)(?:\s+from)?\s+(?:lista\s+dao)?(?:\s+on)?\s+(?:bsc|binance)/i;
    let directAction = null;
    let directAmount = null;
    let match = promptText.match(stakeRegex);
    if (match && match.length >= 2) {
      directAction = "deposit";
      directAmount = match[1];
      elizaLogger9.debug(`Directly extracted deposit action - Amount: ${directAmount}`);
    } else {
      match = promptText.match(withdrawRegex);
      if (match && match.length >= 2) {
        directAction = "withdraw";
        directAmount = match[1];
        elizaLogger9.debug(`Directly extracted withdraw action - Amount: ${directAmount}`);
      } else {
        match = promptText.match(claimRegex);
        if (match) {
          directAction = "claim";
          elizaLogger9.debug(`Directly extracted claim action`);
        }
      }
    }
    if (!directAction) {
      if (promptLower.includes("stake") || promptLower.includes("deposit")) {
        directAction = "deposit";
        elizaLogger9.debug(`Detected stake/deposit action from keywords`);
      } else if (promptLower.includes("withdraw") || promptLower.includes("unstake") || promptLower.includes("undelegate")) {
        directAction = "withdraw";
        elizaLogger9.debug(`Detected withdraw/unstake action from keywords`);
      } else if (promptLower.includes("claim")) {
        directAction = "claim";
        elizaLogger9.debug(`Detected claim action from keywords`);
      }
    }
    if (!directAmount && directAction !== "claim") {
      const amountRegex = /([0-9]+(?:\.[0-9]+)?)/;
      const amountMatch = promptText.match(amountRegex);
      if (amountMatch && amountMatch.length >= 2) {
        directAmount = amountMatch[1];
        elizaLogger9.debug(`Extracted amount from prompt: ${directAmount}`);
      }
    }
    const promptAnalysis = {
      directAction,
      directAmount,
      containsBNB: promptLower.includes("bnb"),
      containsListaDAO: promptLower.includes("lista") || promptLower.includes("dao"),
      containsBSC: promptLower.includes("bsc") || promptLower.includes("binance")
    };
    elizaLogger9.debug("Prompt analysis result:", promptAnalysis);
    if (!(message.content.source === "direct")) {
      callback?.({
        text: "I can't do that for you.",
        content: { error: "Stake not allowed" }
      });
      return false;
    }
    let currentState = state;
    if (!currentState) {
      currentState = await runtime.composeState(message);
    } else {
      currentState = await runtime.updateRecentMessageState(currentState);
    }
    try {
      state.walletInfo = await bnbWalletProvider.get(
        runtime,
        message,
        currentState
      );
      elizaLogger9.debug("Wallet info:", state.walletInfo);
    } catch (error) {
      elizaLogger9.error("Error getting wallet info:", error.message);
      callback?.({
        text: `Unable to access wallet: ${error.message}`,
        content: { error: error.message }
      });
      return false;
    }
    const stakeContext = composeContext7({
      state: currentState,
      template: stakeTemplate
    });
    const content = await generateObjectDeprecated7({
      runtime,
      context: stakeContext,
      modelClass: ModelClass7.LARGE
    });
    elizaLogger9.debug("Generated stake content:", JSON.stringify(content, null, 2));
    let stakeAction2;
    let amount;
    if (directAction) {
      stakeAction2 = directAction;
      elizaLogger9.debug(`Using action directly extracted from prompt: ${stakeAction2}`);
    } else if (content.action) {
      stakeAction2 = content.action;
      elizaLogger9.debug(`Using action from generated content: ${stakeAction2}`);
    } else {
      stakeAction2 = "deposit";
      elizaLogger9.debug(`No action detected, defaulting to deposit`);
    }
    if (stakeAction2 !== "claim") {
      if (directAmount) {
        amount = directAmount;
        elizaLogger9.debug(`Using amount directly extracted from prompt: ${amount}`);
      } else if (content.amount) {
        amount = content.amount;
        elizaLogger9.debug(`Using amount from generated content: ${amount}`);
      } else if (stakeAction2 === "deposit") {
        amount = "0.001";
        elizaLogger9.debug(`No amount detected for deposit, defaulting to ${amount}`);
      }
    }
    const walletProvider = initWalletProvider(runtime);
    const action = new StakeAction(walletProvider);
    const paramOptions = {
      chain: "bsc",
      // Only BSC is supported for staking
      action: stakeAction2,
      amount
    };
    elizaLogger9.debug("Final stake options:", JSON.stringify(paramOptions, null, 2));
    try {
      elizaLogger9.debug("Calling stake with params:", JSON.stringify(paramOptions, null, 2));
      const stakeResp = await action.stake(paramOptions);
      callback?.({
        text: stakeResp.response,
        content: { ...stakeResp }
      });
      return true;
    } catch (error) {
      elizaLogger9.error("Error during stake:", error.message);
      try {
        elizaLogger9.error("Full error details:", JSON.stringify(error, null, 2));
      } catch (e) {
        elizaLogger9.error("Error object not serializable, logging properties individually:");
        for (const key in error) {
          try {
            elizaLogger9.error(`${key}:`, error[key]);
          } catch (e2) {
            elizaLogger9.error(`${key}: [Error serializing property]`);
          }
        }
      }
      let errorMessage = error.message;
      if (error.message.includes("insufficient funds")) {
        errorMessage = `Insufficient funds for the stake operation. Please check your balance and try with a smaller amount.`;
      } else if (error.message.includes("user rejected")) {
        errorMessage = `Transaction was rejected. Please try again if you want to proceed with the stake operation.`;
      } else if (error.message.includes("No withdrawal requests")) {
        errorMessage = `No withdrawal requests found to claim. You need to request a withdrawal first using the 'withdraw' action.`;
      }
      callback?.({
        text: `Stake failed: ${errorMessage}`,
        content: { error: errorMessage }
      });
      return false;
    }
  },
  template: stakeTemplate,
  validate: async (runtime) => {
    const privateKey = runtime.getSetting("BNB_PRIVATE_KEY");
    return typeof privateKey === "string" && privateKey.startsWith("0x");
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Stake 0.001 BNB on BSC"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll help you stake 0.001 BNB to Lista DAO on BSC",
          action: "STAKE",
          content: {
            action: "deposit",
            amount: "0.001"
          }
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Deposit 0.001 BNB to Lista DAO"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll help you deposit 0.001 BNB to Lista DAO on BSC",
          action: "STAKE",
          content: {
            action: "deposit",
            amount: "0.001"
          }
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Undelegate 0.001 slisBNB on BSC"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll help you undelegate 0.001 slisBNB from Lista DAO on BSC",
          action: "STAKE",
          content: {
            action: "withdraw",
            amount: "0.001"
          }
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Withdraw 0.001 slisBNB from Lista DAO"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll help you withdraw 0.001 slisBNB from Lista DAO on BSC",
          action: "STAKE",
          content: {
            action: "withdraw",
            amount: "0.001"
          }
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Claim unlocked BNB from Lista DAO"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll help you claim unlocked BNB from Lista DAO on BSC",
          action: "STAKE",
          content: {
            action: "claim"
          }
        }
      }
    ]
  ],
  similes: [
    "DELEGATE",
    "STAKE",
    "DEPOSIT",
    "UNDELEGATE",
    "UNSTAKE",
    "WITHDRAW",
    "CLAIM"
  ]
};

// src/actions/faucet.ts
import {
  composeContext as composeContext8,
  elizaLogger as elizaLogger10,
  generateObjectDeprecated as generateObjectDeprecated8,
  ModelClass as ModelClass8
} from "@elizaos/core";
import WebSocket from "ws";
var FaucetAction = class {
  constructor(walletProvider) {
    this.walletProvider = walletProvider;
  }
  SUPPORTED_TOKENS = [
    "BNB",
    "BTC",
    "BUSD",
    "DAI",
    "ETH",
    "USDC"
  ];
  FAUCET_URL = "wss://testnet.bnbchain.org/faucet-smart/api";
  async faucet(params) {
    elizaLogger10.debug("Faucet params:", params);
    try {
      await this.validateAndNormalizeParams(params);
      elizaLogger10.debug("Normalized faucet params:", params);
      if (!params.token) {
        params.token = "BNB";
        elizaLogger10.debug("No token specified, defaulting to BNB");
      }
      if (!params.toAddress) {
        params.toAddress = this.walletProvider.getAddress();
        elizaLogger10.debug(`No address specified, using wallet address: ${params.toAddress}`);
      }
      const resp = {
        token: params.token,
        recipient: params.toAddress,
        txHash: "0x"
      };
      const options = {
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket"
        }
      };
      const ws = new WebSocket(this.FAUCET_URL, options);
      try {
        await new Promise((resolve, reject) => {
          ws.once("open", () => resolve());
          ws.once("error", reject);
        });
        const message = {
          tier: 0,
          url: params.toAddress,
          symbol: params.token,
          captcha: "noCaptchaToken"
        };
        elizaLogger10.debug(`Sending faucet request: ${JSON.stringify(message)}`);
        ws.send(JSON.stringify(message));
        const txHash = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error("Faucet request timeout"));
          }, 15e3);
          ws.on("message", (data) => {
            const response = JSON.parse(data.toString());
            elizaLogger10.debug(`Faucet response: ${JSON.stringify(response)}`);
            if (response.success) {
              elizaLogger10.debug("Faucet request accepted");
              return;
            }
            if (response.requests?.length > 0) {
              const txHash2 = response.requests[0].tx.hash;
              if (txHash2) {
                clearTimeout(timeout);
                elizaLogger10.debug(`Faucet transaction hash received: ${txHash2}`);
                resolve(txHash2);
              }
            }
            if (response.error) {
              clearTimeout(timeout);
              elizaLogger10.error(`Faucet error: ${response.error}`);
              reject(new Error(response.error));
            }
          });
          ws.on("error", (error) => {
            clearTimeout(timeout);
            elizaLogger10.error(`WebSocket error: ${error.message}`);
            reject(
              new Error(`WebSocket error occurred: ${error.message}`)
            );
          });
        });
        resp.txHash = txHash;
        elizaLogger10.debug(`Faucet success: ${params.token} to ${params.toAddress}, tx: ${txHash}`);
        return resp;
      } finally {
        ws.close();
      }
    } catch (error) {
      elizaLogger10.error(`Faucet error: ${error.message}`, error);
      throw error;
    }
  }
  async validateAndNormalizeParams(params) {
    elizaLogger10.debug("Original faucet params:", params);
    try {
      if (!params.token) {
        params.token = "BNB";
        elizaLogger10.debug("No token specified, defaulting to BNB");
      }
      if (!this.SUPPORTED_TOKENS.includes(params.token)) {
        throw new Error(`Unsupported token: ${params.token}. Supported tokens are: ${this.SUPPORTED_TOKENS.join(", ")}`);
      }
      if (!params.toAddress) {
        params.toAddress = this.walletProvider.getAddress();
        elizaLogger10.debug(`No address provided, using wallet address: ${params.toAddress}`);
        return;
      }
      if (typeof params.toAddress === "string" && params.toAddress.startsWith("0x") && params.toAddress.length === 42) {
        elizaLogger10.debug(`Using provided hex address: ${params.toAddress}`);
        return;
      }
      try {
        params.toAddress = await this.walletProvider.formatAddress(params.toAddress);
        elizaLogger10.debug(`Successfully formatted address to: ${params.toAddress}`);
      } catch (error) {
        elizaLogger10.error(`Error formatting address: ${error.message}`);
        params.toAddress = this.walletProvider.getAddress();
        elizaLogger10.debug(`Falling back to wallet address: ${params.toAddress}`);
      }
    } catch (error) {
      elizaLogger10.error(`Error in validateAndNormalizeParams: ${error.message}`);
      throw error;
    }
    elizaLogger10.debug("Normalized faucet params:", params);
  }
};
var faucetAction = {
  name: "faucet",
  description: "Get test tokens from the BSC Testnet faucet (token list: BNB, BUSD, DAI, USDC)",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger10.log("Starting faucet action...");
    let currentState = state;
    if (!currentState) {
      currentState = await runtime.composeState(message);
    } else {
      currentState = await runtime.updateRecentMessageState(currentState);
    }
    state.walletInfo = await bnbWalletProvider.get(
      runtime,
      message,
      currentState
    );
    const faucetContext = composeContext8({
      state: currentState,
      template: faucetTemplate
    });
    const content = await generateObjectDeprecated8({
      runtime,
      context: faucetContext,
      modelClass: ModelClass8.LARGE
    });
    const walletProvider = initWalletProvider(runtime);
    const action = new FaucetAction(walletProvider);
    const paramOptions = {
      token: content.token,
      toAddress: content.toAddress
    };
    try {
      const faucetResp = await action.faucet(paramOptions);
      callback?.({
        text: `Successfully transferred ${faucetResp.token} to ${faucetResp.recipient}
Transaction Hash: ${faucetResp.txHash}`,
        content: {
          hash: faucetResp.txHash,
          recipient: faucetResp.recipient,
          chain: content.chain || "bscTestnet"
          // Default to testnet for faucet
        }
      });
      return true;
    } catch (error) {
      elizaLogger10.error("Error during faucet:", error.message);
      let userMessage = `Get test tokens failed: ${error.message}`;
      if (error.message.includes("Invalid address")) {
        userMessage = "Failed to validate address. Please provide a valid BSC address.";
      } else if (error.message.includes("Unsupported token")) {
        userMessage = error.message;
      } else if (error.message.includes("WebSocket error")) {
        userMessage = "Connection to faucet failed. Please try again later.";
      }
      callback?.({
        text: userMessage,
        content: {
          error: error.message,
          requestedToken: paramOptions.token || "BNB",
          requestedAddress: paramOptions.toAddress
        }
      });
      return false;
    }
  },
  template: faucetTemplate,
  validate: async (_runtime) => {
    return true;
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Get some USDC from the testnet faucet"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "Sure, I'll request some test USDC from the BSC Testnet faucet now. This will be sent to your wallet address.",
          action: "FAUCET",
          content: {
            token: "USDC",
            toAddress: "{{walletAddress}}"
          }
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: {
          text: "Get some test tokens from the faucet"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I'll request some test BNB tokens from the BSC Testnet faucet. These tokens have no real value and are only for testing purposes.",
          action: "FAUCET",
          content: {
            token: "BNB",
            toAddress: "{{walletAddress}}"
          }
        }
      }
    ]
  ],
  similes: ["FAUCET", "GET_TEST_TOKENS"]
};

// src/actions/gnfd.ts
import { createRequire as createRequire3 } from "module";
import {
  composeContext as composeContext9,
  elizaLogger as elizaLogger11,
  generateObjectDeprecated as generateObjectDeprecated9,
  ModelClass as ModelClass9
} from "@elizaos/core";
import { readFileSync, statSync } from "fs";
import { lookup } from "mime-types";
import { extname } from "node:path";

// src/providers/gnfd.ts
import { createRequire as createRequire2 } from "module";
var require3 = createRequire2(import.meta.url);
var { Client } = require3("@bnb-chain/greenfield-js-sdk");
var getGnfdConfig = async (runtime) => {
  const network = runtime.getSetting("GREENFIELD_NETWORK");
  const config = network === "TESTNET" ? CONFIG["TESTNET"] : CONFIG["MAINNET"];
  return config;
};
var InitGnfdClient = async (runtime) => {
  const config = await getGnfdConfig(runtime);
  if (!config.GREENFIELD_CHAIN_ID || !config.GREENFIELD_RPC_URL) {
    throw new Error("Creating greenfield client params is error");
  }
  const client = Client.create(
    config.GREENFIELD_RPC_URL,
    config.GREENFIELD_CHAIN_ID
  );
  return client;
};
var CONFIG = {
  MAINNET: {
    NETWORK: "MAINNET",
    TOKENHUB_ADDRESS: "0xeA97dF87E6c7F68C9f95A69dA79E19B834823F25",
    CROSSCHAIN_ADDRESS: "0x77e719b714be09F70D484AB81F70D02B0E182f7d",
    GREENFIELD_RPC_URL: "https://greenfield-chain.bnbchain.org",
    GREENFIELD_CHAIN_ID: "1017",
    GREENFIELD_SCAN: "https://greenfieldscan.com"
  },
  TESTNET: {
    NETWORK: "TESTNET",
    TOKENHUB_ADDRESS: "0xED8e5C546F84442219A5a987EE1D820698528E04",
    CROSSCHAIN_ADDRESS: "0xa5B2c9194131A4E0BFaCbF9E5D6722c873159cb7",
    GREENFIELD_RPC_URL: "https://gnfd-testnet-fullnode-tendermint-us.bnbchain.org",
    GREENFIELD_CHAIN_ID: "5600",
    GREENFIELD_SCAN: "https://testnet.greenfieldscan.com"
  }
};

// src/abi/CrossChainAbi.ts
var CROSS_CHAIN_ABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint8",
        name: "channelId",
        type: "uint8"
      },
      {
        indexed: true,
        internalType: "address",
        name: "contractAddr",
        type: "address"
      }
    ],
    name: "AddChannel",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint32",
        name: "srcChainId",
        type: "uint32"
      },
      {
        indexed: false,
        internalType: "uint32",
        name: "dstChainId",
        type: "uint32"
      },
      {
        indexed: true,
        internalType: "uint64",
        name: "oracleSequence",
        type: "uint64"
      },
      {
        indexed: true,
        internalType: "uint64",
        name: "packageSequence",
        type: "uint64"
      },
      {
        indexed: true,
        internalType: "uint8",
        name: "channelId",
        type: "uint8"
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "payload",
        type: "bytes"
      }
    ],
    name: "CrossChainPackage",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint8",
        name: "channelId",
        type: "uint8"
      },
      {
        indexed: false,
        internalType: "bool",
        name: "isEnable",
        type: "bool"
      }
    ],
    name: "EnableOrDisableChannel",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint8",
        name: "version",
        type: "uint8"
      }
    ],
    name: "Initialized",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "string",
        name: "key",
        type: "string"
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "value",
        type: "bytes"
      }
    ],
    name: "ParamChange",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "proposalTypeHash",
        type: "bytes32"
      },
      {
        indexed: true,
        internalType: "address",
        name: "proposer",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint128",
        name: "quorum",
        type: "uint128"
      },
      {
        indexed: false,
        internalType: "uint128",
        name: "expiredAt",
        type: "uint128"
      },
      {
        indexed: false,
        internalType: "bytes32",
        name: "contentHash",
        type: "bytes32"
      }
    ],
    name: "ProposalSubmitted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint8",
        name: "packageType",
        type: "uint8"
      },
      {
        indexed: true,
        internalType: "uint64",
        name: "packageSequence",
        type: "uint64"
      },
      {
        indexed: true,
        internalType: "uint8",
        name: "channelId",
        type: "uint8"
      }
    ],
    name: "ReceivedPackage",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "executor",
        type: "address"
      }
    ],
    name: "Reopened",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "executor",
        type: "address"
      }
    ],
    name: "Suspended",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "contractAddr",
        type: "address"
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "lowLevelData",
        type: "bytes"
      }
    ],
    name: "UnexpectedFailureAssertionInPackageHandler",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "contractAddr",
        type: "address"
      },
      {
        indexed: false,
        internalType: "string",
        name: "reason",
        type: "string"
      }
    ],
    name: "UnexpectedRevertInPackageHandler",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint64",
        name: "packageSequence",
        type: "uint64"
      },
      {
        indexed: true,
        internalType: "uint8",
        name: "channelId",
        type: "uint8"
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "payload",
        type: "bytes"
      }
    ],
    name: "UnsupportedPackage",
    type: "event"
  },
  {
    inputs: [],
    name: "ACK_PACKAGE",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "CANCEL_TRANSFER_PROPOSAL",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "CODE_OK",
    outputs: [
      {
        internalType: "uint32",
        name: "",
        type: "uint32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "CROSS_CHAIN",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "EMERGENCY_PROPOSAL_EXPIRE_PERIOD",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "EMPTY_CONTENT_HASH",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "ERROR_FAIL_DECODE",
    outputs: [
      {
        internalType: "uint32",
        name: "",
        type: "uint32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "FAIL_ACK_PACKAGE",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "GOV_CHANNELID",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "GOV_HUB",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "IN_TURN_RELAYER_VALIDITY_PERIOD",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "LIGHT_CLIENT",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "OUT_TURN_RELAYER_BACKOFF_PERIOD",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "PROXY_ADMIN",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "RELAYER_HUB",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "REOPEN_PROPOSAL",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "SUSPEND_PROPOSAL",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "SYN_PACKAGE",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "TOKEN_HUB",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "TRANSFER_IN_CHANNEL_ID",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "TRANSFER_OUT_CHANNEL_ID",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "batchSizeForOracle",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "callbackGasPrice",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "attacker",
        type: "address"
      }
    ],
    name: "cancelTransfer",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "chainId",
    outputs: [
      {
        internalType: "uint16",
        name: "",
        type: "uint16"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    name: "channelHandlerMap",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    name: "channelReceiveSequenceMap",
    outputs: [
      {
        internalType: "uint64",
        name: "",
        type: "uint64"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    name: "channelSendSequenceMap",
    outputs: [
      {
        internalType: "uint64",
        name: "",
        type: "uint64"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    name: "emergencyProposals",
    outputs: [
      {
        internalType: "uint16",
        name: "quorum",
        type: "uint16"
      },
      {
        internalType: "uint128",
        name: "expiredAt",
        type: "uint128"
      },
      {
        internalType: "bytes32",
        name: "contentHash",
        type: "bytes32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "packageType",
        type: "uint8"
      },
      {
        internalType: "uint256",
        name: "_relayFee",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "_ackRelayFee",
        type: "uint256"
      },
      {
        internalType: "bytes",
        name: "msgBytes",
        type: "bytes"
      }
    ],
    name: "encodePayload",
    outputs: [
      {
        internalType: "bytes",
        name: "",
        type: "bytes"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "getRelayFees",
    outputs: [
      {
        internalType: "uint256",
        name: "_relayFee",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "_minAckRelayFee",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "gnfdChainId",
    outputs: [
      {
        internalType: "uint16",
        name: "",
        type: "uint16"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes",
        name: "_payload",
        type: "bytes"
      },
      {
        internalType: "bytes",
        name: "_blsSignature",
        type: "bytes"
      },
      {
        internalType: "uint256",
        name: "_validatorsBitSet",
        type: "uint256"
      }
    ],
    name: "handlePackage",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint16",
        name: "_gnfdChainId",
        type: "uint16"
      }
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "isSuspended",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "minAckRelayFee",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "oracleSequence",
    outputs: [
      {
        internalType: "int64",
        name: "",
        type: "int64"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "previousTxHeight",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32"
      }
    ],
    name: "quorumMap",
    outputs: [
      {
        internalType: "uint16",
        name: "",
        type: "uint16"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      },
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    name: "registeredContractChannelMap",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "relayFee",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "reopen",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "channelId",
        type: "uint8"
      },
      {
        internalType: "bytes",
        name: "msgBytes",
        type: "bytes"
      },
      {
        internalType: "uint256",
        name: "_relayFee",
        type: "uint256"
      },
      {
        internalType: "uint256",
        name: "_ackRelayFee",
        type: "uint256"
      }
    ],
    name: "sendSynPackage",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "suspend",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "txCounter",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "string",
        name: "key",
        type: "string"
      },
      {
        internalType: "bytes",
        name: "value",
        type: "bytes"
      }
    ],
    name: "updateParam",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "upgradeInfo",
    outputs: [
      {
        internalType: "uint256",
        name: "version",
        type: "uint256"
      },
      {
        internalType: "string",
        name: "name",
        type: "string"
      },
      {
        internalType: "string",
        name: "description",
        type: "string"
      }
    ],
    stateMutability: "pure",
    type: "function"
  }
];

// src/abi/TokenHubAbi.ts
var TOKENHUB_ABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint8",
        name: "version",
        type: "uint8"
      }
    ],
    name: "Initialized",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "string",
        name: "key",
        type: "string"
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "value",
        type: "bytes"
      }
    ],
    name: "ParamChange",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "from",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "ReceiveTransferIn",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "refundAddr",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint32",
        name: "status",
        type: "uint32"
      }
    ],
    name: "RefundFailure",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "refundAddr",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint32",
        name: "status",
        type: "uint32"
      }
    ],
    name: "RefundSuccess",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "to",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "RewardTo",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "refundAddr",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "TransferInSuccess",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "senderAddr",
        type: "address"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "relayFee",
        type: "uint256"
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "ackRelayFee",
        type: "uint256"
      }
    ],
    name: "TransferOutSuccess",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint8",
        name: "channelId",
        type: "uint8"
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "msgBytes",
        type: "bytes"
      }
    ],
    name: "UnexpectedPackage",
    type: "event"
  },
  {
    inputs: [],
    name: "APP_CHANNELID",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "CODE_OK",
    outputs: [
      {
        internalType: "uint32",
        name: "",
        type: "uint32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "CROSS_CHAIN",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "ERROR_FAIL_DECODE",
    outputs: [
      {
        internalType: "uint32",
        name: "",
        type: "uint32"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "GOV_CHANNELID",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "GOV_HUB",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "LIGHT_CLIENT",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "MAX_GAS_FOR_TRANSFER_BNB",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "PROXY_ADMIN",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "RELAYER_HUB",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "REWARD_UPPER_LIMIT",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "TOKEN_HUB",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "TRANSFER_IN_CHANNELID",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "TRANSFER_IN_FAILURE_INSUFFICIENT_BALANCE",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "TRANSFER_IN_FAILURE_NON_PAYABLE_RECIPIENT",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "TRANSFER_IN_FAILURE_UNKNOWN",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "TRANSFER_IN_SUCCESS",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "TRANSFER_OUT_CHANNELID",
    outputs: [
      {
        internalType: "uint8",
        name: "",
        type: "uint8"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "claimRelayFee",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "govHub",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address"
      }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "channelId",
        type: "uint8"
      },
      {
        internalType: "bytes",
        name: "msgBytes",
        type: "bytes"
      }
    ],
    name: "handleAckPackage",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "channelId",
        type: "uint8"
      },
      {
        internalType: "bytes",
        name: "msgBytes",
        type: "bytes"
      }
    ],
    name: "handleFailAckPackage",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "uint8",
        name: "channelId",
        type: "uint8"
      },
      {
        internalType: "bytes",
        name: "msgBytes",
        type: "bytes"
      }
    ],
    name: "handleSynPackage",
    outputs: [
      {
        internalType: "bytes",
        name: "",
        type: "bytes"
      }
    ],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "recipient",
        type: "address"
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256"
      }
    ],
    name: "transferOut",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool"
      }
    ],
    stateMutability: "payable",
    type: "function"
  },
  {
    stateMutability: "payable",
    type: "receive"
  }
];

// src/actions/gnfd.ts
import { parseEther as parseEther5 } from "viem";
var require4 = createRequire3(import.meta.url);
var {
  Client: Client2,
  Long,
  VisibilityType
} = require4("@bnb-chain/greenfield-js-sdk");
var GreenfieldAction = class {
  constructor(walletProvider, gnfdClient) {
    this.walletProvider = walletProvider;
    this.gnfdClient = gnfdClient;
  }
  async getSps() {
    const sps = await this.gnfdClient.sp.getStorageProviders();
    return sps;
  }
  async selectSp() {
    const finalSps = await this.getSps();
    const selectIndex = Math.floor(Math.random() * finalSps.length);
    const secondarySpAddresses = [
      ...finalSps.slice(0, selectIndex),
      ...finalSps.slice(selectIndex + 1)
    ].map((item) => item.operatorAddress);
    const selectSpInfo = {
      id: finalSps[selectIndex].id,
      endpoint: finalSps[selectIndex].endpoint,
      primarySpAddress: finalSps[selectIndex]?.operatorAddress,
      sealAddress: finalSps[selectIndex].sealAddress,
      secondarySpAddresses
    };
    return selectSpInfo;
  }
  async bnbTransferToGnfd(amount, runtime) {
    const config = await getGnfdConfig(runtime);
    const chain = config.NETWORK === "TESTNET" ? "bscTestnet" : "bsc";
    this.walletProvider.switchChain(chain);
    const publicClient = this.walletProvider.getPublicClient(chain);
    const walletClient = this.walletProvider.getWalletClient(chain);
    const [relayFee, ackRelayFee] = await publicClient.readContract({
      address: config.CROSSCHAIN_ADDRESS,
      abi: CROSS_CHAIN_ABI,
      functionName: "getRelayFees"
    });
    const relayerFee = relayFee + ackRelayFee;
    const totalAmount = relayerFee + amount;
    const { request } = await publicClient.simulateContract({
      account: this.walletProvider.getAccount(),
      address: config.TOKENHUB_ADDRESS,
      abi: TOKENHUB_ABI,
      functionName: "transferOut",
      args: [this.walletProvider.getAddress(), amount],
      value: totalAmount
    });
    const hash = await walletClient.writeContract(request);
    const tx = await publicClient.waitForTransactionReceipt({
      hash
    });
    return tx.transactionHash;
  }
  async createBucket(msg) {
    elizaLogger11.log("create bucket...");
    const createBucketTx = await this.gnfdClient.bucket.createBucket(msg);
    const createBucketTxSimulateInfo = await createBucketTx.simulate({
      denom: "BNB"
    });
    const createBucketTxRes = await createBucketTx.broadcast({
      denom: "BNB",
      gasLimit: Number(createBucketTxSimulateInfo?.gasLimit),
      gasPrice: createBucketTxSimulateInfo?.gasPrice || "5000000000",
      payer: msg.paymentAddress,
      granter: "",
      privateKey: this.walletProvider.getPk()
    });
    elizaLogger11.log("createBucketTxRes", createBucketTxRes);
    if (createBucketTxRes.code === 0) {
      elizaLogger11.log("create bucket success");
    }
    return createBucketTxRes.transactionHash;
  }
  async headBucket(bucketName) {
    const { bucketInfo } = await this.gnfdClient.bucket.headBucket(bucketName);
    return bucketInfo.id;
  }
  async uploadObject(msg) {
    const uploadRes = await this.gnfdClient.object.delegateUploadObject(
      msg,
      {
        type: "ECDSA",
        privateKey: this.walletProvider.getPk()
      }
    );
    if (uploadRes.code === 0) {
      elizaLogger11.log("upload object success");
    }
    return uploadRes.message;
  }
  async headObject(bucketName, objectName) {
    const { objectInfo } = await this.gnfdClient.object.headObject(bucketName, objectName);
    return objectInfo.id;
  }
  async deleteObject(msg) {
    const deleteObjectTx = await this.gnfdClient.object.deleteObject(msg);
    const simulateInfo = await deleteObjectTx.simulate({
      denom: "BNB"
    });
    const res = await deleteObjectTx.broadcast({
      denom: "BNB",
      gasLimit: Number(simulateInfo?.gasLimit),
      gasPrice: simulateInfo?.gasPrice || "5000000000",
      payer: msg.operator,
      granter: "",
      privateKey: this.walletProvider.getPk()
    });
    if (res.code === 0) {
      elizaLogger11.log("delete success");
    }
    return res.transactionHash;
  }
};
var greenfieldAction = {
  name: "GREENFIELD_ACTION",
  description: "create bucket, upload object, delete object on the greenfield chain",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger11.log("Starting Gnfd action...");
    if (!state) {
      state = await runtime.composeState(message);
    } else {
      state = await runtime.updateRecentMessageState(state);
    }
    const context = composeContext9({
      state,
      template: greenfieldTemplate
    });
    const content = await generateObjectDeprecated9({
      runtime,
      context,
      modelClass: ModelClass9.LARGE
    });
    elizaLogger11.log("content", content);
    const config = await getGnfdConfig(runtime);
    const gnfdClient = await InitGnfdClient(runtime);
    const walletProvider = initWalletProvider(runtime);
    const action = new GreenfieldAction(walletProvider, gnfdClient);
    const actionType = content.actionType;
    const spInfo = await action.selectSp();
    elizaLogger11.log("content", content);
    const { bucketName, objectName } = content;
    const attachments = message.content.attachments;
    try {
      let result = "";
      switch (actionType) {
        case "createBucket": {
          const msg = {
            bucketName,
            creator: walletProvider.account.address,
            visibility: VisibilityType.VISIBILITY_TYPE_PUBLIC_READ,
            chargedReadQuota: Long.fromString("0"),
            paymentAddress: walletProvider.account.address,
            primarySpAddress: spInfo.primarySpAddress
          };
          const hash = await action.createBucket(msg);
          const bucketId = await action.headBucket(msg.bucketName);
          result = `create bucket successfully, details: ${config.GREENFIELD_SCAN}/bucket/${toHex(bucketId)}`;
          break;
        }
        case "uploadObject": {
          if (!attachments) {
            throw new Error("no file to upload");
          }
          const uploadObjName = objectName;
          await action.uploadObject({
            bucketName,
            objectName: uploadObjName,
            body: generateFile(attachments[0]),
            delegatedOpts: {
              visibility: VisibilityType.VISIBILITY_TYPE_PUBLIC_READ
            }
          });
          const objectId = await action.headObject(bucketName, objectName);
          if (attachments.length > 1) {
            result += `Only one object can be uploaded. 
`;
          }
          result += `Upload object (${uploadObjName}) successfully, details: ${config.GREENFIELD_SCAN}/object/${toHex(objectId)}`;
          break;
        }
        case "deleteObject": {
          const hash = await action.deleteObject({
            bucketName,
            objectName,
            operator: walletProvider.account.address
          });
          result = `delete object successfully, hash: 0x${hash}`;
          break;
        }
        case "crossChainTransfer": {
          const hash = await action.bnbTransferToGnfd(parseEther5(String(content.amount)), runtime);
          result = `transfer bnb to greenfield successfully, hash: ${hash}`;
          break;
        }
      }
      if (result) {
        callback?.({
          text: result
        });
      } else {
        callback?.({
          text: `Unsuccessfully ${actionType || ""}`,
          content: result
        });
      }
      return true;
    } catch (error) {
      elizaLogger11.error("Error execute greenfield action:", error.message);
      callback?.({
        text: `Bridge failed: ${error.message}`,
        content: { error: error.message }
      });
      return false;
    }
  },
  template: greenfieldTemplate,
  validate: async (_runtime) => {
    return true;
  },
  examples: [
    [
      {
        user: "user",
        content: {
          text: "Create a bucket(${bucketName}) on greenfield",
          action: "GREENFIELD_ACTION"
        }
      },
      {
        user: "user",
        content: {
          text: "Upload a object(${objectName}) in bucket(${bucketName}) on greenfield",
          action: "GREENFIELD_ACTION"
        }
      },
      {
        user: "user",
        content: {
          text: "Delete object(${objectName}) in bucket(${bucketName}) on greenfield",
          action: "GREENFIELD_ACTION"
        }
      },
      {
        user: "user",
        content: {
          text: "Cross Chain Transfer 0.00001 BNB to myself greenfield for create account",
          action: "GREENFIELD_ACTION",
          content: {
            amount: "0.00001"
          }
        }
      }
    ]
  ],
  similes: [
    "GREENFIELD_ACTION",
    "CREATE_BUCKET",
    "UPLOAD_OBJECT",
    "DELETE_BUCKET",
    "TRANSFER_BNB_TO_GREENFIELD"
  ]
};
function generateFile(attachment) {
  const filePath = fixPath(attachment.url);
  elizaLogger11.log("filePath", filePath);
  const stats = statSync(filePath);
  const fileSize = stats.size;
  const name = extname(filePath);
  const type = lookup(name);
  if (!type) throw new Error(`Unsupported file type: ${filePath}`);
  return {
    name: filePath,
    type,
    size: fileSize,
    content: readFileSync(filePath)
  };
}
function fixPath(url) {
  return url.replace("/agent/agent/", "/agent/");
}
function toHex(n) {
  return "0x" + Number(n).toString(16).padStart(64, "0");
}

// src/index.ts
var spinner = ora({
  text: chalk.cyan("Initializing BNB Plugin..."),
  spinner: "dots12",
  color: "cyan"
}).start();
var actions = [
  getBalanceAction,
  transferAction,
  swapAction,
  bridgeAction,
  stakeAction,
  faucetAction,
  deployAction,
  greenfieldAction
];
var BNB_SPLASH = true;
if (BNB_SPLASH) {
  console.log(`
${chalk.cyan("\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510")}`);
  console.log(chalk.cyan("\u2502") + chalk.yellow.bold("          BNB PLUGIN             ") + chalk.cyan(" \u2502"));
  console.log(chalk.cyan("\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524"));
  console.log(chalk.cyan("\u2502") + chalk.white("  Initializing BNB Services...    ") + chalk.cyan("\u2502"));
  console.log(chalk.cyan("\u2502") + chalk.white("  Version: 1.0.0                        ") + chalk.cyan("\u2502"));
  console.log(chalk.cyan("\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518"));
  const config = getConfig();
  const bscProvider = config.BSC_PROVIDER_URL ? chalk.green("\u2713") : chalk.red("\u2717");
  const bscTestnetProvider = config.BSC_TESTNET_PROVIDER_URL ? chalk.green("\u2713") : chalk.red("\u2717");
  const opbnbProvider = config.OPBNB_PROVIDER_URL ? chalk.green("\u2713") : chalk.red("\u2717");
  const wallet = config.BNB_PRIVATE_KEY || config.BNB_PUBLIC_KEY ? chalk.green("\u2713") : chalk.yellow("?");
  console.log(`
${chalk.cyan("\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510")}`);
  console.log(chalk.cyan("\u2502") + chalk.white(" Configuration Status                 ") + chalk.cyan("\u2502"));
  console.log(chalk.cyan("\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524"));
  console.log(chalk.cyan("\u2502") + chalk.white(` BSC Provider    : ${bscProvider}                    `) + chalk.cyan("\u2502"));
  console.log(chalk.cyan("\u2502") + chalk.white(` BSC Testnet     : ${bscTestnetProvider}                    `) + chalk.cyan("\u2502"));
  console.log(chalk.cyan("\u2502") + chalk.white(` OPBNB Provider  : ${opbnbProvider}                    `) + chalk.cyan("\u2502"));
  console.log(chalk.cyan("\u2502") + chalk.white(` Wallet          : ${wallet}                    `) + chalk.cyan("\u2502"));
  console.log(chalk.cyan("\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518"));
  spinner.succeed(chalk.green("BNB Plugin initialized successfully!"));
  const actionTable = new Table({
    head: [
      chalk.cyan("Action"),
      chalk.cyan("H"),
      chalk.cyan("V"),
      chalk.cyan("E"),
      chalk.cyan("Similes")
    ],
    style: {
      head: [],
      border: ["cyan"]
    }
  });
  for (const action of actions) {
    actionTable.push([
      chalk.white(action.name),
      typeof action.handler === "function" ? chalk.green("\u2713") : chalk.red("\u2717"),
      typeof action.validate === "function" ? chalk.green("\u2713") : chalk.red("\u2717"),
      action.examples?.length > 0 ? chalk.green("\u2713") : chalk.red("\u2717"),
      chalk.gray(action.similes?.join(", ") || "none")
    ]);
  }
  console.log(`
${actionTable.toString()}`);
  const statusTable = new Table({
    style: {
      border: ["cyan"]
    }
  });
  statusTable.push(
    [chalk.cyan("Plugin Status")],
    [chalk.white("Name    : ") + chalk.yellow("plugin-bnb")],
    [chalk.white("Actions : ") + chalk.green(actions.length.toString())],
    [chalk.white("Status  : ") + chalk.green("Loaded & Ready")]
  );
  console.log(`
${statusTable.toString()}
`);
} else {
  spinner.stop();
}
var bnbPlugin = {
  name: "bnb",
  description: "BNB Smart Chain (BSC) and opBNB integration plugin supporting transfers, swaps, staking, bridging, and token deployments",
  providers: [bnbWalletProvider],
  services: [],
  actions,
  evaluators: []
};
var index_default = bnbPlugin;
export {
  BridgeAction,
  DeployAction,
  GetBalanceTestnetAction,
  L1StandardBridgeAbi,
  L2StandardBridgeAbi,
  ListaDaoAbi,
  SwapAction,
  TransferAction,
  WalletProvider,
  bnbEnvSchema,
  bnbPlugin,
  bnbWalletProvider,
  bridgeAction,
  bridgeTemplate,
  index_default as default,
  deployAction,
  ercContractTemplate,
  getBalanceTestnetAction,
  getConfig,
  hasWalletConfigured,
  initWalletProvider,
  swapAction,
  swapTemplate,
  transferAction,
  transferTemplate,
  validateBnbConfig
};
//# sourceMappingURL=index.js.map
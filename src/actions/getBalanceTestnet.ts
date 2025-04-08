import {
    composeContext,
    elizaLogger,
    generateObjectDeprecated,
    type HandlerCallback,
    ModelClass,
    type IAgentRuntime,
    type Memory,
    type State,
} from "@elizaos/core";
import { getToken, type ChainId } from "@lifi/sdk";

import {
    bnbWalletProvider,
    initWalletProvider,
    type WalletProvider,
} from "../providers/wallet";
import { getBalanceTemplate } from "../templates";
import type {
    GetBalanceParams,
    GetBalanceResponse,
    SupportedChain,
} from "../types";
import { type Address, erc20Abi, formatEther, formatUnits, isAddress } from "viem";
// Import the environment configuration
import { validateBnbConfig } from "../environment";

// List of supported testnet tokens
const SUPPORTED_TESTNET_TOKENS = ["BNB", "BUSD", "DAI", "ETH", "USDC"];

// Testnet token contract addresses - using the latest valid addresses from Binance Oracle
const TESTNET_TOKEN_ADDRESSES: Record<string, string> = {
    "BNB": "0x64544969ed7EBf5f083679233325356EbE738930",
    "BUSD": "0x48D87A2d14De41E2308A764905B93E05c9377cE1",
    "DAI": "0x46B48c1Ef4B5F15B7DdC415290CEC2f774cD1021",
    "ETH": "0x635780E5D02Ab29d7aE14d266936A38d3D5B0CC5",
    "USDC": "0x053Fc65249dF91a02Ddb294A081f774615aB45F4",
};

// Add logs to display token addresses for debugging
elizaLogger.debug("TESTNET TOKEN ADDRESSES:", TESTNET_TOKEN_ADDRESSES);

export class GetBalanceTestnetAction {
    constructor(private walletProvider: WalletProvider) {
        // Log that the action is being initialized
        elizaLogger.debug("GetBalanceTestnetAction initialized with provider:", 
            { providerType: walletProvider.constructor.name });
    }

    // Helper function to clean and validate token address
    public normalizeTokenAddress(address: string): string | null {
        // Remove any whitespace and make it lowercase
        const cleanedAddress = address.trim().toLowerCase();
        
        // Check if it's a valid format
        const isValidFormat = /^0x[0-9a-f]{40}$/i.test(cleanedAddress);
        if (!isValidFormat) {
            elizaLogger.error(`Invalid token address format: ${address}`);
            return null;
        }
        
        return cleanedAddress;
    }

    // Debug helper to check chain and token information
    private async debugChainAndToken(chain: SupportedChain, token?: string) {
        try {
            // Debug the chain configuration
            const chainConfig = this.walletProvider.getChainConfigs(chain);
            elizaLogger.debug(`Chain config for ${chain}:`, {
                id: chainConfig.id,
                name: chainConfig.name,
                nativeCurrency: chainConfig.nativeCurrency,
                rpcUrls: chainConfig.rpcUrls
            });
            
            // If token is provided, try to get more information about it
            if (token) {
                if (token.startsWith("0x") && token.length === 42) {
                    // If it's an address, try to get token info from the contract
                    try {
                        const publicClient = this.walletProvider.getPublicClient(chain);
                        elizaLogger.debug(`Public client for ${chain}:`, 
                            { clientType: publicClient.constructor.name });
                        
                        elizaLogger.debug(`Attempting to read token contract at ${token}`);
                        const decimals = await publicClient.readContract({
                            address: token as `0x${string}`,
                            abi: erc20Abi,
                            functionName: "decimals",
                        }).catch(e => {
                            elizaLogger.debug(`Failed to get decimals for token ${token}:`, e.message);
                            return null;
                        });
                        
                        const symbol = await publicClient.readContract({
                            address: token as `0x${string}`,
                            abi: erc20Abi,
                            functionName: "symbol",
                        }).catch(e => {
                            elizaLogger.debug(`Failed to get symbol for token ${token}:`, e.message);
                            return null;
                        });
                        
                        elizaLogger.debug(`Token information for ${token}:`, {
                            symbol,
                            decimals
                        });
                    } catch (error) {
                        elizaLogger.error(`Error getting token info:`, error.message, error.stack);
                    }
                } else {
                    // If it's a symbol, check our mapping
                    const upperToken = token.toUpperCase();
                    const mappedAddress = TESTNET_TOKEN_ADDRESSES[upperToken];
                    elizaLogger.debug(`Token symbol ${token} maps to address:`, mappedAddress || "Not found in mapping");
                    
                    if (!mappedAddress) {
                        elizaLogger.error(`Token ${token} not found in mapping. Available tokens:`, 
                            Object.keys(TESTNET_TOKEN_ADDRESSES));
                    }
                }
            }
        } catch (error) {
            elizaLogger.error("Error in debugChainAndToken:", error.message, error.stack);
        }
    }

    // Debug helper to directly check balance via BSCScan API
    private async checkBalanceViaBscScan(address: string): Promise<string | null> {
        try {
            elizaLogger.debug(`Checking balance via BSCScan API for address: ${address}`);
            
            // This is just for debugging - in production you would use an API key
            const url = `https://api-testnet.bscscan.com/api?module=account&action=balance&address=${address}&tag=latest`;
            
            elizaLogger.debug(`Fetching from URL: ${url}`);
            
            // Make a fetch request to get the balance
            const response = await fetch(url);
            const data = await response.json();
            
            elizaLogger.debug(`BSCScan API response:`, data);
            
            if (data.status === "1" && data.message === "OK") {
                const weiBalance = data.result;
                const ethBalance = formatEther(BigInt(weiBalance));
                elizaLogger.debug(`BSCScan reports balance: ${ethBalance} BNB`);
                return ethBalance;
            } else {
                elizaLogger.error(`BSCScan API error: ${data.message}`);
                return null;
            }
        } catch (error) {
            elizaLogger.error(`Error checking BSCScan balance: ${error.message}`);
            return null;
        }
    }

    async getBalance(params: GetBalanceParams): Promise<GetBalanceResponse> {
        elizaLogger.debug("Get testnet balance params:", params);
        await this.validateAndNormalizeParams(params);
        elizaLogger.debug("Normalized get testnet balance params:", params);

        // Force chain to be bscTestnet
        params.chain = "bscTestnet";
        
        // Debug chain and token information to help troubleshoot
        await this.debugChainAndToken("bscTestnet", params.token);
        
        const { chain, address, token } = params;
        if (!address) {
            elizaLogger.error("Address is required but was not provided");
            throw new Error("Address is required for getting balance");
        }

        elizaLogger.debug(`Switching to chain: ${chain}`);
        this.walletProvider.switchChain(chain);
        const nativeSymbol =
            this.walletProvider.getChainConfigs(chain).nativeCurrency.symbol;
        elizaLogger.debug(`Native symbol for chain ${chain}: ${nativeSymbol}`);

        let queryNativeToken = false;
        if (
            !token ||
            token === "" ||
            token.toLowerCase() === "bnb" ||
            token.toLowerCase() === "tbnb"
        ) {
            elizaLogger.debug(`Will query native token (${nativeSymbol}) balance`);
            queryNativeToken = true;
        }

        const resp: GetBalanceResponse = {
            chain,
            address,
        };

        // If ERC20 token is requested
        if (!queryNativeToken) {
            let tokenAddress: string;

            // Check if token is already an address
            if (isAddress(token)) {
                elizaLogger.debug(`Token is already an address: ${token}`);
                const normalizedAddress = this.normalizeTokenAddress(token);
                if (!normalizedAddress) {
                    throw new Error(`Invalid token address format: ${token}. Please provide a valid token address or symbol.`);
                }
                tokenAddress = normalizedAddress;
            } else {
                // Look up token in our testnet mapping
                const upperToken = token.toUpperCase();
                elizaLogger.debug(`Looking up token symbol in testnet mapping: ${upperToken}`);
                
                // Use the new wallet provider method for testnet token resolution
                const mappedAddress = this.walletProvider.getTestnetTokenAddress(upperToken);
                
                if (!mappedAddress) {
                    elizaLogger.error(`Token ${token} not found in testnet mapping`);
                    throw new Error(`Token ${token} is not supported on BSC testnet. Supported tokens: ${SUPPORTED_TESTNET_TOKENS.join(', ')}`);
                }
                
                tokenAddress = mappedAddress;
                elizaLogger.debug(`Resolved token symbol ${token} to address: ${tokenAddress}`);
            }

            elizaLogger.debug(`Getting ERC20 balance for address ${address} and token ${tokenAddress}`);
            try {
                const amount = await this.getERC20TokenBalance(
                    chain,
                    address,
                    tokenAddress as `0x${string}`
                );
                elizaLogger.debug(`ERC20 balance result: ${amount} ${token}`);
                resp.balance = { token, amount };
            } catch (error) {
                elizaLogger.error(`Error getting ERC20 balance: ${error.message}`, error.stack);
                throw error;
            }
        } else {
            // If native token is requested
            elizaLogger.debug(`Getting native token balance for address ${address}`);
            try {
                const publicClient = this.walletProvider.getPublicClient(chain);
                
                // Log more details about the public client and RPC URL
                const chainConfig = this.walletProvider.getChainConfigs(chain);
                elizaLogger.debug(`Using RPC URL for chain ${chain}:`, {
                    defaultRpc: chainConfig.rpcUrls.default.http[0],
                    customRpc: chainConfig.rpcUrls.custom?.http[0],
                    usingCustom: !!chainConfig.rpcUrls.custom
                });
                
                // Check if we're connected to the correct chain
                const chainId = await publicClient.getChainId().catch(e => {
                    elizaLogger.error(`Failed to get chain ID: ${e.message}`);
                    return null;
                });
                elizaLogger.debug(`Connected to chain ID: ${chainId}, expected: ${chainConfig.id}`);
                
                elizaLogger.debug(`Requesting balance for address: ${address}`);
                const nativeBalanceWei = await publicClient.getBalance({ address });
                elizaLogger.debug(`Raw balance result (Wei): ${nativeBalanceWei.toString()}`);
                
                const formattedBalance = formatEther(nativeBalanceWei);
                elizaLogger.debug(`Formatted balance: ${formattedBalance} ${nativeSymbol}`);
                
                // If balance is 0, double-check with BSCScan API
                if (nativeBalanceWei === 0n) {
                    elizaLogger.debug(`Balance is 0, double-checking with BSCScan API`);
                    const bscScanBalance = await this.checkBalanceViaBscScan(address);
                    
                    if (bscScanBalance && parseFloat(bscScanBalance) > 0) {
                        elizaLogger.debug(`BSCScan reports non-zero balance: ${bscScanBalance} BNB`);
                        resp.balance = {
                            token: nativeSymbol,
                            amount: bscScanBalance,
                        };
                        return resp;
                    }
                }
                
                resp.balance = {
                    token: nativeSymbol,
                    amount: formattedBalance,
                };
            } catch (error) {
                elizaLogger.error(`Error getting native balance: ${error.message}`, error.stack);
                
                // Try fallback to BSCScan
                elizaLogger.debug(`Trying BSCScan API as fallback`);
                const bscScanBalance = await this.checkBalanceViaBscScan(address);
                
                if (bscScanBalance) {
                    elizaLogger.debug(`BSCScan reports balance: ${bscScanBalance} BNB`);
                    resp.balance = {
                        token: nativeSymbol,
                        amount: bscScanBalance,
                    };
                    return resp;
                }
                
                throw error;
            }
        }

        elizaLogger.debug(`Get balance response:`, resp);
        return resp;
    }

    async getERC20TokenBalance(
        chain: SupportedChain,
        address: Address,
        tokenAddress: Address
    ): Promise<string> {
        try {
            elizaLogger.debug(`Getting ERC20 token balance for address ${address} and token ${tokenAddress} on chain ${chain}`);
            const publicClient = this.walletProvider.getPublicClient(chain);
            elizaLogger.debug(`Public client for chain ${chain}:`, {
                clientType: publicClient.constructor.name
            });
            
            elizaLogger.debug(`Reading balanceOf for token ${tokenAddress}`);
            
            // Wrap contract calls in try/catch to handle contract reverts gracefully
            let balance: bigint;
            try {
                balance = await publicClient.readContract({
                    address: tokenAddress,
                    abi: erc20Abi,
                    functionName: "balanceOf",
                    args: [address],
                });
            } catch (e) {
                elizaLogger.error(`Contract call to balanceOf failed: ${e.message}`);
                elizaLogger.debug(`Contract error details:`, e);
                // If the balanceOf call fails, the contract might not be valid
                // or the token might not exist on testnet
                elizaLogger.warn(`Token ${tokenAddress} might not exist on BSC testnet or isn't a valid ERC20 token`);
                return "0";
            }
            
            elizaLogger.debug(`Raw balance result: ${balance.toString()}`);

            // Wrap decimals call in try/catch as well
            let decimals: number;
            try {
                decimals = await publicClient.readContract({
                    address: tokenAddress,
                    abi: erc20Abi,
                    functionName: "decimals",
                });
            } catch (e) {
                elizaLogger.error(`Contract call to decimals failed: ${e.message}`);
                // Default to 18 decimals if the call fails
                elizaLogger.warn(`Defaulting to 18 decimals for token ${tokenAddress}`);
                decimals = 18;
            }
            
            elizaLogger.debug(`Token decimals: ${decimals}`);

            const formattedBalance = formatUnits(balance, decimals);
            elizaLogger.debug(`Formatted balance: ${formattedBalance}`);
            return formattedBalance;
        } catch (error) {
            elizaLogger.error(`Error getting ERC20 balance: ${error.message}`, error.stack);
            // Return "0" instead of throwing to provide a better user experience
            return "0";
        }
    }

    async validateAndNormalizeParams(params: GetBalanceParams): Promise<void> {
        try {
            // Force chain to be bscTestnet
            params.chain = "bscTestnet";
            
            // If no address provided, use the wallet's own address
            if (!params.address) {
                params.address = this.walletProvider.getAddress();
                elizaLogger.debug(`No address provided, using wallet address: ${params.address}`);
                return;
            }
            
            // Convert address to string for string comparisons
            const addressStr = String(params.address);
            
            // If address is null or invalid strings, use wallet address
            if (addressStr === 'null' || addressStr === 'undefined') {
                params.address = this.walletProvider.getAddress();
                elizaLogger.debug(`Invalid address string provided, using wallet address: ${params.address}`);
                return;
            }
            
            // If address already looks like a valid hex address, use it directly
            if (addressStr.startsWith("0x") && addressStr.length === 42) {
                elizaLogger.debug(`Using valid hex address: ${params.address}`);
                return;
            }
            
            // Skip web3 name resolution for common token names that might have been
            // mistakenly parsed as addresses
            const commonTokens = ['USDT', 'USDC', 'BNB', 'ETH', 'BUSD', 'WBNB', 'CAKE'];
            if (commonTokens.includes(addressStr.toUpperCase())) {
                elizaLogger.debug(`Address looks like a token symbol: ${params.address}, using wallet address instead`);
                params.address = this.walletProvider.getAddress();
                return;
            }
            
            // SKIP WEB3NAME RESOLUTION ON TESTNET - it doesn't work and causes errors
            elizaLogger.debug(`Web3Name resolution skipped on testnet for: ${params.address}`);
            
            // If it looks like a potential wallet address, try to use it
            if (addressStr.startsWith("0x")) {
                elizaLogger.warn(`Address "${params.address}" doesn't look like a standard Ethereum address but will be used as is`);
                return;
            }
            
            // If we get here, we couldn't parse the address at all
            // Fall back to the wallet's address
            elizaLogger.warn(`Could not resolve address: ${params.address}, falling back to wallet address`);
            params.address = this.walletProvider.getAddress();
        } catch (error) {
            elizaLogger.error(`Error validating address: ${error.message}`);
            // Fall back to wallet's own address if there's an error
            params.address = this.walletProvider.getAddress();
        }
    }
}

// Direct export of the action for use in the main plugin
export const getBalanceTestnetAction = {
    name: "getBalanceTestnet",
    description: "Get testnet balance of a token on BSC for the given address",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting getBalanceTestnet action...");
        
        // Verify that the testnet configuration is correct
        try {
            const config = await validateBnbConfig(runtime);
            elizaLogger.debug("BNB config:", {
                hasPrivateKey: !!config.BNB_PRIVATE_KEY,
                hasPublicKey: !!config.BNB_PUBLIC_KEY,
                bscTestnetUrl: config.BSC_TESTNET_PROVIDER_URL
            });
            
            // Log the RPC URL to make sure we're using the right one
            elizaLogger.debug(`Using BSC Testnet RPC URL: ${config.BSC_TESTNET_PROVIDER_URL}`);
            
            // Override the default RPC URL with a known working one if needed
            if (config.BSC_TESTNET_PROVIDER_URL === "https://data-seed-prebsc-2-s3.bnbchain.org:8545") {
                elizaLogger.debug("Using default RPC URL. Consider using a more reliable one like https://data-seed-prebsc-2-s3.bnbchain.org:8545/");
            }
        } catch (error) {
            elizaLogger.error("Failed to validate BNB config:", error.message);
        }

        // Initialize or update state
        let currentState = state;
        if (!currentState) {
            currentState = (await runtime.composeState(message)) as State;
        } else {
            currentState = await runtime.updateRecentMessageState(currentState);
        }
        
        try {
            state.walletInfo = await bnbWalletProvider.get(
                runtime,
                message,
                currentState
            );
            elizaLogger.debug("Wallet info:", state.walletInfo);
        } catch (error) {
            elizaLogger.error("Error getting wallet info:", error.message, error.stack);
        }

        // Compose context
        const getBalanceContext = composeContext({
            state: currentState,
            template: getBalanceTemplate,
        });
        
        elizaLogger.debug("Generating content from template...");
        const content = await generateObjectDeprecated({
            runtime,
            context: getBalanceContext,
            modelClass: ModelClass.LARGE,
        });
        elizaLogger.debug("Generated content:", content);

        try {
            elizaLogger.debug("Initializing wallet provider...");
            const walletProvider = initWalletProvider(runtime);
            const action = new GetBalanceTestnetAction(walletProvider);
            
            // Check if a token address was provided directly
            let tokenInput = content.token;
            const originalToken = tokenInput; // Store the original token input
            
            elizaLogger.debug(`Original token input: ${originalToken}`);
            
            // Special handling for token string
            if (tokenInput) {
                tokenInput = tokenInput.trim();
                
                // Check if it looks like a direct token address
                if (tokenInput.startsWith("0x")) {
                    // Try to clean and normalize it
                    const normalizedAddress = action.normalizeTokenAddress(tokenInput);
                    if (normalizedAddress) {
                        elizaLogger.debug(`Using normalized token address: ${normalizedAddress}`);
                        tokenInput = normalizedAddress;
                    } else {
                        // If invalid format but starts with 0x, try finding it in our mapping first
                        const upperToken = tokenInput.replace(/^0x/i, "").toUpperCase();
                        // Use the new wallet provider method for testnet token resolution
                        const mappedAddress = walletProvider.getTestnetTokenAddress(upperToken);
                        if (mappedAddress) {
                            elizaLogger.debug(`Found token symbol in mapping despite 0x prefix: ${upperToken}`);
                            tokenInput = mappedAddress;
                        } else {
                            // It's truly an invalid address
                            if (callback) {
                                callback({
                                    text: `The token address "${tokenInput}" appears to be invalid. Please provide a valid token address or use one of the supported token symbols: ${SUPPORTED_TESTNET_TOKENS.join(', ')}`,
                                    content: {
                                        error: `Invalid token address: ${tokenInput}`,
                                        chain: "bscTestnet",
                                        supportedTokens: SUPPORTED_TESTNET_TOKENS
                                    },
                                });
                            }
                            return false;
                        }
                    }
                } else {
                    // It's a symbol, convert to uppercase and look in our mapping
                    const upperToken = tokenInput.toUpperCase();
                    elizaLogger.debug(`Looking up token symbol: ${upperToken}`);
                    
                    // Use the new wallet provider method for testnet token resolution
                    const mappedAddress = walletProvider.getTestnetTokenAddress(upperToken);
                    
                    if (mappedAddress) {
                        elizaLogger.debug(`Mapped token symbol ${tokenInput} to address: ${mappedAddress}`);
                        tokenInput = mappedAddress;
                    } else {
                        // It's unlikely that lifi sdk will have testnet tokens,
                        // so we'll just skip this fallback and show the user-friendly error
                        elizaLogger.error(`Token ${tokenInput} not found in mapping`);
                        if (callback) {
                            callback({
                                text: `Token "${tokenInput}" is not supported on BSC testnet. Supported tokens: ${SUPPORTED_TESTNET_TOKENS.join(', ')}`,
                                content: {
                                    error: `Unsupported token: ${tokenInput}`,
                                    chain: "bscTestnet",
                                    supportedTokens: SUPPORTED_TESTNET_TOKENS
                                },
                            });
                        }
                        return false;
                    }
                }
            } else {
                elizaLogger.debug("No token specified, will use native token (BNB)");
            }
            
            const getBalanceOptions: GetBalanceParams = {
                chain: "bscTestnet", // Force use of testnet
                address: content.address,
                token: tokenInput,
            };
            elizaLogger.debug("Balance options:", getBalanceOptions);
            
            try {
                elizaLogger.debug(`Attempting to get balance for token: ${getBalanceOptions.token}`);
                
                // Ensure we're using a valid token format
                // If the token starts with 0x and is 42 characters, it's likely a direct address
                // and should be used as-is
                if (typeof getBalanceOptions.token === 'string' && 
                    getBalanceOptions.token.startsWith('0x') && 
                    getBalanceOptions.token.length === 42) {
                    elizaLogger.debug(`Using direct token address: ${getBalanceOptions.token}`);
                    // The token value is already set correctly
                } else {
                    // For token symbols, we've already converted them to addresses in the previous steps
                    elizaLogger.debug(`Using previously mapped token address: ${getBalanceOptions.token}`);
                }
                
                const getBalanceResp = await action.getBalance(getBalanceOptions);
                elizaLogger.debug("Balance response:", getBalanceResp);
                
                if (callback) {
                    let text = `No balance found for ${getBalanceOptions.address} on BSC Testnet`;
                    if (getBalanceResp.balance) {
                        // Use the original token symbol/address in the user response for clarity
                        const displayToken = originalToken ? originalToken.toUpperCase() : "BNB";
                        text = `Balance of ${getBalanceResp.address} on BSC Testnet:\n${
                            displayToken
                        }: ${getBalanceResp.balance.amount}`;
                    }
                    elizaLogger.debug("Callback response text:", text);
                    callback({
                        text,
                        content: { ...getBalanceResp },
                    });
                }
                return true;
            } catch (error) {
                elizaLogger.error("Error during get testnet balance:", error.message, error.stack);
                
                // Provide more user-friendly error messages based on error type
                let userMessage = `Error checking testnet balance on BSC Testnet: ${error.message}`;
                
                // Check for common error cases
                if (error.message.includes("getTldInfo") || error.message.includes("Only BSC mainnet supports looking up tokens")) {
                    userMessage = `Could not find token "${originalToken || getBalanceOptions.token}" on BSC Testnet. Supported tokens: ${SUPPORTED_TESTNET_TOKENS.join(', ')}`;
                } else if (error.message.includes("No URL was provided")) {
                    userMessage = "Network connection issue. Please check your BSC_TESTNET_PROVIDER_URL configuration.";
                } else if (error.message.includes("Invalid address")) {
                    userMessage = "The address provided is invalid. Please provide a valid wallet address.";
                } else if (error.message.includes("not supported on BSC testnet")) {
                    userMessage = error.message;
                } else if (error.message.includes("Contract 0x")) {
                    userMessage = "Contract error. The token contract at the given address may not be valid on BSC testnet.";
                } else if (originalToken && originalToken.startsWith("0x")) {
                    // Special case for direct token addresses that failed
                    userMessage = `The token address "${originalToken}" could not be queried on BSC Testnet. Please check that it's a valid token contract address.`;
                }
                
                elizaLogger.debug("Error user message:", userMessage);
                callback?.({
                    text: userMessage,
                    content: { 
                        error: error.message,
                        chain: "bscTestnet",
                        token: originalToken || getBalanceOptions.token,
                        supportedTokens: SUPPORTED_TESTNET_TOKENS
                    },
                });
                return false;
            }
        } catch (error) {
            elizaLogger.error("Critical error in getBalanceTestnet handler:", error.message, error.stack);
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
    validate: async (_runtime: IAgentRuntime) => {
        return true;
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Check my testnet balance of BNB",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I'll help you check your balance of BNB on BSC Testnet",
                    action: "GET_BALANCE_TESTNET",
                    content: {
                        chain: "bscTestnet",
                        address: "{{walletAddress}}",
                        token: "USDC",
                    },
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Check my BNB balance on testnet",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I'll help you check your BNB balance on BSC Testnet",
                    action: "GET_BALANCE_TESTNET",
                    content: {
                        chain: "bscTestnet",
                        address: "{{walletAddress}}",
                        token: "BNB",
                    },
                },
            },
        ],
    ],
    similes: ["GET_BALANCE_TESTNET", "CHECK_TESTNET_BALANCE"],
};

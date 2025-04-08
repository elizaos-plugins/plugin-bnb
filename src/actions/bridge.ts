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
import { parseEther, getContract, parseUnits, erc20Abi } from "viem";

import {
    bnbWalletProvider,
    initWalletProvider,
    type WalletProvider,
} from "../providers/wallet";
import { bridgeTemplate } from "../templates";
import {
    L1StandardBridgeAbi,
    L2StandardBridgeAbi,
    type BridgeParams,
    type BridgeResponse,
    type SupportedChain,
} from "../types";

export { bridgeTemplate };

/**
 * Helper function to check if a value is a "null" string and convert it to undefined
 */
function convertNullStringToUndefined<T>(value: T | string | undefined | null): T | undefined {
    if (value === "null" || value === null) {
        return undefined;
    }
    return value as T;
}

// Exported for tests
export class BridgeAction {
    private readonly L1_BRIDGE_ADDRESS =
        "0xF05F0e4362859c3331Cb9395CBC201E3Fa6757Ea" as const;
    private readonly L2_BRIDGE_ADDRESS =
        "0x4000698e3De52120DE28181BaACda82B21568416" as const;
    private readonly LEGACY_ERC20_ETH =
        "0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000" as const;

    constructor(private walletProvider: WalletProvider) {}

    async bridge(params: BridgeParams): Promise<BridgeResponse> {
        elizaLogger.debug("Starting bridge operation with params:", JSON.stringify(params, null, 2));
        
        // Validate and normalize parameters
        await this.validateAndNormalizeParams(params);
        elizaLogger.debug("After validation, bridge params:", JSON.stringify(params, null, 2));

        // Get wallet address and prepare chain switching
        const fromAddress = this.walletProvider.getAddress();
        elizaLogger.debug(`From address: ${fromAddress}`);
        elizaLogger.debug(`Switching to chain: ${params.fromChain}`);
        
        this.walletProvider.switchChain(params.fromChain);
        const walletClient = this.walletProvider.getWalletClient(params.fromChain);
        const publicClient = this.walletProvider.getPublicClient(params.fromChain);

        // Get native token for the chain
        const nativeToken = this.walletProvider.chains[params.fromChain].nativeCurrency.symbol;
        elizaLogger.debug(`Native token for chain ${params.fromChain}: ${nativeToken}`);

        // Prepare response object
        const resp: BridgeResponse = {
            fromChain: params.fromChain,
            toChain: params.toChain,
            txHash: "0x",
            recipient: params.toAddress ?? fromAddress,
            amount: params.amount,
            fromToken: params.fromToken ?? nativeToken,
            toToken: params.toToken ?? nativeToken,
        };
        
        elizaLogger.debug(`Bridge response initialized:`, JSON.stringify(resp, null, 2));

        // Get account and chain config
        const account = this.walletProvider.getAccount();
        const chain = this.walletProvider.getChainConfigs(params.fromChain);
        elizaLogger.debug(`Using account: ${account.address}`);
        elizaLogger.debug(`Chain config: ${chain.name} (ID: ${chain.id})`);

        // Determine bridge parameters
        const selfBridge = !params.toAddress || params.toAddress === fromAddress;
        const nativeTokenBridge = !params.fromToken || params.fromToken === nativeToken;
        
        elizaLogger.debug(`Self bridge: ${selfBridge}`);
        elizaLogger.debug(`Native token bridge: ${nativeTokenBridge}`);

        // Parse amount
        let amount: bigint;
        if (nativeTokenBridge) {
            amount = parseEther(params.amount);
            elizaLogger.debug(`Native token amount: ${amount} wei (${params.amount} ${nativeToken})`);
        } else {
            elizaLogger.debug(`Reading decimals for token: ${params.fromToken}`);
            const decimals = await publicClient.readContract({
                address: params.fromToken!,
                abi: erc20Abi,
                functionName: "decimals",
            });
            
            amount = parseUnits(params.amount, decimals);
            elizaLogger.debug(`Token amount: ${amount} (${params.amount} tokens with ${decimals} decimals)`);
        }

        try {
            // Handle BSC to opBNB bridging
            if (params.fromChain === "bsc" && params.toChain === "opBNB") {
                elizaLogger.debug(`Bridging from L1 (BSC) to L2 (opBNB)`);
                elizaLogger.debug(`Using L1 bridge contract: ${this.L1_BRIDGE_ADDRESS}`);
                
                // Set up L1 bridge contract
                const l1BridgeContract = getContract({
                    address: this.L1_BRIDGE_ADDRESS,
                    abi: L1StandardBridgeAbi,
                    client: {
                        public: publicClient,
                        wallet: walletClient,
                    },
                });

                // Check ERC20 allowance if not native token
                if (!nativeTokenBridge) {
                    elizaLogger.debug(`Checking ERC20 allowance for L1 bridge`);
                    const allowance = await this.walletProvider.checkERC20Allowance(
                        params.fromChain,
                        params.fromToken!,
                        fromAddress,
                        this.L1_BRIDGE_ADDRESS
                    );
                    elizaLogger.debug(`Current allowance: ${allowance}`);
                    
                    if (allowance < amount) {
                        const neededAllowance = amount - allowance;
                        elizaLogger.debug(`Increasing ERC20 allowance by ${neededAllowance}`);
                        
                        const txHash = await this.walletProvider.approveERC20(
                            params.fromChain,
                            params.fromToken!,
                            this.L1_BRIDGE_ADDRESS,
                            amount
                        );
                        elizaLogger.debug(`Approval transaction submitted with hash: ${txHash}`);
                        
                        await publicClient.waitForTransactionReceipt({
                            hash: txHash,
                        });
                        elizaLogger.debug(`Approval transaction confirmed`);
                    } else {
                        elizaLogger.debug(`Sufficient allowance already granted`);
                    }
                }

                // Execute the appropriate bridge function based on parameters
                if (selfBridge && nativeTokenBridge) {
                    elizaLogger.debug(`Self bridge with native token - using depositETH`);
                    const args = [1, "0x"] as const;
                    
                    elizaLogger.debug(`Simulating depositETH with value: ${amount}`);
                    await l1BridgeContract.simulate.depositETH(args, {
                        value: amount,
                    });
                    
                    elizaLogger.debug(`Executing depositETH transaction`);
                    resp.txHash = await l1BridgeContract.write.depositETH(args, {
                        account,
                        chain,
                        value: amount,
                    });
                    elizaLogger.debug(`Transaction submitted with hash: ${resp.txHash}`);
                } else if (selfBridge && !nativeTokenBridge) {
                    elizaLogger.debug(`Self bridge with ERC20 token - using depositERC20`);
                    elizaLogger.debug(`From token: ${params.fromToken}, To token: ${params.toToken}`);
                    
                    const args = [
                        params.fromToken!,
                        params.toToken!,
                        amount,
                        1,
                        "0x",
                    ] as const;
                    
                    elizaLogger.debug(`Simulating depositERC20`);
                    await l1BridgeContract.simulate.depositERC20(args, {
                        account,
                    });
                    
                    elizaLogger.debug(`Executing depositERC20 transaction`);
                    resp.txHash = await l1BridgeContract.write.depositERC20(args, {
                        account,
                        chain,
                    });
                    elizaLogger.debug(`Transaction submitted with hash: ${resp.txHash}`);
                } else if (!selfBridge && nativeTokenBridge) {
                    elizaLogger.debug(`Bridge to another address with native token - using depositETHTo`);
                    elizaLogger.debug(`Recipient address: ${params.toAddress}`);
                    
                    const args = [params.toAddress!, 1, "0x"] as const;
                    
                    elizaLogger.debug(`Simulating depositETHTo with value: ${amount}`);
                    await l1BridgeContract.simulate.depositETHTo(args, {
                        value: amount,
                    });
                    
                    elizaLogger.debug(`Executing depositETHTo transaction`);
                    resp.txHash = await l1BridgeContract.write.depositETHTo(args, {
                        account,
                        chain,
                        value: amount,
                    });
                    elizaLogger.debug(`Transaction submitted with hash: ${resp.txHash}`);
                } else {
                    elizaLogger.debug(`Bridge to another address with ERC20 token - using depositERC20To`);
                    elizaLogger.debug(`From token: ${params.fromToken}, To token: ${params.toToken}`);
                    elizaLogger.debug(`Recipient address: ${params.toAddress}`);
                    
                    const args = [
                        params.fromToken!,
                        params.toToken!,
                        params.toAddress!,
                        amount,
                        1,
                        "0x",
                    ] as const;
                    
                    elizaLogger.debug(`Simulating depositERC20To`);
                    await l1BridgeContract.simulate.depositERC20To(args, {
                        account,
                    });
                    
                    elizaLogger.debug(`Executing depositERC20To transaction`);
                    resp.txHash = await l1BridgeContract.write.depositERC20To(
                        args,
                        {
                            account,
                            chain,
                        }
                    );
                    elizaLogger.debug(`Transaction submitted with hash: ${resp.txHash}`);
                }
            } 
            // Handle opBNB to BSC bridging
            else if (params.fromChain === "opBNB" && params.toChain === "bsc") {
                elizaLogger.debug(`Bridging from L2 (opBNB) to L1 (BSC)`);
                elizaLogger.debug(`Using L2 bridge contract: ${this.L2_BRIDGE_ADDRESS}`);
                
                // Set up L2 bridge contract
                const l2BridgeContract = getContract({
                    address: this.L2_BRIDGE_ADDRESS,
                    abi: L2StandardBridgeAbi,
                    client: {
                        public: publicClient,
                        wallet: walletClient,
                    },
                });

                // Get delegation fee
                elizaLogger.debug(`Reading delegation fee from bridge contract`);
                const delegationFee = await publicClient.readContract({
                    address: this.L2_BRIDGE_ADDRESS,
                    abi: L2StandardBridgeAbi,
                    functionName: "delegationFee",
                });
                elizaLogger.debug(`Delegation fee: ${delegationFee}`);

                // Check ERC20 allowance if not native token
                if (!nativeTokenBridge) {
                    elizaLogger.debug(`Checking ERC20 allowance for L2 bridge`);
                    const allowance = await this.walletProvider.checkERC20Allowance(
                        params.fromChain,
                        params.fromToken!,
                        fromAddress,
                        this.L2_BRIDGE_ADDRESS
                    );
                    elizaLogger.debug(`Current allowance: ${allowance}`);
                    
                    if (allowance < amount) {
                        const neededAllowance = amount - allowance;
                        elizaLogger.debug(`Increasing ERC20 allowance by ${neededAllowance}`);
                        
                        const txHash = await this.walletProvider.approveERC20(
                            params.fromChain,
                            params.fromToken!,
                            this.L2_BRIDGE_ADDRESS,
                            amount
                        );
                        elizaLogger.debug(`Approval transaction submitted with hash: ${txHash}`);
                        
                        await publicClient.waitForTransactionReceipt({
                            hash: txHash,
                        });
                        elizaLogger.debug(`Approval transaction confirmed`);
                    } else {
                        elizaLogger.debug(`Sufficient allowance already granted`);
                    }
                }

                // Execute the appropriate bridge function based on parameters
                if (selfBridge && nativeTokenBridge) {
                    elizaLogger.debug(`Self bridge with native token - using withdraw with LEGACY_ERC20_ETH`);
                    
                    const args = [this.LEGACY_ERC20_ETH, amount, 1, "0x"] as const;
                    const value = amount + delegationFee;
                    
                    elizaLogger.debug(`Simulating withdraw with value: ${value} (amount + delegationFee)`);
                    await l2BridgeContract.simulate.withdraw(args, { value });
                    
                    elizaLogger.debug(`Executing withdraw transaction`);
                    resp.txHash = await l2BridgeContract.write.withdraw(args, {
                        account,
                        chain,
                        value,
                    });
                    elizaLogger.debug(`Transaction submitted with hash: ${resp.txHash}`);
                } else if (selfBridge && !nativeTokenBridge) {
                    elizaLogger.debug(`Self bridge with ERC20 token - using withdraw`);
                    elizaLogger.debug(`Token: ${params.fromToken}`);
                    
                    const args = [params.fromToken!, amount, 1, "0x"] as const;
                    const value = delegationFee;
                    
                    elizaLogger.debug(`Simulating withdraw with delegationFee: ${value}`);
                    await l2BridgeContract.simulate.withdraw(args, {
                        account,
                        value,
                    });
                    
                    elizaLogger.debug(`Executing withdraw transaction`);
                    resp.txHash = await l2BridgeContract.write.withdraw(args, {
                        account,
                        chain,
                        value,
                    });
                    elizaLogger.debug(`Transaction submitted with hash: ${resp.txHash}`);
                } else if (!selfBridge && nativeTokenBridge) {
                    elizaLogger.debug(`Bridge to another address with native token - using withdrawTo with LEGACY_ERC20_ETH`);
                    elizaLogger.debug(`Recipient address: ${params.toAddress}`);
                    
                    const args = [
                        this.LEGACY_ERC20_ETH,
                        params.toAddress!,
                        amount,
                        1,
                        "0x",
                    ] as const;
                    const value = amount + delegationFee;
                    
                    elizaLogger.debug(`Simulating withdrawTo with value: ${value} (amount + delegationFee)`);
                    await l2BridgeContract.simulate.withdrawTo(args, { value });
                    
                    elizaLogger.debug(`Executing withdrawTo transaction`);
                    resp.txHash = await l2BridgeContract.write.withdrawTo(args, {
                        account,
                        chain,
                        value,
                    });
                    elizaLogger.debug(`Transaction submitted with hash: ${resp.txHash}`);
                } else {
                    elizaLogger.debug(`Bridge to another address with ERC20 token - using withdrawTo`);
                    elizaLogger.debug(`Token: ${params.fromToken}`);
                    elizaLogger.debug(`Recipient address: ${params.toAddress}`);
                    
                    const args = [
                        params.fromToken!,
                        params.toAddress!,
                        amount,
                        1,
                        "0x",
                    ] as const;
                    const value = delegationFee;
                    
                    elizaLogger.debug(`Simulating withdrawTo with delegationFee: ${value}`);
                    await l2BridgeContract.simulate.withdrawTo(args, {
                        account,
                        value,
                    });
                    
                    elizaLogger.debug(`Executing withdrawTo transaction`);
                    resp.txHash = await l2BridgeContract.write.withdrawTo(args, {
                        account,
                        chain,
                        value,
                    });
                    elizaLogger.debug(`Transaction submitted with hash: ${resp.txHash}`);
                }
            } else {
                elizaLogger.error(`Unsupported bridge direction: ${params.fromChain} to ${params.toChain}`);
                throw new Error(`Unsupported bridge direction: ${params.fromChain} to ${params.toChain}. Only BSC ↔ opBNB is supported.`);
            }

            // Verify transaction hash
            if (!resp.txHash || resp.txHash === "0x") {
                elizaLogger.error("Failed to get transaction hash");
                throw new Error("Get transaction hash failed");
            }

            // Wait for transaction confirmation
            elizaLogger.debug(`Waiting for transaction confirmation: ${resp.txHash}`);
            await publicClient.waitForTransactionReceipt({
                hash: resp.txHash,
            });
            elizaLogger.debug(`Transaction confirmed: ${resp.txHash}`);

            return resp;
        } catch (error) {
            elizaLogger.error(`Error executing bridge operation:`, error);
            
            // Enhance error message based on common bridge errors
            if (error.message.includes("insufficient funds")) {
                throw new Error(`Insufficient funds to bridge ${params.amount} ${resp.fromToken}. Please check your balance.`);
            } else if (error.message.includes("user rejected")) {
                throw new Error("Transaction rejected by user.");
            } else if (error.message.includes("execution reverted")) {
                throw new Error(`Bridge transaction reverted. This could be due to contract restrictions or incorrect parameters.`);
            }
            
            // Re-throw the original error
            throw error;
        }
    }

    async validateAndNormalizeParams(params: BridgeParams) {
        elizaLogger.debug(`Validating bridge params:`, JSON.stringify(params, null, 2));
        
        // Validate chains
        if (!params.fromChain) {
            elizaLogger.error("From chain is required");
            throw new Error("From chain is required for bridging");
        }
        
        if (!params.toChain) {
            elizaLogger.error("To chain is required");
            throw new Error("To chain is required for bridging");
        }
        
        // Check for supported bridge directions
        const supportedBridges = [
            { from: "bsc", to: "opBNB" },
            { from: "opBNB", to: "bsc" }
        ];
        
        const isSupported = supportedBridges.some(
            bridge => bridge.from === params.fromChain && bridge.to === params.toChain
        );
        
        if (!isSupported) {
            elizaLogger.error(`Unsupported bridge direction: ${params.fromChain} to ${params.toChain}`);
            throw new Error(`Unsupported bridge direction. Currently only supporting: BSC ↔ opBNB`);
        }
        
        // Validate amount
        if (!params.amount) {
            elizaLogger.error("Amount is required");
            throw new Error("Amount is required for bridging");
        }
        
        try {
            const amountValue = parseFloat(params.amount);
            if (isNaN(amountValue) || amountValue <= 0) {
                elizaLogger.error(`Invalid amount: ${params.amount}`);
                throw new Error(`Invalid amount: ${params.amount}. Please provide a positive number.`);
            }
            elizaLogger.debug(`Amount validation passed: ${params.amount}`);
        } catch (error) {
            elizaLogger.error(`Failed to parse amount: ${params.amount}`, error);
            throw new Error(`Invalid amount format: ${params.amount}. Please provide a valid number.`);
        }
        
        // Convert "null" strings to undefined for token addresses
        params.fromToken = convertNullStringToUndefined(params.fromToken);
        params.toToken = convertNullStringToUndefined(params.toToken);
        
        // Handle to address (default to sender address if not provided or null)
        params.toAddress = convertNullStringToUndefined(params.toAddress);
        
        if (!params.toAddress) {
            params.toAddress = this.walletProvider.getAddress();
            elizaLogger.debug(`No valid toAddress provided, using wallet address: ${params.toAddress}`);
        } else {
            // Format address
            elizaLogger.debug(`Formatting address: ${params.toAddress}`);
            params.toAddress = await this.walletProvider.formatAddress(params.toAddress);
            elizaLogger.debug(`Formatted address: ${params.toAddress}`);
        }

        // Validate token addresses for BSC to opBNB (ERC20 bridging)
        if (params.fromChain === "bsc" && params.toChain === "opBNB") {
            if (params.fromToken && !params.toToken) {
                elizaLogger.error("Missing L2 token address for ERC20 bridging");
                throw new Error("Token address on opBNB is required when bridging ERC20 from BSC to opBNB");
            }
            
            // Validate token addresses format if provided
            if (params.fromToken && !params.fromToken.startsWith("0x")) {
                elizaLogger.error(`Invalid fromToken address format: ${params.fromToken}`);
                throw new Error(`Invalid token address format: ${params.fromToken}. Must start with 0x.`);
            }
            
            if (params.toToken && !params.toToken.startsWith("0x")) {
                elizaLogger.error(`Invalid toToken address format: ${params.toToken}`);
                throw new Error(`Invalid token address format: ${params.toToken}. Must start with 0x.`);
            }
        }
        
        elizaLogger.debug(`Validation passed for bridge params`);
    }
}

// NOTE: The bridge action only supports bridge funds between BSC and opBNB for now. We may adding stargate support later.
export const bridgeAction = {
    name: "bridge",
    description: "Bridge tokens between BSC and opBNB",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting bridge action...");
        elizaLogger.debug("Message content:", JSON.stringify(message.content, null, 2));

        // Extract prompt text for bridge action analysis
        const promptText = typeof message.content.text === 'string' ? message.content.text.trim() : '';
        elizaLogger.debug(`Raw prompt text: "${promptText}"`);
        
        // Analyze prompt to detect bridge operations directly
        const promptLower = promptText.toLowerCase();
        
        // Look for bridge patterns in the prompt
        const depositRegex = /(?:deposit|bridge|send)\s+([0-9.]+)\s+([a-zA-Z0-9]+)(?:\s+from)?\s+(?:bsc|binance)(?:\s+to)\s+(?:opbnb|op)/i;
        const withdrawRegex = /(?:withdraw|bridge|send)\s+([0-9.]+)\s+([a-zA-Z0-9]+)(?:\s+from)?\s+(?:opbnb|op)(?:\s+to)\s+(?:bsc|binance)/i;
        const toAddressRegex = /(?:to|address|recipient)\s+(0x[a-fA-F0-9]{40})/i;
        
        let directFromChain: string | null = null;
        let directToChain: string | null = null;
        let directAmount: string | null = null;
        let directToken: string | null = null;
        let directToAddress: string | null = null;
        
        // Try to match deposit pattern (BSC to opBNB)
        let match = promptText.match(depositRegex);
        if (match && match.length >= 3) {
            directFromChain = "bsc";
            directToChain = "opBNB";
            directAmount = match[1];
            directToken = match[2].toUpperCase();
            elizaLogger.debug(`Directly extracted BSC to opBNB bridge - Amount: ${directAmount}, Token: ${directToken}`);
        } else {
            // Try to match withdraw pattern (opBNB to BSC)
            match = promptText.match(withdrawRegex);
            if (match && match.length >= 3) {
                directFromChain = "opBNB";
                directToChain = "bsc";
                directAmount = match[1];
                directToken = match[2].toUpperCase();
                elizaLogger.debug(`Directly extracted opBNB to BSC bridge - Amount: ${directAmount}, Token: ${directToken}`);
            }
        }
        
        // Check for recipient address in the prompt
        match = promptText.match(toAddressRegex);
        if (match && match.length >= 2) {
            directToAddress = match[1];
            elizaLogger.debug(`Directly extracted recipient address: ${directToAddress}`);
        }
        
        // Check for direction keywords if not already detected
        if (!directFromChain || !directToChain) {
            if (promptLower.includes("bsc to opbnb") || 
                promptLower.includes("binance to opbnb") || 
                promptLower.includes("bsc to op") || 
                promptLower.includes("deposit to opbnb")) {
                directFromChain = "bsc";
                directToChain = "opBNB";
                elizaLogger.debug(`Detected BSC to opBNB direction from keywords`);
            } else if (promptLower.includes("opbnb to bsc") || 
                       promptLower.includes("opbnb to binance") || 
                       promptLower.includes("op to bsc") || 
                       promptLower.includes("withdraw to bsc")) {
                directFromChain = "opBNB";
                directToChain = "bsc";
                elizaLogger.debug(`Detected opBNB to BSC direction from keywords`);
            }
        }
        
        // Extract amount if not already found
        if (!directAmount) {
            const amountRegex = /([0-9]+(?:\.[0-9]+)?)/;
            const amountMatch = promptText.match(amountRegex);
            if (amountMatch && amountMatch.length >= 2) {
                directAmount = amountMatch[1];
                elizaLogger.debug(`Extracted amount from prompt: ${directAmount}`);
            }
        }
        
        // Extract token if not already found
        if (!directToken) {
            // Look for common token symbols in the prompt
            const tokenRegex = /\b(bnb|eth|usdt|usdc|busd|dai|btc)\b/i;
            const tokenMatch = promptLower.match(tokenRegex);
            if (tokenMatch && tokenMatch.length >= 2) {
                directToken = tokenMatch[1].toUpperCase();
                elizaLogger.debug(`Extracted token from prompt: ${directToken}`);
            }
        }
        
        // Store prompt analysis results
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
        
        elizaLogger.debug("Prompt analysis result:", promptAnalysis);

        // Initialize or update state
        let currentState = state;
        if (!currentState) {
            currentState = (await runtime.composeState(message)) as State;
        } else {
            currentState = await runtime.updateRecentMessageState(currentState);
        }

        try {
            state.walletInfo = await bnbWalletProvider.get(runtime, message, currentState);
            elizaLogger.debug("Wallet info:", state.walletInfo);
        } catch (error) {
            elizaLogger.error("Error getting wallet info:", error.message);
            callback?.({
                text: `Unable to access wallet: ${error.message}`,
                content: { error: error.message },
            });
            return false;
        }

        // Compose bridge context
        const bridgeContext = composeContext({
            state: currentState,
            template: bridgeTemplate,
        });
        const content = await generateObjectDeprecated({
            runtime,
            context: bridgeContext,
            modelClass: ModelClass.LARGE,
        });
        
        elizaLogger.debug("Generated bridge content:", JSON.stringify(content, null, 2));
        
        // PRIORITY ORDER FOR BRIDGE PARAMETERS:
        // 1. Direct match from prompt text (most reliable)
        // 2. Parameters specified in model-generated content
        // 3. Default values where appropriate
        
        let fromChain: SupportedChain;
        let toChain: SupportedChain;
        let amount: string;
        let fromToken: `0x${string}` | undefined;
        let toToken: `0x${string}` | undefined;
        let toAddress: `0x${string}` | undefined;
        
        // Determine from chain
        if (directFromChain === "bsc" || directFromChain === "opBNB") {
            fromChain = directFromChain;
            elizaLogger.debug(`Using from chain directly extracted from prompt: ${fromChain}`);
        } else if (content.fromChain) {
            fromChain = content.fromChain;
            elizaLogger.debug(`Using from chain from generated content: ${fromChain}`);
        } else {
            fromChain = "bsc"; // Default to BSC as from chain
            elizaLogger.debug(`No from chain detected, defaulting to ${fromChain}`);
        }
        
        // Determine to chain
        if (directToChain === "bsc" || directToChain === "opBNB") {
            toChain = directToChain;
            elizaLogger.debug(`Using to chain directly extracted from prompt: ${toChain}`);
        } else if (content.toChain) {
            toChain = content.toChain;
            elizaLogger.debug(`Using to chain from generated content: ${toChain}`);
        } else {
            // Set opposite of fromChain
            toChain = fromChain === "bsc" ? "opBNB" : "bsc";
            elizaLogger.debug(`No to chain detected, using opposite of fromChain: ${toChain}`);
        }
        
        // Determine amount
        if (directAmount) {
            amount = directAmount;
            elizaLogger.debug(`Using amount directly extracted from prompt: ${amount}`);
        } else if (content.amount) {
            amount = content.amount;
            elizaLogger.debug(`Using amount from generated content: ${amount}`);
        } else {
            amount = "0.001"; // Default small amount
            elizaLogger.debug(`No amount detected, defaulting to ${amount}`);
        }
        
        // Determine fromToken (optional)
        if (directToken && fromChain) {
            // Only use as token if it's a hex address
            if (directToken !== "BNB" && directToken.startsWith("0x")) {
                fromToken = directToken as `0x${string}`;
                elizaLogger.debug(`Using token address directly extracted from prompt: ${fromToken}`);
            } else {
                fromToken = undefined; // Treat as native token
                elizaLogger.debug(`Using native token (${directToken || "BNB"})`);
            }
        } else if (content.fromToken) {
            fromToken = content.fromToken;
            elizaLogger.debug(`Using from token from generated content: ${fromToken}`);
        }
        // Else leave undefined for native token
        
        // Determine toToken (optional)
        if (content.toToken) {
            toToken = convertNullStringToUndefined(content.toToken);
            if (toToken) {
                elizaLogger.debug(`Using to token from generated content: ${toToken}`);
            } else {
                elizaLogger.debug(`Content contained null/invalid toToken, using undefined instead`);
            }
        }
        
        // For ERC20 tokens from BSC to opBNB, toToken is required
        if (fromChain === "bsc" && fromToken && !toToken) {
            elizaLogger.error(`Missing destination token address for ERC20 bridge`);
            callback?.({
                text: `Cannot bridge ERC20 token from BSC to opBNB without destination token address. Please provide the token address on opBNB.`,
                content: { error: "Missing destination token address" },
            });
            return false;
        }
        
        // Determine toAddress (optional)
        if (directToAddress && directToAddress.startsWith("0x")) {
            toAddress = directToAddress as `0x${string}`;
            elizaLogger.debug(`Using to address directly extracted from prompt: ${toAddress}`);
        } else if (content.toAddress) {
            toAddress = convertNullStringToUndefined(content.toAddress);
            if (toAddress) {
                elizaLogger.debug(`Using to address from generated content: ${toAddress}`);
            } else {
                elizaLogger.debug(`Content contained null/invalid toAddress, using undefined instead`);
            }
        }
        // Else leave undefined to use sender's address

        const walletProvider = initWalletProvider(runtime);
        const action = new BridgeAction(walletProvider);
        const paramOptions: BridgeParams = {
            fromChain,
            toChain,
            fromToken,
            toToken,
            amount,
            toAddress,
        };
        
        elizaLogger.debug("Final bridge options:", JSON.stringify(paramOptions, null, 2));
        
        try {
            elizaLogger.debug("Calling bridge with params:", JSON.stringify(paramOptions, null, 2));
            const bridgeResp = await action.bridge(paramOptions);
            
            let successText = `Successfully bridged ${bridgeResp.amount} ${bridgeResp.fromToken} from ${bridgeResp.fromChain} to ${bridgeResp.toChain}`;
            if (bridgeResp.recipient && bridgeResp.recipient !== walletProvider.getAddress()) {
                successText += ` (recipient: ${bridgeResp.recipient})`;
            }
            successText += `\nTransaction Hash: ${bridgeResp.txHash}`;
            
            callback?.({
                text: successText,
                content: { ...bridgeResp },
            });
            
            return true;
        } catch (error) {
            elizaLogger.error("Error during token bridge:", error.message);
            
            // Log the entire error object for diagnosis
            try {
                elizaLogger.error("Full error details:", JSON.stringify(error, null, 2));
            } catch (e) {
                elizaLogger.error("Error object not serializable, logging properties individually:");
                for (const key in error) {
                    try {
                        elizaLogger.error(`${key}:`, error[key]);
                    } catch (e) {
                        elizaLogger.error(`${key}: [Error serializing property]`);
                    }
                }
            }
            
            // Provide more user-friendly error messages
            let errorMessage = error.message;
            
            if (error.message.includes("insufficient funds")) {
                errorMessage = `Insufficient funds for the bridge operation. Please check your balance and try with a smaller amount.`;
            } else if (error.message.includes("user rejected")) {
                errorMessage = `Transaction was rejected. Please try again if you want to proceed with the bridge operation.`;
            } else if (error.message.includes("token address on opBNB is required")) {
                errorMessage = `When bridging ERC20 tokens from BSC to opBNB, you must specify the token address on opBNB.`;
            } else if (error.message.includes("Unsupported bridge direction")) {
                errorMessage = `Only bridges between BSC and opBNB are supported. Valid directions are BSC→opBNB and opBNB→BSC.`;
            }
            
            callback?.({
                text: `Bridge failed: ${errorMessage}`,
                content: { error: errorMessage },
            });
            return false;
        }
    },
    template: bridgeTemplate,
    validate: async (runtime: IAgentRuntime) => {
        const privateKey = runtime.getSetting("BNB_PRIVATE_KEY");
        return typeof privateKey === "string" && privateKey.startsWith("0x");
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Deposit 0.001 BNB from BSC to opBNB",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I'll help you bridge 0.001 BNB from BSC to opBNB",
                    action: "BRIDGE",
                    content: {
                        fromChain: "bsc",
                        toChain: "opBNB",
                        fromToken: undefined,
                        toToken: undefined,
                        amount: "0.001",
                    },
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Transfer 0.001 BNB from BSC to address 0x1234 on opBNB",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I'll help you bridge 0.001 BNB from BSC to address 0x1234 on opBNB",
                    action: "BRIDGE",
                    content: {
                        fromChain: "bsc",
                        toChain: "opBNB",
                        fromToken: undefined,
                        toToken: undefined,
                        amount: "0.001",
                        toAddress: "0x1234",
                    },
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Deposit 0.001 0x123 token from BSC to address 0x456 on opBNB. The corresponding token address on opBNB is 0x789",
                },
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
                        toAddress: "0x456",
                    },
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Withdraw 0.001 BNB from opBNB to BSC",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I'll help you bridge 0.001 BNB from opBNB to BSC",
                    action: "BRIDGE",
                    content: {
                        fromChain: "opBNB",
                        toChain: "bsc",
                        fromToken: undefined,
                        toToken: undefined,
                        amount: "0.001",
                    },
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Withdraw 0.001 0x1234 token from opBNB to address 0x5678 on BSC",
                },
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
                        toToken: undefined,
                        amount: "0.001",
                        toAddress: "0x5678",
                    },
                },
            },
        ],
    ],
    similes: ["BRIDGE", "TOKEN_BRIDGE", "DEPOSIT", "WITHDRAW"],
};

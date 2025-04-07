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
import {
    formatEther,
    formatUnits,
    parseEther,
    parseUnits,
    erc20Abi,
    type Hex,
} from "viem";

import {
    bnbWalletProvider,
    initWalletProvider,
    type WalletProvider,
} from "../providers/wallet";
import { transferTemplate } from "../templates";
import type { TransferParams, TransferResponse, SupportedChain } from "../types";

export { transferTemplate };

// Exported for tests
export class TransferAction {
    private readonly TRANSFER_GAS = 21000n;
    private readonly DEFAULT_GAS_PRICE = 3000000000n as const; // 3 Gwei

    constructor(private walletProvider: WalletProvider) {}

    async transfer(params: TransferParams): Promise<TransferResponse> {
        elizaLogger.debug("Starting transfer with params:", JSON.stringify(params, null, 2));
        
        // Debug the chain validation
        elizaLogger.debug(`Chain before validation: ${params.chain}`);
        elizaLogger.debug(`Available chains:`, Object.keys(this.walletProvider.chains));
        
        // Check if the chain is supported
        if (!this.walletProvider.chains[params.chain]) {
            elizaLogger.error(`Chain '${params.chain}' is not supported. Available chains: ${Object.keys(this.walletProvider.chains).join(', ')}`);
            throw new Error(`Chain '${params.chain}' is not supported. Please use one of: ${Object.keys(this.walletProvider.chains).join(', ')}`);
        }
        
        // Handle data parameter - make sure it's not a string "null"
        // This must happen before validation to avoid type errors
        let dataParam: Hex | undefined = undefined;
        if (params.data && typeof params.data === 'string' && params.data.startsWith('0x')) {
            dataParam = params.data as Hex;
            elizaLogger.debug(`Using data parameter: ${dataParam}`);
        } else if (params.data) {
            elizaLogger.debug(`Ignoring invalid data parameter: ${params.data}`);
        }
        
        await this.validateAndNormalizeParams(params);
        elizaLogger.debug("After address validation, params:", JSON.stringify(params, null, 2));

        const fromAddress = this.walletProvider.getAddress();
        elizaLogger.debug(`From address: ${fromAddress}`);

        elizaLogger.debug(`Switching to chain: ${params.chain}`);
        this.walletProvider.switchChain(params.chain);

        const nativeToken = this.walletProvider.chains[params.chain].nativeCurrency.symbol;
        elizaLogger.debug(`Native token for chain ${params.chain}: ${nativeToken}`);

        // CRITICAL: Ensure token is never null before proceeding
        if (!params.token) {
            params.token = nativeToken;
            elizaLogger.debug(`Setting null token to native token: ${nativeToken}`);
        } else if (params.token.toLowerCase() === nativeToken.toLowerCase()) {
            // Standardize the token case if it matches the native token
            params.token = nativeToken;
            elizaLogger.debug(`Standardized token case to match native token: ${nativeToken}`);
        }
        
        elizaLogger.debug(`Final transfer token: ${params.token}`);

        const resp: TransferResponse = {
            chain: params.chain,
            txHash: "0x",
            recipient: params.toAddress,
            amount: "",
            token: params.token,
        };

        if (!params.token || params.token === nativeToken) {
            // Native token transfer
            const options: { gas?: bigint; gasPrice?: bigint; data?: Hex } = {
                data: dataParam,
            };
            let value: bigint;
            if (!params.amount) {
                // Transfer all balance minus gas
                const publicClient = this.walletProvider.getPublicClient(
                    params.chain
                );
                const balance = await publicClient.getBalance({
                    address: fromAddress,
                });

                value = balance - this.DEFAULT_GAS_PRICE * 21000n;
                options.gas = this.TRANSFER_GAS;
                options.gasPrice = this.DEFAULT_GAS_PRICE;
            } else {
                value = parseEther(params.amount);
            }

            resp.amount = formatEther(value);
            resp.txHash = await this.walletProvider.transfer(
                params.chain,
                params.toAddress,
                value,
                options
            );
        } else {
            // ERC20 token transfer
            let tokenAddress = params.token;
            elizaLogger.debug(`Token before address resolution: ${params.token}`);
            
            // Special case: If token is BNB (the native token), handle it separately
            // This avoids the LI.FI lookup which fails with null token
            if (params.token === "BNB" || params.token === "bnb") {
                elizaLogger.debug(`Detected native token (BNB) passed to ERC20 handling branch - switching to native token handling`);
                
                // Update response token to make sure it's consistent
                resp.token = nativeToken;
                
                // Switch to native token transfer
                const options: { gas?: bigint; gasPrice?: bigint; data?: Hex } = {
                    data: dataParam,
                };
                let value: bigint;
                if (!params.amount) {
                    // Transfer all balance minus gas
                    const publicClient = this.walletProvider.getPublicClient(
                        params.chain
                    );
                    const balance = await publicClient.getBalance({
                        address: fromAddress,
                    });

                    value = balance - this.DEFAULT_GAS_PRICE * 21000n;
                    options.gas = this.TRANSFER_GAS;
                    options.gasPrice = this.DEFAULT_GAS_PRICE;
                } else {
                    value = parseEther(params.amount);
                }

                resp.amount = formatEther(value);
                resp.txHash = await this.walletProvider.transfer(
                    params.chain,
                    params.toAddress,
                    value,
                    options
                );
                
                // Skip remaining ERC20 handling
                elizaLogger.debug(`Native BNB transfer completed via transfer branch`);
                return resp; // Return early to skip the rest of the ERC20 handling
                
            } else if (!params.token.startsWith("0x")) {
                try {
                    elizaLogger.debug(`Attempting to resolve token symbol: ${params.token} on chain ${params.chain}`);
                    // Configure the LI.FI SDK for token lookup
                    this.walletProvider.configureLiFiSdk(params.chain);
                    
                    tokenAddress = await this.walletProvider.getTokenAddress(
                        params.chain,
                        params.token
                    );
                    
                    elizaLogger.debug(`Resolved token address: ${tokenAddress} for ${params.token}`);
                    
                    // If token address doesn't start with 0x after resolution, it might have failed
                    if (!tokenAddress || !tokenAddress.startsWith("0x")) {
                        elizaLogger.error(`Failed to resolve token to proper address: ${tokenAddress}`);
                        throw new Error(`Could not resolve token symbol ${params.token} to a valid address`);
                    }
                } catch (error) {
                    elizaLogger.error(`Error resolving token address for ${params.token}:`, error);
                    throw new Error(`Could not find token ${params.token} on chain ${params.chain}. Please check the token symbol or use the contract address.`);
                }
            } else {
                elizaLogger.debug(`Using token address directly: ${tokenAddress}`);
            }
            
            elizaLogger.debug(`Final token address for ERC20 transfer: ${tokenAddress}`);

            const publicClient = this.walletProvider.getPublicClient(
                params.chain
            );
            const decimals = await publicClient.readContract({
                address: tokenAddress as `0x${string}`,
                abi: erc20Abi,
                functionName: "decimals",
            });

            let value: bigint;
            if (!params.amount) {
                value = await publicClient.readContract({
                    address: tokenAddress as `0x${string}`,
                    abi: erc20Abi,
                    functionName: "balanceOf",
                    args: [fromAddress],
                });
            } else {
                value = parseUnits(params.amount, decimals);
            }

            resp.amount = formatUnits(value, decimals);
            resp.txHash = await this.walletProvider.transferERC20(
                params.chain,
                tokenAddress as `0x${string}`,
                params.toAddress,
                value
            );
        }

        if (!resp.txHash || resp.txHash === "0x") {
            throw new Error("Get transaction hash failed");
        }

        // wait for the transaction to be confirmed
        const publicClient = this.walletProvider.getPublicClient(params.chain);
        await publicClient.waitForTransactionReceipt({
            hash: resp.txHash,
        });

        return resp;
    }

    async validateAndNormalizeParams(params: TransferParams): Promise<void> {
        if (!params.toAddress) {
            throw new Error("To address is required");
        }
        params.toAddress = await this.walletProvider.formatAddress(
            params.toAddress
        );
    }
}

export const transferAction = {
    name: "transfer",
    description: "Transfer tokens between addresses on the same chain",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting transfer action...");
        elizaLogger.debug("Message content:", JSON.stringify(message.content, null, 2));

        // Extract prompt text if available to help with token detection
        const promptText = typeof message.content.text === 'string' ? message.content.text.trim() : '';
        elizaLogger.debug(`Raw prompt text: "${promptText}"`);
        
        // Pre-analyze the prompt for token indicators - more aggressive token detection
        const promptLower = promptText.toLowerCase();
        
        // Direct BNB token detection - look for explicit mentions of BNB
        const containsBnb = promptLower.includes('bnb') || 
                            promptLower.includes('binance coin') || 
                            promptLower.includes('binance smart chain');
        
        // Direct token detection from prompt format like "Transfer 0.0001 BNB to 0x123..."
        let directTokenMatch: string | null = null;
        const transferRegex = /transfer\s+([0-9.]+)\s+([a-zA-Z0-9]+)\s+to\s+(0x[a-fA-F0-9]{40})/i;
        const match = promptText.match(transferRegex);
        
        if (match && match.length >= 3) {
            const [_, amount, tokenSymbol, toAddress] = match;
            directTokenMatch = tokenSymbol.toUpperCase();
            elizaLogger.debug(`Directly extracted from prompt - Amount: ${amount}, Token: ${directTokenMatch}, To: ${toAddress}`);
        }
        
        if (containsBnb) {
            elizaLogger.debug(`BNB transfer detected in prompt text: "${promptText}"`);
        }
        
        // Store this information for later use
        const promptAnalysis = {
            containsBnb,
            directTokenMatch
        };
        
        elizaLogger.debug("Prompt analysis result:", promptAnalysis);

        // Validate transfer
        if (!(message.content.source === "direct")) {
            callback?.({
                text: "I can't do that for you.",
                content: { error: "Transfer not allowed" },
            });
            return false;
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
            elizaLogger.error("Error getting wallet info:", error.message);
        }

        // Log available settings
        elizaLogger.debug("Available runtime settings:");
        const bscProviderUrl = runtime.getSetting("BSC_PROVIDER_URL");
        const bscTestnetProviderUrl = runtime.getSetting("BSC_TESTNET_PROVIDER_URL");
        elizaLogger.debug(`BSC_PROVIDER_URL: ${bscProviderUrl ? "set" : "not set"}`);
        elizaLogger.debug(`BSC_TESTNET_PROVIDER_URL: ${bscTestnetProviderUrl ? "set" : "not set"}`);

        // Compose transfer context
        const transferContext = composeContext({
            state: currentState,
            template: transferTemplate,
        });
        const content = await generateObjectDeprecated({
            runtime,
            context: transferContext,
            modelClass: ModelClass.LARGE,
        });
        
        elizaLogger.debug("Generated transfer content:", JSON.stringify(content, null, 2));
        
        // Normalize chain from content
        let chain = content.chain?.toLowerCase() || "bsc";
        elizaLogger.debug(`Chain parameter: ${chain}`);
        
        // Check if content has a token field
        elizaLogger.debug("Token from content:", content.token);
        elizaLogger.debug("Content object keys:", Object.keys(content));

        // PRIORITY ORDER FOR TOKEN DETERMINATION:
        // 1. Direct match from prompt text (most reliable)
        // 2. Token specified in model-generated content
        // 3. BNB detection from prompt analysis
        // 4. Default to BNB (native token)
        
        let token: string;
        
        // 1. First priority: Use directly extracted token from prompt if available
        if (directTokenMatch) {
            token = directTokenMatch;
            elizaLogger.debug(`Using token directly extracted from prompt: ${token}`);
        }
        // 2. Second priority: Use token from content if available
        else if (content.token) {
            token = content.token;
            elizaLogger.debug(`Using token from generated content: ${token}`);
        }
        // 3. Third priority: Detected BNB in prompt
        else if (containsBnb) {
            token = "BNB";
            elizaLogger.debug(`Using BNB as detected in prompt`);
        }
        // 4. Default fallback
        else {
            token = "BNB"; // Default to native token
            elizaLogger.debug(`No token detected, defaulting to native token BNB`);
        }
        
        // Final validation - never allow null/undefined as token value
        if (!token) {
            token = "BNB";
            elizaLogger.debug(`Final safeguard: ensuring token is not null/undefined`);
        }
        
        elizaLogger.debug(`Final token parameter: ${token}`);

        const walletProvider = initWalletProvider(runtime);
        const action = new TransferAction(walletProvider);
        
        // Process data field to avoid passing "null" string
        let dataParam: Hex | undefined = undefined;
        if (content.data && typeof content.data === 'string') {
            if (content.data.startsWith('0x') && content.data !== '0x') {
                dataParam = content.data as Hex;
                elizaLogger.debug(`Using valid hex data: ${dataParam}`);
            } else {
                elizaLogger.debug(`Invalid data format or value: ${content.data}, ignoring`);
            }
        }
        
        const paramOptions: TransferParams = {
            chain: chain as SupportedChain,
            token: token,
            amount: content.amount,
            toAddress: content.toAddress,
            data: dataParam,
        };
        
        elizaLogger.debug("Transfer params before action:", JSON.stringify(paramOptions, null, 2));

        try {
            elizaLogger.debug("Calling transfer with params:", JSON.stringify(paramOptions, null, 2));
            
            const transferResp = await action.transfer(paramOptions);
            callback?.({
                text: `Successfully transferred ${transferResp.amount} ${transferResp.token} to ${transferResp.recipient}\nTransaction Hash: ${transferResp.txHash}`,
                content: { ...transferResp },
            });

            return true;
        } catch (error) {
            elizaLogger.error("Error during transfer:", error.message);
            
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
            
            // Enhanced error diagnosis
            let errorMessage = error.message;
            
            // Check for LI.FI SDK errors
            if (error.message.includes("LI.FI SDK")) {
                elizaLogger.error("LI.FI SDK error detected");
                
                if (error.message.includes("Request failed with status code 404") && 
                    error.message.includes("Could not find token")) {
                    // Extract the token that couldn't be found from the error message
                    const tokenMatch = error.message.match(/Could not find token (.*?) on chain/);
                    const tokenValue = tokenMatch ? tokenMatch[1] : paramOptions.token;
                    
                    errorMessage = `Could not find the token '${tokenValue}' on ${paramOptions.chain}. 
                    Please check the token symbol or address and try again.`;
                    
                    elizaLogger.error(`Token not found: ${tokenValue}`);
                    elizaLogger.debug(`Original token from params: ${paramOptions.token}`);
                    
                    // Suggest a solution
                    if (tokenValue === "null" || tokenValue === "undefined" || !tokenValue) {
                        errorMessage += " For BNB transfers, please explicitly specify 'BNB' as the token.";
                    }
                } else if (error.message.includes("400 Bad Request") && error.message.includes("chain must be")) {
                    errorMessage = `Chain validation error: '${paramOptions.chain}' is not a valid chain for the LI.FI SDK. 
                    Please use 'bsc' for BSC mainnet.`;
                }
            }
            
            // Check for other common errors
            if (error.message.includes("insufficient funds")) {
                errorMessage = `Insufficient funds for the transaction. Please check your balance and try again with a smaller amount.`;
            } else if (error.message.includes("transaction underpriced")) {
                errorMessage = `Transaction underpriced. Please try again with a higher gas price.`;
            }
            
            callback?.({
                text: `Transfer failed: ${errorMessage}`,
                content: { error: errorMessage },
            });
            return false;
        }
    },
    template: transferTemplate,
    validate: async (runtime: IAgentRuntime) => {
        const privateKey = runtime.getSetting("BNB_PRIVATE_KEY");
        return typeof privateKey === "string" && privateKey.startsWith("0x");
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Transfer 0.001 BNB to 0x2CE4EaF47CACFbC6590686f8f7521e0385822334",
                },
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
                        toAddress: "0x2CE4EaF47CACFbC6590686f8f7521e0385822334",
                    },
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Transfer 1 token of 0x1234 to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
                },
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
                        toAddress: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
                    },
                },
            },
        ],
    ],
    similes: ["TRANSFER", "SEND_TOKENS", "TOKEN_TRANSFER", "MOVE_TOKENS"],
};

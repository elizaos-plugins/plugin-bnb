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
import type { Hex } from "viem";
import WebSocket, { type ClientOptions } from "ws";

import { faucetTemplate } from "../templates";
import type { FaucetResponse, FaucetParams } from "../types";
import {
    bnbWalletProvider,
    initWalletProvider,
    type WalletProvider,
} from "../providers/wallet";

export { faucetTemplate };

// Exported for tests
export class FaucetAction {
    private readonly SUPPORTED_TOKENS: string[] = [
        "BNB",
        "BTC",
        "BUSD",
        "DAI",
        "ETH",
        "USDC",
    ] as const;
    private readonly FAUCET_URL = "wss://testnet.bnbchain.org/faucet-smart/api";

    constructor(private walletProvider: WalletProvider) {}

    async faucet(params: FaucetParams): Promise<FaucetResponse> {
        elizaLogger.debug("Faucet params:", params);
        
        try {
            await this.validateAndNormalizeParams(params);
            elizaLogger.debug("Normalized faucet params:", params);
            
            // After validation, we know these values exist
            if (!params.token) {
                params.token = "BNB";
                elizaLogger.debug("No token specified, defaulting to BNB");
            }
            
            if (!params.toAddress) {
                params.toAddress = this.walletProvider.getAddress();
                elizaLogger.debug(`No address specified, using wallet address: ${params.toAddress}`);
            }

            const resp: FaucetResponse = {
                token: params.token,
                recipient: params.toAddress,
                txHash: "0x",
            };

            const options: ClientOptions = {
                headers: {
                    Connection: "Upgrade",
                    Upgrade: "websocket",
                },
            };

            const ws = new WebSocket(this.FAUCET_URL, options);

            try {
                // Wait for connection
                await new Promise<void>((resolve, reject) => {
                    ws.once("open", () => resolve());
                    ws.once("error", reject);
                });

                // Send the message
                const message = {
                    tier: 0,
                    url: params.toAddress,
                    symbol: params.token,
                    captcha: "noCaptchaToken",
                };
                elizaLogger.debug(`Sending faucet request: ${JSON.stringify(message)}`);
                ws.send(JSON.stringify(message));

                // Wait for response with transaction hash
                const txHash = await new Promise<Hex>((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        ws.close();
                        reject(new Error("Faucet request timeout"));
                    }, 15000);

                    ws.on("message", (data) => {
                        const response = JSON.parse(data.toString());
                        elizaLogger.debug(`Faucet response: ${JSON.stringify(response)}`);

                        // First response: funding request accepted
                        if (response.success) {
                            elizaLogger.debug("Faucet request accepted");
                            return;
                        }

                        // Second response: transaction details
                        if (response.requests?.length > 0) {
                            const txHash = response.requests[0].tx.hash;
                            if (txHash) {
                                clearTimeout(timeout);
                                elizaLogger.debug(`Faucet transaction hash received: ${txHash}`);
                                resolve(txHash as Hex);
                            }
                        }

                        // Handle error case
                        if (response.error) {
                            clearTimeout(timeout);
                            elizaLogger.error(`Faucet error: ${response.error}`);
                            reject(new Error(response.error));
                        }
                    });

                    ws.on("error", (error) => {
                        clearTimeout(timeout);
                        elizaLogger.error(`WebSocket error: ${error.message}`);
                        reject(
                            new Error(`WebSocket error occurred: ${error.message}`)
                        );
                    });
                });

                resp.txHash = txHash;
                elizaLogger.debug(`Faucet success: ${params.token} to ${params.toAddress}, tx: ${txHash}`);
                return resp;
            } finally {
                ws.close();
            }
        } catch (error) {
            elizaLogger.error(`Faucet error: ${error.message}`, error);
            throw error;
        }
    }

    async validateAndNormalizeParams(params: FaucetParams): Promise<void> {
        elizaLogger.debug("Original faucet params:", params);
        
        try {
            // Token validation
            if (!params.token) {
                params.token = "BNB";
                elizaLogger.debug("No token specified, defaulting to BNB");
            }
            
            if (!this.SUPPORTED_TOKENS.includes(params.token)) {
                throw new Error(`Unsupported token: ${params.token}. Supported tokens are: ${this.SUPPORTED_TOKENS.join(', ')}`);
            }
            
            // Address validation
            if (!params.toAddress) {
                // Use wallet's own address if none provided
                params.toAddress = this.walletProvider.getAddress();
                elizaLogger.debug(`No address provided, using wallet address: ${params.toAddress}`);
                return;
            }
            
            // If the address is already in the correct format, use it directly
            if (typeof params.toAddress === 'string' && params.toAddress.startsWith("0x") && params.toAddress.length === 42) {
                elizaLogger.debug(`Using provided hex address: ${params.toAddress}`);
                return;
            }
            
            // Otherwise try to format it
            try {
                params.toAddress = await this.walletProvider.formatAddress(params.toAddress);
                elizaLogger.debug(`Successfully formatted address to: ${params.toAddress}`);
            } catch (error) {
                elizaLogger.error(`Error formatting address: ${error.message}`);
                // Fall back to wallet's own address if formatting fails
                params.toAddress = this.walletProvider.getAddress();
                elizaLogger.debug(`Falling back to wallet address: ${params.toAddress}`);
            }
        } catch (error) {
            elizaLogger.error(`Error in validateAndNormalizeParams: ${error.message}`);
            throw error;
        }
        
        elizaLogger.debug("Normalized faucet params:", params);
    }
}

export const faucetAction = {
    name: "faucet",
    description: "Get test tokens from the BSC Testnet faucet (token list: BNB, BUSD, DAI, USDC)",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting faucet action...");

        // Initialize or update state
        let currentState = state;
        if (!currentState) {
            currentState = (await runtime.composeState(message)) as State;
        } else {
            currentState = await runtime.updateRecentMessageState(currentState);
        }

        state.walletInfo = await bnbWalletProvider.get(
            runtime,
            message,
            currentState
        );

        // Compose faucet context
        const faucetContext = composeContext({
            state: currentState,
            template: faucetTemplate,
        });
        const content = await generateObjectDeprecated({
            runtime,
            context: faucetContext,
            modelClass: ModelClass.LARGE,
        });

        const walletProvider = initWalletProvider(runtime);
        const action = new FaucetAction(walletProvider);
        const paramOptions: FaucetParams = {
            token: content.token,
            toAddress: content.toAddress,
        };
        try {
            const faucetResp = await action.faucet(paramOptions);
            callback?.({
                text: `Successfully transferred ${faucetResp.token} to ${faucetResp.recipient}\nTransaction Hash: ${faucetResp.txHash}`,
                content: {
                    hash: faucetResp.txHash,
                    recipient: faucetResp.recipient,
                    chain: content.chain || "bscTestnet", // Default to testnet for faucet
                },
            });

            return true;
        } catch (error) {
            elizaLogger.error("Error during faucet:", error.message);
            
            // Provide more user-friendly error messages
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
                },
            });
            return false;
        }
    },
    template: faucetTemplate,
    validate: async (_runtime: IAgentRuntime) => {
        return true;
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Get some USDC from the testnet faucet",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Sure, I'll request some test USDC from the BSC Testnet faucet now. This will be sent to your wallet address.",
                    action: "FAUCET",
                    content: {
                        token: "USDC",
                        toAddress: "{{walletAddress}}",
                    },
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Get some test tokens from the faucet",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I'll request some test BNB tokens from the BSC Testnet faucet. These tokens have no real value and are only for testing purposes.",
                    action: "FAUCET",
                    content: {
                        token: "BNB",
                        toAddress: "{{walletAddress}}",
                    },
                },
            },
        ],
    ],
    similes: ["FAUCET", "GET_TEST_TOKENS"],
};

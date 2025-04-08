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
import { getToken } from "@lifi/sdk";

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
import { type Address, erc20Abi, formatEther, formatUnits } from "viem";

export { getBalanceTemplate };

export class GetBalanceAction {
    constructor(private walletProvider: WalletProvider) {}

    async getBalance(params: GetBalanceParams): Promise<GetBalanceResponse> {
        elizaLogger.debug("Get balance params:", params);
        await this.validateAndNormalizeParams(params);
        elizaLogger.debug("Normalized get balance params:", params);

        const { chain, address, token } = params;
        if (!address) {
            throw new Error("Address is required for getting balance");
        }

        this.walletProvider.switchChain(chain);
        const nativeSymbol =
            this.walletProvider.getChainConfigs(chain).nativeCurrency.symbol;
        const chainId = this.walletProvider.getChainConfigs(chain).id;

        let queryNativeToken = false;
        if (
            !token ||
            token === "" ||
            token.toLowerCase() === "bnb" ||
            token.toLowerCase() === "tbnb"
        ) {
            queryNativeToken = true;
        }

        const resp: GetBalanceResponse = {
            chain,
            address,
        };

        // If ERC20 token is requested
        if (!queryNativeToken) {
            let amount: string;
            if (token.startsWith("0x")) {
                amount = await this.getERC20TokenBalance(
                    chain,
                    address,
                    token as `0x${string}`
                );
            } else {
                if (chainId !== 56) {
                    throw new Error(
                        "Only BSC mainnet is supported for querying balance by token symbol"
                    );
                }

                this.walletProvider.configureLiFiSdk(chain);
                const tokenInfo = await getToken(chainId, token);
                amount = await this.getERC20TokenBalance(
                    chain,
                    address,
                    tokenInfo.address as `0x${string}`
                );
            }

            resp.balance = { token, amount };
        } else {
            // If native token is requested
            const nativeBalanceWei = await this.walletProvider
                .getPublicClient(chain)
                .getBalance({ address });
            resp.balance = {
                token: nativeSymbol,
                amount: formatEther(nativeBalanceWei),
            };
        }

        return resp;
    }

    async getERC20TokenBalance(
        chain: SupportedChain,
        address: Address,
        tokenAddress: Address
    ): Promise<string> {
        const publicClient = this.walletProvider.getPublicClient(chain);

        const balance = await publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address],
        });

        const decimals = await publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "decimals",
        });

        return formatUnits(balance, decimals);
    }

    async validateAndNormalizeParams(params: GetBalanceParams): Promise<void> {
        try {
            // If no chain specified, default to BSC
            if (!params.chain) {
                params.chain = "bsc";
            }
            
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
            
            // Try to resolve as web3 name
            elizaLogger.debug(`Attempting to resolve address as Web3Name: ${params.address}`);
            const resolvedAddress = await this.walletProvider.resolveWeb3Name(params.address);
            if (resolvedAddress) {
                elizaLogger.debug(`Resolved Web3Name to address: ${resolvedAddress}`);
                params.address = resolvedAddress as Address;
                return;
            }
            
            // If we can't resolve, but it looks like a potential wallet address, try to use it
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
export const getBalanceAction = {
    name: "getBalance",
    description: "Get balance of a token or all tokens for the given address",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting getBalance action...");

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

        // Compose swap context
        const getBalanceContext = composeContext({
            state: currentState,
            template: getBalanceTemplate,
        });
        const content = await generateObjectDeprecated({
            runtime,
            context: getBalanceContext,
            modelClass: ModelClass.LARGE,
        });

        const walletProvider = initWalletProvider(runtime);
        const action = new GetBalanceAction(walletProvider);
        const getBalanceOptions: GetBalanceParams = {
            chain: content.chain,
            address: content.address,
            token: content.token,
        };
        try {
            const getBalanceResp = await action.getBalance(getBalanceOptions);
            if (callback) {
                let text = `No balance found for ${getBalanceOptions.address} on ${getBalanceOptions.chain}`;
                if (getBalanceResp.balance) {
                    text = `Balance of ${getBalanceResp.address} on ${getBalanceResp.chain}:\n${
                        getBalanceResp.balance.token
                    }: ${getBalanceResp.balance.amount}`;
                }
                callback({
                    text,
                    content: { ...getBalanceResp },
                });
            }
            return true;
        } catch (error) {
            elizaLogger.error("Error during get balance:", error);
            
            // Provide more user-friendly error messages based on error type
            let userMessage = `Get balance failed: ${error.message}`;
            
            // Check for common error cases
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
                },
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
                    text: "Check my balance of USDT",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I'll help you check your balance of USDC",
                    action: "GET_BALANCE",
                    content: {
                        chain: "bsc",
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
                    text: "Check my balance of token 0x1234",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I'll help you check your balance of token 0x1234",
                    action: "GET_BALANCE",
                    content: {
                        chain: "bsc",
                        address: "{{walletAddress}}",
                        token: "0x1234",
                    },
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Get USDC balance of 0x1234",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I'll help you check USDC balance of 0x1234",
                    action: "GET_BALANCE",
                    content: {
                        chain: "bsc",
                        address: "0x1234",
                        token: "USDC",
                    },
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Check my wallet balance on BSC",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I'll help you check your wallet balance on BSC",
                    action: "GET_BALANCE",
                    content: {
                        chain: "bsc",
                        address: "{{walletAddress}}",
                        token: undefined,
                    },
                },
            },
        ],
    ],
    similes: ["GET_BALANCE", "CHECK_BALANCE"],
};

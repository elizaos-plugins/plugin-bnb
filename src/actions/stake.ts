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
import { type Address, formatEther, parseEther, erc20Abi } from "viem";

import {
    bnbWalletProvider,
    initWalletProvider,
    type WalletProvider,
} from "../providers/wallet";
import { stakeTemplate } from "../templates";
import { ListaDaoAbi, type StakeParams, type StakeResponse } from "../types";

export { stakeTemplate };

// Exported for tests
export class StakeAction {
    private readonly LISTA_DAO =
        "0x1adB950d8bB3dA4bE104211D5AB038628e477fE6" as const;
    private readonly SLIS_BNB =
        "0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B" as const;

    constructor(private walletProvider: WalletProvider) {}

    async stake(params: StakeParams): Promise<StakeResponse> {
        elizaLogger.debug("Starting stake action with params:", JSON.stringify(params, null, 2));
        
        // Validate parameters
        this.validateStakeParams(params);
        elizaLogger.debug("After validation, stake params:", JSON.stringify(params, null, 2));

        // Switch to BSC chain (only supported chain for staking)
        elizaLogger.debug("Switching to BSC chain for staking");
        this.walletProvider.switchChain("bsc");

        // Log contracts being used
        elizaLogger.debug(`Using Lista DAO contract: ${this.LISTA_DAO}`);
        elizaLogger.debug(`Using slisBNB token contract: ${this.SLIS_BNB}`);
        
        // Get wallet address
        const walletAddress = this.walletProvider.getAddress();
        elizaLogger.debug(`Wallet address: ${walletAddress}`);

        // Execute the requested action
        elizaLogger.debug(`Executing stake action: ${params.action}`);
        const actions = {
            deposit: async () => {
                if (!params.amount) {
                    throw new Error("Amount is required for deposit");
                }
                elizaLogger.debug(`Depositing ${params.amount} BNB to Lista DAO`);
                return await this.doDeposit(params.amount);
            },
            withdraw: async () => {
                elizaLogger.debug(`Withdrawing ${params.amount || 'all'} slisBNB from Lista DAO`);
                return await this.doWithdraw(params.amount);
            },
            claim: async () => {
                elizaLogger.debug(`Claiming unlocked BNB from Lista DAO`);
                return await this.doClaim();
            },
        };
        
        try {
            const resp = await actions[params.action]();
            elizaLogger.debug(`Stake action completed successfully: ${resp}`);
            return { response: resp };
        } catch (error) {
            elizaLogger.error(`Error executing stake action ${params.action}:`, error);
            throw error;
        }
    }

    validateStakeParams(params: StakeParams) {
        elizaLogger.debug(`Validating stake params: chain=${params.chain}, action=${params.action}, amount=${params.amount}`);
        
        // Validate chain
        if (!params.chain) {
            elizaLogger.debug("No chain specified, defaulting to bsc");
            params.chain = "bsc";
        } else if (params.chain !== "bsc") {
            elizaLogger.error(`Unsupported chain for staking: ${params.chain}`);
            throw new Error("Only BSC mainnet is supported for staking");
        }

        // Validate action
        if (!params.action) {
            elizaLogger.error("No action specified for staking");
            throw new Error("Action is required for staking. Use 'deposit', 'withdraw', or 'claim'");
        }
        
        const validActions = ["deposit", "withdraw", "claim"];
        if (!validActions.includes(params.action)) {
            elizaLogger.error(`Invalid staking action: ${params.action}`);
            throw new Error(`Invalid staking action: ${params.action}. Valid actions are: ${validActions.join(", ")}`);
        }

        // Validate amount for deposit and withdraw
        if (params.action === "deposit" && !params.amount) {
            elizaLogger.error("Amount is required for deposit");
            throw new Error("Amount is required for deposit");
        }

        if (params.action === "withdraw" && !params.amount) {
            elizaLogger.debug("No amount specified for withdraw, will withdraw all slisBNB");
        }
        
        // Validate amount format if provided
        if (params.amount) {
            try {
                const amountValue = parseFloat(params.amount);
                if (isNaN(amountValue) || amountValue <= 0) {
                    elizaLogger.error(`Invalid amount: ${params.amount} (must be a positive number)`);
                    throw new Error(`Invalid amount: ${params.amount}. Please provide a positive number.`);
                }
                elizaLogger.debug(`Amount validation passed: ${params.amount}`);
            } catch (error) {
                elizaLogger.error(`Failed to parse amount: ${params.amount}`, error);
                throw new Error(`Invalid amount format: ${params.amount}. Please provide a valid number.`);
            }
        }
    }

    async doDeposit(amount: string): Promise<string> {
        elizaLogger.debug(`Starting deposit of ${amount} BNB to Lista DAO`);
        
        const publicClient = this.walletProvider.getPublicClient("bsc");
        const walletClient = this.walletProvider.getWalletClient("bsc");
        const account = walletClient.account;
        
        if (!account) {
            elizaLogger.error("Wallet account not found");
            throw new Error("Wallet account not found");
        }
        
        elizaLogger.debug(`Using account address: ${account.address}`);
        elizaLogger.debug(`Preparing to deposit ${amount} BNB with parseEther value: ${parseEther(amount)}`);

        try {
            // Simulate contract call before execution to catch any potential errors
            elizaLogger.debug(`Simulating deposit transaction`);
            const { request } = await publicClient.simulateContract({
                account: this.walletProvider.getAccount(),
                address: this.LISTA_DAO,
                abi: ListaDaoAbi,
                functionName: "deposit",
                value: parseEther(amount),
            });
            
            // Execute the deposit transaction
            elizaLogger.debug(`Executing deposit transaction`);
            const txHash = await walletClient.writeContract(request);
            elizaLogger.debug(`Deposit transaction submitted with hash: ${txHash}`);
            
            // Wait for transaction confirmation
            elizaLogger.debug(`Waiting for transaction confirmation`);
            await publicClient.waitForTransactionReceipt({
                hash: txHash,
            });
            elizaLogger.debug(`Transaction confirmed: ${txHash}`);

            // Check the updated slisBNB balance
            elizaLogger.debug(`Checking updated slisBNB balance`);
            const slisBNBBalance = await publicClient.readContract({
                address: this.SLIS_BNB,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [account.address],
            });
            
            const formattedBalance = formatEther(slisBNBBalance);
            elizaLogger.debug(`Updated slisBNB balance: ${formattedBalance}`);

            return `Successfully do deposit. ${formattedBalance} slisBNB held. \nTransaction Hash: ${txHash}`;
        } catch (error) {
            elizaLogger.error(`Error during deposit operation:`, error);
            
            // Provide more specific error messages
            if (error.message.includes("insufficient funds")) {
                throw new Error(`Insufficient funds to deposit ${amount} BNB. Please check your balance.`);
            } else if (error.message.includes("user rejected")) {
                throw new Error("Transaction rejected by user.");
            }
            
            // Re-throw the original error if no specific handling
            throw error;
        }
    }

    async doWithdraw(amount?: string): Promise<string> {
        elizaLogger.debug(`Starting withdraw of ${amount || 'all'} slisBNB from Lista DAO`);
        
        const publicClient = this.walletProvider.getPublicClient("bsc");
        const walletClient = this.walletProvider.getWalletClient("bsc");
        const account = walletClient.account;
        
        if (!account) {
            elizaLogger.error("Wallet account not found");
            throw new Error("Wallet account not found");
        }
        
        elizaLogger.debug(`Using account address: ${account.address}`);

        try {
            // If amount is not provided, withdraw all slisBNB
            let amountToWithdraw: bigint;
            if (!amount) {
                elizaLogger.debug(`No amount specified, checking total slisBNB balance`);
                amountToWithdraw = await publicClient.readContract({
                    address: this.SLIS_BNB,
                    abi: erc20Abi,
                    functionName: "balanceOf",
                    args: [account.address],
                });
                elizaLogger.debug(`Total slisBNB balance to withdraw: ${formatEther(amountToWithdraw)}`);
            } else {
                amountToWithdraw = parseEther(amount);
                elizaLogger.debug(`Withdrawing specific amount: ${amount} slisBNB (${amountToWithdraw} wei)`);
            }
            
            // Check if there's anything to withdraw
            if (amountToWithdraw <= 0n) {
                elizaLogger.error(`No slisBNB to withdraw (amount: ${formatEther(amountToWithdraw)})`);
                throw new Error("No slisBNB tokens available to withdraw");
            }

            // Check slisBNB allowance
            elizaLogger.debug(`Checking slisBNB allowance for Lista DAO contract`);
            const allowance = await this.walletProvider.checkERC20Allowance(
                "bsc",
                this.SLIS_BNB,
                account.address,
                this.LISTA_DAO
            );
            elizaLogger.debug(`Current allowance: ${formatEther(allowance)}`);
            
            if (allowance < amountToWithdraw) {
                const neededAllowance = amountToWithdraw - allowance;
                elizaLogger.debug(`Increasing slisBNB allowance by ${formatEther(neededAllowance)}`);
                
                const txHash = await this.walletProvider.approveERC20(
                    "bsc",
                    this.SLIS_BNB,
                    this.LISTA_DAO,
                    amountToWithdraw
                );
                elizaLogger.debug(`Allowance approval transaction submitted with hash: ${txHash}`);
                
                await publicClient.waitForTransactionReceipt({
                    hash: txHash,
                });
                elizaLogger.debug(`Allowance approval transaction confirmed`);
            } else {
                elizaLogger.debug(`Sufficient allowance already granted`);
            }

            // Simulate the withdraw request
            elizaLogger.debug(`Simulating withdraw request transaction`);
            const { request } = await publicClient.simulateContract({
                account: this.walletProvider.getAccount(),
                address: this.LISTA_DAO,
                abi: ListaDaoAbi,
                functionName: "requestWithdraw",
                args: [amountToWithdraw],
            });
            
            // Execute the withdraw request
            elizaLogger.debug(`Executing withdraw request transaction`);
            const txHash = await walletClient.writeContract(request);
            elizaLogger.debug(`Withdraw request transaction submitted with hash: ${txHash}`);
            
            // Wait for transaction confirmation
            elizaLogger.debug(`Waiting for transaction confirmation`);
            await publicClient.waitForTransactionReceipt({
                hash: txHash,
            });
            elizaLogger.debug(`Transaction confirmed: ${txHash}`);

            // Check remaining slisBNB balance
            elizaLogger.debug(`Checking remaining slisBNB balance`);
            const slisBNBBalance = await publicClient.readContract({
                address: this.SLIS_BNB,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [account.address],
            });
            
            const formattedBalance = formatEther(slisBNBBalance);
            elizaLogger.debug(`Remaining slisBNB balance: ${formattedBalance}`);

            return `Successfully do withdraw. ${formattedBalance} slisBNB left. \nTransaction Hash: ${txHash}`;
        } catch (error) {
            elizaLogger.error(`Error during withdraw operation:`, error);
            
            // Provide more specific error messages
            if (error.message.includes("insufficient funds") || error.message.includes("insufficient balance")) {
                throw new Error(`Insufficient slisBNB balance to withdraw. Please check your balance.`);
            } else if (error.message.includes("user rejected")) {
                throw new Error("Transaction rejected by user.");
            }
            
            // Re-throw the original error if no specific handling
            throw error;
        }
    }

    async doClaim(): Promise<string> {
        elizaLogger.debug(`Starting claim operation for unlocked BNB from Lista DAO`);
        
        const publicClient = this.walletProvider.getPublicClient("bsc");
        const walletClient = this.walletProvider.getWalletClient("bsc");
        const account = walletClient.account;
        
        if (!account) {
            elizaLogger.error("Wallet account not found");
            throw new Error("Wallet account not found");
        }
        
        elizaLogger.debug(`Using account address: ${account.address}`);

        try {
            // Get user's withdrawal requests
            elizaLogger.debug(`Fetching user withdrawal requests`);
            const requests = await publicClient.readContract({
                address: this.LISTA_DAO,
                abi: ListaDaoAbi,
                functionName: "getUserWithdrawalRequests",
                args: [account.address],
            });
            
            elizaLogger.debug(`Found ${requests.length} withdrawal requests`);
            
            if (requests.length === 0) {
                elizaLogger.warn(`No withdrawal requests found for claiming`);
                return `No withdrawal requests found to claim. You need to request a withdrawal first using the 'withdraw' action.`;
            }

            let totalClaimed = 0n;
            let claimedCount = 0;
            
            // Process each withdrawal request
            for (let idx = 0; idx < requests.length; idx++) {
                elizaLogger.debug(`Checking request #${idx} status`);
                const [isClaimable, amount] = await publicClient.readContract({
                    address: this.LISTA_DAO,
                    abi: ListaDaoAbi,
                    functionName: "getUserRequestStatus",
                    args: [account.address, BigInt(idx)],
                });

                if (isClaimable) {
                    elizaLogger.debug(`Request #${idx} is claimable, amount: ${formatEther(amount)} BNB`);
                    
                    // Simulate the claim transaction
                    elizaLogger.debug(`Simulating claim transaction for request #${idx}`);
                    const { request } = await publicClient.simulateContract({
                        account: this.walletProvider.getAccount(),
                        address: this.LISTA_DAO,
                        abi: ListaDaoAbi,
                        functionName: "claimWithdraw",
                        args: [BigInt(idx)],
                    });

                    // Execute the claim transaction
                    elizaLogger.debug(`Executing claim transaction for request #${idx}`);
                    const txHash = await walletClient.writeContract(request);
                    elizaLogger.debug(`Claim transaction submitted with hash: ${txHash}`);
                    
                    // Wait for transaction confirmation
                    elizaLogger.debug(`Waiting for transaction confirmation`);
                    await publicClient.waitForTransactionReceipt({
                        hash: txHash,
                    });
                    elizaLogger.debug(`Transaction confirmed: ${txHash}`);

                    totalClaimed += amount;
                    claimedCount++;
                } else {
                    elizaLogger.debug(`Request #${idx} is not claimable yet, skipping`);
                    break; // Requests are ordered, so once we hit a non-claimable one, we can stop
                }
            }

            const formattedTotal = formatEther(totalClaimed);
            elizaLogger.debug(`Total claimed: ${formattedTotal} BNB from ${claimedCount} requests`);
            
            if (claimedCount === 0) {
                return `No claimable withdrawals found. Withdrawal requests typically need 7-14 days to become claimable.`;
            }

            return `Successfully do claim. ${formattedTotal} BNB claimed.`;
        } catch (error) {
            elizaLogger.error(`Error during claim operation:`, error);
            
            // Provide more specific error messages
            if (error.message.includes("user rejected")) {
                throw new Error("Transaction rejected by user.");
            }
            
            // Re-throw the original error if no specific handling
            throw error;
        }
    }
}

export const stakeAction = {
    name: "stake",
    description: "Stake related actions through Lista DAO",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting stake action...");
        elizaLogger.debug("Message content:", JSON.stringify(message.content, null, 2));

        // Extract prompt text for stake action analysis
        const promptText = typeof message.content.text === 'string' ? message.content.text.trim() : '';
        elizaLogger.debug(`Raw prompt text: "${promptText}"`);
        
        // Analyze prompt to detect stake actions directly
        const promptLower = promptText.toLowerCase();
        
        // Look for stake patterns in the prompt
        const stakeRegex = /(?:stake|deposit)\s+([0-9.]+)\s+(?:bnb|slisBNB)\s+(?:on|in|to|at)?(?:\s+lista\s+dao)?(?:\s+on)?\s+(?:bsc|binance)/i;
        const withdrawRegex = /(?:withdraw|unstake|undelegate)\s+([0-9.]+)\s+(?:bnb|slisBNB)\s+(?:from|on)?\s+(?:lista\s+dao)?(?:\s+on)?\s+(?:bsc|binance)/i;
        const claimRegex = /claim\s+(?:bnb|unlocked\s+bnb|rewards?)(?:\s+from)?\s+(?:lista\s+dao)?(?:\s+on)?\s+(?:bsc|binance)/i;
        
        let directAction: string | null = null;
        let directAmount: string | null = null;
        
        // Try to match stake pattern
        let match = promptText.match(stakeRegex);
        if (match && match.length >= 2) {
            directAction = "deposit";
            directAmount = match[1];
            elizaLogger.debug(`Directly extracted deposit action - Amount: ${directAmount}`);
        } else {
            // Try to match withdraw pattern
            match = promptText.match(withdrawRegex);
            if (match && match.length >= 2) {
                directAction = "withdraw";
                directAmount = match[1];
                elizaLogger.debug(`Directly extracted withdraw action - Amount: ${directAmount}`);
            } else {
                // Try to match claim pattern
                match = promptText.match(claimRegex);
                if (match) {
                    directAction = "claim";
                    elizaLogger.debug(`Directly extracted claim action`);
                }
            }
        }
        
        // Check for action keywords
        if (!directAction) {
            if (promptLower.includes("stake") || promptLower.includes("deposit")) {
                directAction = "deposit";
                elizaLogger.debug(`Detected stake/deposit action from keywords`);
            } else if (promptLower.includes("withdraw") || promptLower.includes("unstake") || promptLower.includes("undelegate")) {
                directAction = "withdraw";
                elizaLogger.debug(`Detected withdraw/unstake action from keywords`);
            } else if (promptLower.includes("claim")) {
                directAction = "claim";
                elizaLogger.debug(`Detected claim action from keywords`);
            }
        }
        
        // Extract numeric values if not already found
        if (!directAmount && directAction !== "claim") {
            const amountRegex = /([0-9]+(?:\.[0-9]+)?)/;
            const amountMatch = promptText.match(amountRegex);
            if (amountMatch && amountMatch.length >= 2) {
                directAmount = amountMatch[1];
                elizaLogger.debug(`Extracted amount from prompt: ${directAmount}`);
            }
        }
        
        // Store prompt analysis results
        const promptAnalysis = {
            directAction,
            directAmount,
            containsBNB: promptLower.includes("bnb"),
            containsListaDAO: promptLower.includes("lista") || promptLower.includes("dao"),
            containsBSC: promptLower.includes("bsc") || promptLower.includes("binance")
        };
        
        elizaLogger.debug("Prompt analysis result:", promptAnalysis);

        // Validate stake
        if (!(message.content.source === "direct")) {
            callback?.({
                text: "I can't do that for you.",
                content: { error: "Stake not allowed" },
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
            callback?.({
                text: `Unable to access wallet: ${error.message}`,
                content: { error: error.message },
            });
            return false;
        }

        // Compose stake context
        const stakeContext = composeContext({
            state: currentState,
            template: stakeTemplate,
        });
        const content = await generateObjectDeprecated({
            runtime,
            context: stakeContext,
            modelClass: ModelClass.LARGE,
        });
        
        elizaLogger.debug("Generated stake content:", JSON.stringify(content, null, 2));
        
        // PRIORITY ORDER FOR ACTION DETERMINATION:
        // 1. Direct match from prompt text (most reliable)
        // 2. Action specified in model-generated content
        // 3. Default to deposit
        
        let stakeAction: string;
        let amount: string | undefined;
        
        // 1. First priority: Use directly extracted action from prompt if available
        if (directAction) {
            stakeAction = directAction;
            elizaLogger.debug(`Using action directly extracted from prompt: ${stakeAction}`);
        }
        // 2. Second priority: Use action from content if available
        else if (content.action) {
            stakeAction = content.action;
            elizaLogger.debug(`Using action from generated content: ${stakeAction}`);
        }
        // 3. Default fallback
        else {
            stakeAction = "deposit"; // Default action
            elizaLogger.debug(`No action detected, defaulting to deposit`);
        }
        
        // Determine amount (if needed)
        if (stakeAction !== "claim") {
            // For deposit and withdraw, amount is needed
            if (directAmount) {
                amount = directAmount;
                elizaLogger.debug(`Using amount directly extracted from prompt: ${amount}`);
            } else if (content.amount) {
                amount = content.amount;
                elizaLogger.debug(`Using amount from generated content: ${amount}`);
            } else if (stakeAction === "deposit") {
                amount = "0.001"; // Default small amount for deposit
                elizaLogger.debug(`No amount detected for deposit, defaulting to ${amount}`);
            }
            // For withdraw, undefined amount is valid (withdraws all)
        }

        const walletProvider = initWalletProvider(runtime);
        const action = new StakeAction(walletProvider);
        const paramOptions: StakeParams = {
            chain: "bsc", // Only BSC is supported for staking
            action: stakeAction as "deposit" | "withdraw" | "claim",
            amount: amount,
        };
        
        elizaLogger.debug("Final stake options:", JSON.stringify(paramOptions, null, 2));
        
        try {
            elizaLogger.debug("Calling stake with params:", JSON.stringify(paramOptions, null, 2));
            const stakeResp = await action.stake(paramOptions);
            callback?.({
                text: stakeResp.response,
                content: { ...stakeResp },
            });

            return true;
        } catch (error) {
            elizaLogger.error("Error during stake:", error.message);
            
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
                errorMessage = `Insufficient funds for the stake operation. Please check your balance and try with a smaller amount.`;
            } else if (error.message.includes("user rejected")) {
                errorMessage = `Transaction was rejected. Please try again if you want to proceed with the stake operation.`;
            } else if (error.message.includes("No withdrawal requests")) {
                errorMessage = `No withdrawal requests found to claim. You need to request a withdrawal first using the 'withdraw' action.`;
            }
            
            callback?.({
                text: `Stake failed: ${errorMessage}`,
                content: { error: errorMessage },
            });
            return false;
        }
    },
    template: stakeTemplate,
    validate: async (runtime: IAgentRuntime) => {
        const privateKey = runtime.getSetting("BNB_PRIVATE_KEY");
        return typeof privateKey === "string" && privateKey.startsWith("0x");
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Stake 0.001 BNB on BSC",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I'll help you stake 0.001 BNB to Lista DAO on BSC",
                    action: "STAKE",
                    content: {
                        action: "deposit",
                        amount: "0.001",
                    },
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Deposit 0.001 BNB to Lista DAO",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I'll help you deposit 0.001 BNB to Lista DAO on BSC",
                    action: "STAKE",
                    content: {
                        action: "deposit",
                        amount: "0.001",
                    },
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Undelegate 0.001 slisBNB on BSC",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I'll help you undelegate 0.001 slisBNB from Lista DAO on BSC",
                    action: "STAKE",
                    content: {
                        action: "withdraw",
                        amount: "0.001",
                    },
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Withdraw 0.001 slisBNB from Lista DAO",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I'll help you withdraw 0.001 slisBNB from Lista DAO on BSC",
                    action: "STAKE",
                    content: {
                        action: "withdraw",
                        amount: "0.001",
                    },
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Claim unlocked BNB from Lista DAO",
                },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "I'll help you claim unlocked BNB from Lista DAO on BSC",
                    action: "STAKE",
                    content: {
                        action: "claim",
                    },
                },
            },
        ],
    ],
    similes: [
        "DELEGATE",
        "STAKE",
        "DEPOSIT",
        "UNDELEGATE",
        "UNSTAKE",
        "WITHDRAW",
        "CLAIM",
    ],
};

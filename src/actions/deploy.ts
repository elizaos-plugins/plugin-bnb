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
import solc from "solc";
import { type Abi, type Address, parseUnits } from "viem";
import {
    bnbWalletProvider,
    initWalletProvider,
    type WalletProvider,
} from "../providers/wallet";
import { ercContractTemplate } from "../templates";
import type {
    IDeployERC1155Params,
    IDeployERC721Params,
    IDeployERC20Params,
    SupportedChain,
} from "../types";
import { compileSolidity } from "../utils/contracts";

export { ercContractTemplate };

export class DeployAction {
    constructor(private walletProvider: WalletProvider) {}

    async compileSolidity(contractName: string, source: string) {
        elizaLogger.debug(`Compiling Solidity contract: ${contractName}`);
        const solName = `${contractName}.sol`;
        const input = {
            language: "Solidity",
            sources: {
                [solName]: {
                    content: source,
                },
            },
            settings: {
                outputSelection: {
                    "*": {
                        "*": ["*"],
                    },
                },
            },
        };
        elizaLogger.debug("Preparing to compile contract...");
        
        try {
            const output = JSON.parse(solc.compile(JSON.stringify(input)));
            elizaLogger.debug("Compilation completed, checking for errors...");

            // Check compile error
            if (output.errors) {
                const errors = output.errors;
                const hasError = errors.some((error) => error.type === "Error");
                
                if (hasError) {
                    elizaLogger.error(`Compilation errors:`, JSON.stringify(errors, null, 2));
                    const errorMessages = errors.map(e => e.formattedMessage || e.message).join("\n");
                    throw new Error(`Contract compilation failed: ${errorMessages}`);
                } else {
                    // Just warnings
                    elizaLogger.warn(`Compilation warnings:`, JSON.stringify(errors, null, 2));
                }
            }

            const contract = output.contracts[solName][contractName];

            if (!contract) {
                elizaLogger.error(`Compilation result is empty for ${contractName}`);
                throw new Error(`Compilation result is empty for ${contractName}`);
            }

            elizaLogger.debug(`Contract ${contractName} compiled successfully`);
            return {
                abi: contract.abi as Abi,
                bytecode: contract.evm.bytecode.object,
            };
        } catch (error) {
            elizaLogger.error(`Error compiling contract ${contractName}:`, error);
            throw new Error(`Failed to compile contract: ${error.message}`);
        }
    }

    async deployERC20(deployTokenParams: IDeployERC20Params) {
        elizaLogger.debug("Deploying ERC20 token with params:", JSON.stringify(deployTokenParams, null, 2));

        // Validate parameters
        const { name, symbol, decimals, totalSupply, chain } = deployTokenParams;
        
        if (!name || name === "") {
            elizaLogger.error("Token name is required");
            throw new Error("Token name is required");
        }
        if (!symbol || symbol === "") {
            elizaLogger.error("Token symbol is required");
            throw new Error("Token symbol is required");
        }
        if (!decimals || decimals === 0) {
            elizaLogger.error("Token decimals is required");
            throw new Error("Token decimals is required");
        }
        if (!totalSupply || totalSupply === "") {
            elizaLogger.error("Token total supply is required");
            throw new Error("Token total supply is required");
        }
        
        elizaLogger.debug(`Deploying ERC20 token: ${name} (${symbol}) with ${decimals} decimals and total supply ${totalSupply}`);

        try {
            elizaLogger.debug(`Converting total supply ${totalSupply} to wei with ${decimals} decimals`);
            const totalSupplyWithDecimals = parseUnits(totalSupply, decimals);
            elizaLogger.debug(`Total supply in wei: ${totalSupplyWithDecimals.toString()}`);
            
            const args = [name, symbol, decimals, totalSupplyWithDecimals];
            elizaLogger.debug(`Contract constructor arguments:`, args);
            
            elizaLogger.debug(`Deploying ERC20 contract on chain ${chain}...`);
            const contractAddress = await this.deployContract(
                chain,
                "ERC20Contract",
                args
            );

            if (!contractAddress) {
                elizaLogger.error("Failed to deploy ERC20 contract - no address returned");
                throw new Error("Failed to deploy ERC20 contract");
            }
            
            elizaLogger.debug(`ERC20 contract deployed successfully at address: ${contractAddress}`);
            return {
                address: contractAddress,
            };
        } catch (error) {
            elizaLogger.error("Deploy ERC20 failed:", error.message);
            throw error;
        }
    }

    async deployERC721(deployNftParams: IDeployERC721Params) {
        elizaLogger.debug("Deploying ERC721 NFT with params:", JSON.stringify(deployNftParams, null, 2));

        // Validate parameters
        const { baseURI, name, symbol, chain } = deployNftParams;
        
        if (!name || name === "") {
            elizaLogger.error("NFT name is required");
            throw new Error("NFT name is required");
        }
        if (!symbol || symbol === "") {
            elizaLogger.error("NFT symbol is required");
            throw new Error("NFT symbol is required");
        }
        if (!baseURI || baseURI === "") {
            elizaLogger.error("NFT baseURI is required");
            throw new Error("NFT baseURI is required");
        }
        
        elizaLogger.debug(`Deploying ERC721 NFT: ${name} (${symbol}) with baseURI ${baseURI}`);
        
        try {
            const args = [name, symbol, baseURI];
            elizaLogger.debug(`Contract constructor arguments:`, args);
            
            elizaLogger.debug(`Deploying ERC721 contract on chain ${chain}...`);
            const contractAddress = await this.deployContract(
                chain,
                "ERC721Contract",
                args
            );

            if (!contractAddress) {
                elizaLogger.error("Failed to deploy ERC721 contract - no address returned");
                throw new Error("Failed to deploy ERC721 contract");
            }
            
            elizaLogger.debug(`ERC721 contract deployed successfully at address: ${contractAddress}`);
            return {
                address: contractAddress,
            };
        } catch (error) {
            elizaLogger.error("Deploy ERC721 failed:", error.message);
            throw error;
        }
    }

    async deployERC1155(deploy1155Params: IDeployERC1155Params) {
        elizaLogger.debug("Deploying ERC1155 token with params:", JSON.stringify(deploy1155Params, null, 2));

        // Validate parameters
        const { baseURI, name, chain } = deploy1155Params;
        
        if (!name || name === "") {
            elizaLogger.error("Token name is required");
            throw new Error("Token name is required");
        }
        if (!baseURI || baseURI === "") {
            elizaLogger.error("Token baseURI is required");
            throw new Error("Token baseURI is required");
        }
        
        elizaLogger.debug(`Deploying ERC1155 token: ${name} with baseURI ${baseURI}`);
        
        try {
            const args = [name, baseURI];
            elizaLogger.debug(`Contract constructor arguments:`, args);
            
            elizaLogger.debug(`Deploying ERC1155 contract on chain ${chain}...`);
            const contractAddress = await this.deployContract(
                chain,
                "ERC1155Contract",
                args
            );

            if (!contractAddress) {
                elizaLogger.error("Failed to deploy ERC1155 contract - no address returned");
                throw new Error("Failed to deploy ERC1155 contract");
            }
            
            elizaLogger.debug(`ERC1155 contract deployed successfully at address: ${contractAddress}`);
            return {
                address: contractAddress,
            };
        } catch (error) {
            elizaLogger.error("Deploy ERC1155 failed:", error.message);
            throw error;
        }
    }

    async deployContract(
        chain: SupportedChain,
        contractName: string,
        args: any[]
    ): Promise<Address | null | undefined> {
        elizaLogger.debug(`Starting contract deployment process for ${contractName} on chain ${chain}`);
        
        try {
            elizaLogger.debug(`Compiling ${contractName}...`);
            const { abi, bytecode } = await compileSolidity(contractName);
            
            if (!abi) {
                elizaLogger.error(`No ABI found for ${contractName}`);
                throw new Error(`Compilation failed: No ABI found for ${contractName}`);
            }
            
            if (!bytecode) {
                elizaLogger.error(`No bytecode found for ${contractName}`);
                throw new Error("Bytecode is empty after compilation");
            }
            
            elizaLogger.debug(`Compilation successful, bytecode length: ${bytecode.length}`);
            elizaLogger.debug(`Switching to chain ${chain} for deployment`);
            this.walletProvider.switchChain(chain);

            const chainConfig = this.walletProvider.getChainConfigs(chain);
            elizaLogger.debug(`Using chain config: ${chainConfig.name} (ID: ${chainConfig.id})`);
            
            const walletClient = this.walletProvider.getWalletClient(chain);
            const account = this.walletProvider.getAccount();
            elizaLogger.debug(`Deploying from account: ${account.address}`);
            
            // Calculate approximate gas before deployment
            const publicClient = this.walletProvider.getPublicClient(chain);
            
            elizaLogger.debug(`Submitting deployment transaction...`);
            const hash = await walletClient.deployContract({
                account,
                abi,
                bytecode,
                args,
                chain: chainConfig,
            });

            elizaLogger.debug(`Deployment transaction submitted with hash: ${hash}`);
            elizaLogger.debug(`Waiting for deployment transaction confirmation...`);
            
            const receipt = await publicClient.waitForTransactionReceipt({
                hash,
            });
            
            if (receipt.status === "success") {
                elizaLogger.debug(`Contract deployed successfully at address: ${receipt.contractAddress}`);
            } else {
                elizaLogger.error(`Deployment transaction failed with status: ${receipt.status}`);
                throw new Error("Contract deployment transaction failed");
            }

            return receipt.contractAddress;
        } catch (error) {
            elizaLogger.error(`Error deploying contract ${contractName}:`, error);
            
            // Provide more informative error messages
            if (error.message.includes("insufficient funds")) {
                throw new Error(`Insufficient funds to deploy the contract. Please check your balance.`);
            } else if (error.message.includes("user rejected")) {
                throw new Error("Transaction rejected by user.");
            }
            
            throw error;
        }
    }
}

export const deployAction = {
    name: "deploy_token",
    description:
        "Deploy token contracts (ERC20/721/1155) based on user specifications",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting deploy action...");
        elizaLogger.debug("Message content:", JSON.stringify(message.content, null, 2));

        // Extract prompt text for contract deployment analysis
        const promptText = typeof message.content.text === 'string' ? message.content.text.trim() : '';
        elizaLogger.debug(`Raw prompt text: "${promptText}"`);
        
        // Analyze prompt to detect contract type and parameters
        const promptLower = promptText.toLowerCase();
        
        // Regular expressions for contract parameter detection
        const erc20Regex = /(?:deploy|create)\s+(?:an?\s+)?(?:erc20|token)(?:\s+token)?\s+(?:with|having|named)?\s+(?:name\s+['"]?([^'"]+)['"]?|['"]?([^'"]+)['"]?\s+token)/i;
        const erc721Regex = /(?:deploy|create)\s+(?:an?\s+)?(?:erc721|nft)(?:\s+token)?\s+(?:with|having|named)?\s+(?:name\s+['"]?([^'"]+)['"]?|['"]?([^'"]+)['"]?\s+nft)/i;
        const erc1155Regex = /(?:deploy|create)\s+(?:an?\s+)?(?:erc1155|multi-token)(?:\s+token)?\s+(?:with|having|named)?\s+(?:name\s+['"]?([^'"]+)['"]?|['"]?([^'"]+)['"]?\s+token)/i;
        
        const symbolRegex = /symbol\s+['"]?([^'"]+)['"]?/i;
        const decimalsRegex = /decimals\s+([0-9]+)/i;
        const totalSupplyRegex = /(?:total\s+supply|supply)\s+([0-9]+(?:\.[0-9]+)?(?:\s*[kmbt])?)/i;
        const baseURIRegex = /(?:base\s*uri|baseuri|uri)\s+['"]?(https?:\/\/[^'"]+)['"]?/i;
        
        // Detect contract type
        let directContractType: string | null = null;
        let directName: string | null = null;
        let directSymbol: string | null = null;
        let directDecimals: number | null = null;
        let directTotalSupply: string | null = null;
        let directBaseURI: string | null = null;
        let directChain: SupportedChain | null = null;
        
        // Check for ERC20 pattern
        let match = promptText.match(erc20Regex);
        if (match) {
            directContractType = "erc20";
            directName = match[1] || match[2] || null;
            elizaLogger.debug(`Detected ERC20 token deployment with name: ${directName}`);
        }
        
        // Check for ERC721 pattern
        if (!directContractType) {
            match = promptText.match(erc721Regex);
            if (match) {
                directContractType = "erc721";
                directName = match[1] || match[2] || null;
                elizaLogger.debug(`Detected ERC721 NFT deployment with name: ${directName}`);
            }
        }
        
        // Check for ERC1155 pattern
        if (!directContractType) {
            match = promptText.match(erc1155Regex);
            if (match) {
                directContractType = "erc1155";
                directName = match[1] || match[2] || null;
                elizaLogger.debug(`Detected ERC1155 token deployment with name: ${directName}`);
            }
        }
        
        // Check for common keywords if no type detected yet
        if (!directContractType) {
            if (promptLower.includes("erc20") || promptLower.includes("fungible token")) {
                directContractType = "erc20";
                elizaLogger.debug("Detected ERC20 token deployment from keywords");
            } else if (promptLower.includes("erc721") || promptLower.includes("nft") || promptLower.includes("non-fungible")) {
                directContractType = "erc721";
                elizaLogger.debug("Detected ERC721 token deployment from keywords");
            } else if (promptLower.includes("erc1155") || promptLower.includes("multi") || promptLower.includes("1155")) {
                directContractType = "erc1155";
                elizaLogger.debug("Detected ERC1155 token deployment from keywords");
            }
        }
        
        // Extract symbol
        match = promptText.match(symbolRegex);
        if (match && match.length >= 2) {
            directSymbol = match[1].trim();
            elizaLogger.debug(`Extracted token symbol: ${directSymbol}`);
        }
        
        // Extract decimals
        match = promptText.match(decimalsRegex);
        if (match && match.length >= 2) {
            directDecimals = parseInt(match[1], 10);
            elizaLogger.debug(`Extracted token decimals: ${directDecimals}`);
        }
        
        // Extract total supply
        match = promptText.match(totalSupplyRegex);
        if (match && match.length >= 2) {
            directTotalSupply = match[1].trim();
            // Convert shorthand notations (K, M, B, T) to full numbers
            if (directTotalSupply.endsWith('k') || directTotalSupply.endsWith('K')) {
                directTotalSupply = (parseFloat(directTotalSupply) * 1000).toString();
            } else if (directTotalSupply.endsWith('m') || directTotalSupply.endsWith('M')) {
                directTotalSupply = (parseFloat(directTotalSupply) * 1000000).toString();
            } else if (directTotalSupply.endsWith('b') || directTotalSupply.endsWith('B')) {
                directTotalSupply = (parseFloat(directTotalSupply) * 1000000000).toString();
            } else if (directTotalSupply.endsWith('t') || directTotalSupply.endsWith('T')) {
                directTotalSupply = (parseFloat(directTotalSupply) * 1000000000000).toString();
            }
            elizaLogger.debug(`Extracted token total supply: ${directTotalSupply}`);
        }
        
        // Extract baseURI
        match = promptText.match(baseURIRegex);
        if (match && match.length >= 2) {
            directBaseURI = match[1].trim();
            elizaLogger.debug(`Extracted token baseURI: ${directBaseURI}`);
        }
        
        // Detect chain
        if (promptLower.includes("bsc") || promptLower.includes("binance")) {
            directChain = "bsc";
            elizaLogger.debug("Detected BSC chain from prompt");
        } else if (promptLower.includes("opbnb") || promptLower.includes("op bnb")) {
            directChain = "opBNB";
            elizaLogger.debug("Detected opBNB chain from prompt");
        }
        
        // Store prompt analysis results
        const promptAnalysis = {
            directContractType,
            directName,
            directSymbol,
            directDecimals,
            directTotalSupply,
            directBaseURI,
            directChain
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
            elizaLogger.debug("Getting wallet info...");
            state.walletInfo = await bnbWalletProvider.get(runtime, message, currentState);
            elizaLogger.debug("Wallet info retrieved:", state.walletInfo);
        } catch (error) {
            elizaLogger.error("Error getting wallet info:", error.message);
            callback?.({
                text: `Unable to access wallet: ${error.message}`,
                content: { error: error.message },
            });
            return false;
        }

        // Compose context
        elizaLogger.debug("Composing contract template context...");
        const context = composeContext({
            state: currentState,
            template: ercContractTemplate,
        });
        
        elizaLogger.debug("Generating contract parameters via model...");
        const content = await generateObjectDeprecated({
            runtime,
            context: context,
            modelClass: ModelClass.LARGE,
        });
        
        elizaLogger.debug("Generated contract content:", JSON.stringify(content, null, 2));

        // PRIORITY ORDER FOR CONTRACT PARAMETERS:
        // 1. Direct match from prompt text (most reliable)
        // 2. Parameters specified in model-generated content
        // 3. Default values where appropriate
        
        // Determine contract type
        let contractType: string;
        if (directContractType) {
            contractType = directContractType;
            elizaLogger.debug(`Using contract type directly extracted from prompt: ${contractType}`);
        } else if (content.contractType) {
            contractType = content.contractType.toLowerCase();
            elizaLogger.debug(`Using contract type from generated content: ${contractType}`);
        } else {
            contractType = "erc20"; // Default
            elizaLogger.debug(`No contract type detected, defaulting to ${contractType}`);
        }
        
        // Determine chain
        let chain: SupportedChain = "bsc"; // Default
        if (directChain) {
            chain = directChain;
            elizaLogger.debug(`Using chain directly extracted from prompt: ${chain}`);
        } else if (content.chain) {
            chain = content.chain;
            elizaLogger.debug(`Using chain from generated content: ${chain}`);
        } else {
            elizaLogger.debug(`No chain detected, defaulting to ${chain}`);
        }
        
        // Initialize wallet provider and action handler
        elizaLogger.debug("Initializing wallet provider...");
        const walletProvider = initWalletProvider(runtime);
        const action = new DeployAction(walletProvider);
        
        try {
            elizaLogger.debug(`Starting deployment process for ${contractType.toUpperCase()} contract on ${chain}...`);
            let result: any;
            
            switch (contractType.toLowerCase()) {
                case "erc20":
                    // Determine ERC20 specific parameters
                    const name = directName || content.name || "DefaultToken";
                    const symbol = directSymbol || content.symbol || "DTK";
                    const decimals = directDecimals || content.decimals || 18;
                    const totalSupply = directTotalSupply || content.totalSupply || "1000000";
                    
                    elizaLogger.debug(`Deploying ERC20 with params: name=${name}, symbol=${symbol}, decimals=${decimals}, totalSupply=${totalSupply}`);
                    
                    result = await action.deployERC20({
                        chain,
                        decimals,
                        symbol,
                        name,
                        totalSupply,
                    });
                    break;
                    
                case "erc721":
                    // Determine ERC721 specific parameters
                    const nftName = directName || content.name || "DefaultNFT";
                    const nftSymbol = directSymbol || content.symbol || "DNFT";
                    const nftBaseURI = directBaseURI || content.baseURI || "https://example.com/token/";
                    
                    elizaLogger.debug(`Deploying ERC721 with params: name=${nftName}, symbol=${nftSymbol}, baseURI=${nftBaseURI}`);
                    
                    result = await action.deployERC721({
                        chain,
                        name: nftName,
                        symbol: nftSymbol,
                        baseURI: nftBaseURI,
                    });
                    break;
                    
                case "erc1155":
                    // Determine ERC1155 specific parameters
                    const multiName = directName || content.name || "DefaultMultiToken";
                    const multiBaseURI = directBaseURI || content.baseURI || "https://example.com/multi-token/";
                    
                    elizaLogger.debug(`Deploying ERC1155 with params: name=${multiName}, baseURI=${multiBaseURI}`);
                    
                    result = await action.deployERC1155({
                        chain,
                        name: multiName,
                        baseURI: multiBaseURI,
                    });
                    break;
                    
                default:
                    elizaLogger.error(`Unsupported contract type: ${contractType}`);
                    throw new Error(`Unsupported contract type: ${contractType}. Supported types are: erc20, erc721, erc1155`);
            }

            if (result && result.address) {
                elizaLogger.debug(`Contract deployed successfully at address: ${result.address}`);
                
                // Prepare user-friendly response with contract type and chain info
                const contractTypeName = contractType.toUpperCase();
                const chainName = chain === "bsc" ? "Binance Smart Chain" : "opBNB";
                
                callback?.({
                    text: `Successfully deployed ${contractTypeName} contract on ${chainName} at address: ${result.address}`,
                    content: { 
                        ...result,
                        contractType,
                        chain 
                    },
                });
            } else {
                elizaLogger.error("Contract deployment failed - no address returned");
                callback?.({
                    text: "Contract deployment failed",
                    content: { error: "No contract address returned" },
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error("Error during contract deployment:", error.message);
            
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
                },
            });
            return false;
        }
    },
    template: ercContractTemplate,
    validate: async (_runtime: IAgentRuntime) => {
        return true;
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Deploy an ERC20 token with name 'elizayolo', symbol 'ELIYOYO', decimals 18, total supply 10000",
                    action: "DEPLOY_TOKEN",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Deploy an ERC721 NFT contract with name 'MyNFT', symbol 'MNFT', baseURI 'https://my-nft-base-uri.com'",
                    action: "DEPLOY_TOKEN",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Deploy an ERC1155 contract with name 'My1155', baseURI 'https://my-1155-base-uri.com'",
                    action: "DEPLOY_TOKEN",
                },
            },
        ],
    ],
    similes: [
        "DEPLOY_ERC20",
        "DEPLOY_ERC721",
        "DEPLOY_ERC1155",
        "CREATE_TOKEN",
        "CREATE_NFT",
        "CREATE_1155",
    ],
};

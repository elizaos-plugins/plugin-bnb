import {
  composePromptFromState,
  parseKeyValueXml,
  elizaLogger,
  type HandlerCallback,
  ModelType,
  type IAgentRuntime,
  type Memory,
  type State,
  type Content,
  type Action,
} from '@elizaos/core';
import { executeRoute, getRoutes } from '@lifi/sdk';
import { parseEther } from 'viem';

import { bnbWalletProvider, initWalletProvider, type WalletProvider } from '../providers/wallet';
import { swapTemplate } from '../templates';
import type { SwapParams, SwapResponse, SupportedChain } from '../types';

export { swapTemplate };

// Content interface for swap action
interface SwapContent extends Content {
  chain: string;
  inputToken: string;
  outputToken: string;
  amount: string;
  slippage?: number;
}

// Validation function for swap content
function isSwapContent(_runtime: IAgentRuntime, content: any): content is SwapContent {
  elizaLogger.debug('Swap content for validation', content);
  return (
    content &&
    typeof content.chain === 'string' &&
    typeof content.inputToken === 'string' &&
    typeof content.outputToken === 'string' &&
    typeof content.amount === 'string'
  );
}

export class SwapAction {
  constructor(private walletProvider: WalletProvider) {}

  async swap(params: SwapParams): Promise<SwapResponse> {
    elizaLogger.debug('Starting swap with params:', JSON.stringify(params, null, 2));

    // Validate chain
    this.validateAndNormalizeParams(params);
    elizaLogger.debug('After validation, params:', JSON.stringify(params, null, 2));

    const fromAddress = this.walletProvider.getAddress();
    elizaLogger.debug(`From address: ${fromAddress}`);

    const chainId = this.walletProvider.getChainConfigs(params.chain).id;
    elizaLogger.debug(`Chain ID: ${chainId}`);

    // Configure LI.FI SDK
    elizaLogger.debug(`Configuring LI.FI SDK for chain: ${params.chain}`);
    this.walletProvider.configureLiFiSdk(params.chain);

    // Resolve token addresses if they're symbols
    let fromTokenAddress = params.fromToken;
    let toTokenAddress = params.toToken;

    // Handle fromToken
    if (!params.fromToken.startsWith('0x')) {
      try {
        elizaLogger.debug(`Resolving from token symbol: ${params.fromToken}`);
        fromTokenAddress = await this.walletProvider.getTokenAddress(
          params.chain,
          params.fromToken
        );
        elizaLogger.debug(`Resolved from token address: ${fromTokenAddress}`);

        // Special handling for native token
        if (params.fromToken.toUpperCase() === 'BNB') {
          elizaLogger.debug('Using special native token address for BNB');
          fromTokenAddress = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
        }
      } catch (error) {
        elizaLogger.error(`Error resolving from token address for ${params.fromToken}:`, error);
        throw new Error(
          `Could not find token ${params.fromToken} on chain ${params.chain}. Please check the token symbol.`
        );
      }
    } else {
      elizaLogger.debug(`Using direct from token address: ${fromTokenAddress}`);
    }

    // Handle toToken
    if (!params.toToken.startsWith('0x')) {
      try {
        elizaLogger.debug(`Resolving to token symbol: ${params.toToken}`);
        toTokenAddress = await this.walletProvider.getTokenAddress(params.chain, params.toToken);
        elizaLogger.debug(`Resolved to token address: ${toTokenAddress}`);

        // Special handling for native token
        if (params.toToken.toUpperCase() === 'BNB') {
          elizaLogger.debug('Using special native token address for BNB');
          toTokenAddress = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
        }
      } catch (error) {
        elizaLogger.error(`Error resolving to token address for ${params.toToken}:`, error);
        throw new Error(
          `Could not find token ${params.toToken} on chain ${params.chain}. Please check the token symbol.`
        );
      }
    } else {
      elizaLogger.debug(`Using direct to token address: ${toTokenAddress}`);
    }

    const resp: SwapResponse = {
      chain: params.chain,
      txHash: '0x',
      fromToken: params.fromToken,
      toToken: params.toToken,
      amount: params.amount,
    };

    elizaLogger.debug(`Getting routes from ${fromTokenAddress} to ${toTokenAddress}`);

    // Set a reasonable default slippage if not provided
    const slippage = params.slippage || 0.05; // Default 5%
    elizaLogger.debug(`Using slippage: ${slippage}`);

    try {
      const routes = await getRoutes({
        fromChainId: chainId,
        toChainId: chainId,
        fromTokenAddress: fromTokenAddress,
        toTokenAddress: toTokenAddress,
        fromAmount: parseEther(params.amount).toString(),
        fromAddress: fromAddress,
        options: {
          slippage: slippage,
          order: 'RECOMMENDED',
        },
      });

      elizaLogger.debug(`Found ${routes.routes.length} routes`);

      if (!routes.routes.length) {
        throw new Error(
          `No routes found from ${params.fromToken} to ${params.toToken} with amount ${params.amount}`
        );
      }

      elizaLogger.debug(`Executing route: ${JSON.stringify(routes.routes[0].steps, null, 2)}`);
      const execution = await executeRoute(routes.routes[0]);

      elizaLogger.debug(`Execution: ${JSON.stringify(execution.steps, null, 2)}`);

      const process =
        execution.steps[0]?.execution?.process[execution.steps[0]?.execution?.process.length - 1];

      if (!process?.status || process.status === 'FAILED') {
        throw new Error(`Transaction failed: ${process?.status || 'unknown error'}`);
      }

      resp.txHash = process.txHash as `0x${string}`;
      elizaLogger.debug(`Swap successful with tx hash: ${resp.txHash}`);

      return resp;
    } catch (error) {
      elizaLogger.error(`Error during swap execution:`, error);

      // Try to provide more specific error messages
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('insufficient funds')) {
        elizaLogger.error(`Insufficient funds for swap`);
        throw new Error(
          `Insufficient funds for swapping ${params.amount} ${params.fromToken}. Please check your balance.`
        );
      } else if (errorMessage.includes('Cannot read properties')) {
        elizaLogger.error(`SDK response parsing error`);
        throw new Error(
          `Error processing swap response. This might be due to rate limits or invalid token parameters.`
        );
      }

      // Re-throw the error
      throw error;
    }
  }

  validateAndNormalizeParams(params: SwapParams): void {
    elizaLogger.debug(
      `Validating swap params: chain=${params.chain}, from=${params.fromToken}, to=${params.toToken}, amount=${params.amount}`
    );

    // Validate chain
    if (!params.chain) {
      elizaLogger.debug(`No chain specified, defaulting to bsc`);
      params.chain = 'bsc';
    } else if (params.chain !== 'bsc') {
      elizaLogger.error(`Unsupported chain: ${params.chain}`);
      throw new Error('Only BSC mainnet is supported for swaps');
    }

    // Validate token inputs
    if (!params.fromToken) {
      elizaLogger.error(`From token not specified`);
      throw new Error('From token is required for swap');
    }

    if (!params.toToken) {
      elizaLogger.error(`To token not specified`);
      throw new Error('To token is required for swap');
    }

    // Prevent swapping to the same token
    if (params.fromToken === params.toToken) {
      elizaLogger.error(`Cannot swap from and to the same token: ${params.fromToken}`);
      throw new Error(`Cannot swap from and to the same token: ${params.fromToken}`);
    }

    // Validate amount
    if (!params.amount) {
      elizaLogger.error(`Amount not specified`);
      throw new Error('Amount is required for swap');
    }

    try {
      const amountBigInt = parseEther(params.amount);
      if (amountBigInt <= 0n) {
        elizaLogger.error(`Invalid amount: ${params.amount} (must be greater than 0)`);
        throw new Error('Swap amount must be greater than 0');
      }
      elizaLogger.debug(`Amount parsed: ${amountBigInt.toString()} wei`);
    } catch (error) {
      elizaLogger.error(`Failed to parse amount: ${params.amount}`, error);
      throw new Error(`Invalid swap amount: ${params.amount}. Please provide a valid number.`);
    }

    // Validate slippage
    if (params.slippage !== undefined) {
      if (typeof params.slippage !== 'number') {
        elizaLogger.error(`Invalid slippage type: ${typeof params.slippage}`);
        throw new Error('Slippage must be a number');
      }

      if (params.slippage <= 0 || params.slippage > 1) {
        elizaLogger.error(`Invalid slippage value: ${params.slippage} (must be between 0 and 1)`);
        throw new Error('Slippage must be between 0 and 1 (e.g., 0.05 for 5%)');
      }
    } else {
      // Set default slippage
      params.slippage = 0.05;
      elizaLogger.debug(`Using default slippage: ${params.slippage}`);
    }
  }
}

export const swapAction = {
  name: 'swap',
  description: 'Swap tokens on the same chain',
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: Record<string, unknown>,
    callback?: HandlerCallback
  ) => {
    elizaLogger.log('Starting swap action...');
    elizaLogger.debug('Message content:', JSON.stringify(message.content, null, 2));

    // Extract prompt text for token detection
    const promptText = typeof message.content.text === 'string' ? message.content.text.trim() : '';
    elizaLogger.debug(`Raw prompt text: "${promptText}"`);

    // Analyze prompt to detect tokens directly
    const promptLower = promptText.toLowerCase();

    // Look for swap patterns in the prompt
    const basicSwapRegex = /swap\s+([0-9.]+)\s+([a-zA-Z0-9]+)\s+(?:for|to)\s+([a-zA-Z0-9]+)/i;
    const advancedSwapRegex =
      /(?:swap|exchange|trade|convert)\s+([0-9.]+)\s+([a-zA-Z0-9]+)\s+(?:for|to|into)\s+([a-zA-Z0-9]+)/i;

    let directFromToken: string | null = null;
    let directToToken: string | null = null;
    let directAmount: string | null = null;

    // Try to match the swap pattern
    const match = promptText.match(basicSwapRegex) || promptText.match(advancedSwapRegex);
    if (match && match.length >= 4) {
      directAmount = match[1];
      directFromToken = match[2].toUpperCase();
      directToToken = match[3].toUpperCase();
      elizaLogger.debug(
        `Directly extracted from prompt - Amount: ${directAmount}, From: ${directFromToken}, To: ${directToToken}`
      );
    }

    // Check for common token mentions
    const tokenMentions: Record<string, boolean> = {};
    const commonTokens = [
      'USDT',
      'USDC',
      'BNB',
      'ETH',
      'BTC',
      'BUSD',
      'DAI',
      'WETC',
      'WBNB',
      'TRON',
      'LINK',
      'OM',
      'UNI',
      'PEPE',
      'AAVE',
      'ATOM',
    ];

    for (const token of commonTokens) {
      // Check for case-insensitive mention, but as whole word
      const regex = new RegExp(`\\b${token}\\b`, 'i');
      if (regex.test(promptText)) {
        tokenMentions[token] = true;
        elizaLogger.debug(`Detected token in prompt: ${token}`);
      }
    }

    // Store prompt analysis results
    const promptAnalysis = {
      directFromToken,
      directToToken,
      directAmount,
      tokenMentions,
    };

    elizaLogger.debug('Prompt analysis result:', promptAnalysis);

    // Update state with recent messages
    let currentState = await runtime.composeState(message, ['RECENT_MESSAGES']);

    state.walletInfo = await bnbWalletProvider.get(runtime, message, currentState);

    // Compose swap prompt
    const swapPrompt = composePromptFromState({
      state: currentState,
      template: swapTemplate,
    });
    const result = await runtime.useModel(ModelType.TEXT_LARGE, {
      prompt: swapPrompt,
    });
    const content = parseKeyValueXml(result);

    // Validate content
    if (!isSwapContent(runtime, content)) {
      elizaLogger.error('Invalid content for swap action.');
      callback?.({
        text: 'Unable to process swap request. Invalid content provided.',
        content: { error: 'Invalid content' },
      });
      return false;
    }

    elizaLogger.debug('Generated swap content:', JSON.stringify(content, null, 2));

    // Validate and normalize chain
    let chain = (content.chain?.toLowerCase() || 'bsc') as SupportedChain;
    elizaLogger.debug(`Chain parameter: ${chain}`);

    // PRIORITY ORDER FOR TOKEN DETERMINATION:
    // 1. Direct match from prompt text (most reliable)
    // 2. Tokens specified in model-generated content
    // 3. Fallback based on token mentions

    // Determine input token (from token)
    let fromToken: string;
    if (directFromToken) {
      fromToken = directFromToken;
      elizaLogger.debug(`Using from token directly extracted from prompt: ${fromToken}`);
    } else if (content.inputToken) {
      fromToken = content.inputToken;
      elizaLogger.debug(`Using from token from generated content: ${fromToken}`);
    } else if (tokenMentions['BNB']) {
      fromToken = 'BNB';
      elizaLogger.debug(`Defaulting to BNB as from token based on mention`);
    } else {
      fromToken = 'BNB'; // Default
      elizaLogger.debug(`No from token detected, defaulting to BNB`);
    }

    // Determine output token (to token)
    let toToken: string = 'USDC'; // Default initialization
    if (directToToken) {
      toToken = directToToken;
      elizaLogger.debug(`Using to token directly extracted from prompt: ${toToken}`);
    } else if (content.outputToken) {
      toToken = content.outputToken;
      elizaLogger.debug(`Using to token from generated content: ${toToken}`);
    } else {
      // Select a token different from fromToken
      let tokenFound = false;
      for (const token of ['USDC', 'USDT', 'BUSD']) {
        if (token !== fromToken && tokenMentions[token]) {
          toToken = token;
          elizaLogger.debug(`Using ${token} as to token based on mention`);
          tokenFound = true;
          break;
        }
      }

      if (!tokenFound) {
        toToken = fromToken === 'BNB' ? 'USDC' : 'BNB';
        elizaLogger.debug(`No to token detected, defaulting to ${toToken}`);
      }
    }

    // Determine amount
    let amount: string;
    if (directAmount) {
      amount = directAmount;
      elizaLogger.debug(`Using amount directly extracted from prompt: ${amount}`);
    } else if (content.amount) {
      amount = content.amount;
      elizaLogger.debug(`Using amount from generated content: ${amount}`);
    } else {
      amount = '0.001'; // Default small amount
      elizaLogger.debug(`No amount detected, defaulting to ${amount}`);
    }

    // Validate slippage
    let slippage = content.slippage;
    if (typeof slippage !== 'number' || slippage <= 0 || slippage > 1) {
      slippage = 0.05; // Default 5%
      elizaLogger.debug(`Invalid or missing slippage, using default: ${slippage}`);
    } else {
      elizaLogger.debug(`Using slippage from content: ${slippage}`);
    }

    const swapOptions: SwapParams = {
      chain: chain,
      fromToken: fromToken,
      toToken: toToken,
      amount: amount,
      slippage: slippage,
    };

    elizaLogger.debug('Final swap options:', JSON.stringify(swapOptions, null, 2));

    try {
      const walletProvider = initWalletProvider(runtime);
      const action = new SwapAction(walletProvider);

      elizaLogger.debug('Calling swap with params:', JSON.stringify(swapOptions, null, 2));
      const swapResp = await action.swap(swapOptions);
      callback?.({
        text: `Successfully swapped ${swapResp.amount} ${swapResp.fromToken} to ${swapResp.toToken}\nTransaction Hash: ${swapResp.txHash}`,
        content: { ...swapResp },
      });
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      elizaLogger.error('Error during swap:', errorMsg);

      // Log the entire error object for diagnosis
      try {
        elizaLogger.error('Full error details:', JSON.stringify(error, null, 2));
      } catch (e) {
        elizaLogger.error('Error object not serializable, logging properties individually:');
        if (error && typeof error === 'object') {
          for (const key in error) {
            try {
              elizaLogger.error(`${key}:`, (error as any)[key]);
            } catch (e) {
              elizaLogger.error(`${key}: [Error serializing property]`);
            }
          }
        }
      }

      // Provide more user-friendly error messages
      let errorMessage = errorMsg;

      if (errorMsg.includes('No routes found')) {
        errorMessage = `No swap route found from ${swapOptions.fromToken} to ${swapOptions.toToken}. Please check that both tokens exist and have liquidity.`;
      } else if (errorMsg.includes('insufficient funds')) {
        errorMessage = `Insufficient funds for the swap. Please check your balance and try with a smaller amount.`;
      } else if (errorMsg.includes('high slippage')) {
        errorMessage = `Swap failed due to high price impact. Try reducing the amount or using a different token pair.`;
      }

      callback?.({
        text: `Swap failed: ${errorMessage}`,
        content: {
          error: errorMessage,
          fromToken: swapOptions.fromToken,
          toToken: swapOptions.toToken,
        },
      });
      return false;
    }
  },
  template: swapTemplate,
  validate: async (runtime: IAgentRuntime) => {
    const privateKey = runtime.getSetting('BNB_PRIVATE_KEY');
    return typeof privateKey === 'string' && privateKey.startsWith('0x');
  },
  examples: [
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Swap 0.001 BNB for USDC on BSC',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: "I'll help you swap 0.001 BNB for USDC on BSC",
          action: 'SWAP',
          content: {
            chain: 'bsc',
            inputToken: 'BNB',
            outputToken: 'USDC',
            amount: '0.001',
            slippage: undefined,
          },
        },
      },
    ],
    [
      {
        name: '{{user1}}',
        content: {
          text: 'Buy some token of 0x1234 using 0.001 USDC on BSC. The slippage should be no more than 5%',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: "I'll help you swap 0.001 USDC for token 0x1234 on BSC",
          action: 'SWAP',
          content: {
            chain: 'bsc',
            inputToken: 'USDC',
            outputToken: '0x1234',
            amount: '0.001',
            slippage: 0.05,
          },
        },
      },
    ],
  ],
  similes: ['SWAP', 'TOKEN_SWAP', 'EXCHANGE_TOKENS', 'TRADE_TOKENS'],
};

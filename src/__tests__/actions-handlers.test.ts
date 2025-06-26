import { describe, expect, it, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import { setupActionTest, mockLogger } from './test-utils';
import type { MockRuntime } from './test-utils';
import {
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  ModelType,
} from '@elizaos/core';

// Import all actions
import { getBalanceAction } from '../actions/getBalance';
import { getBalanceTestnetAction } from '../actions/getBalanceTestnet';
import { transferAction } from '../actions/transfer';
import { swapAction } from '../actions/swap';
import { bridgeAction } from '../actions/bridge';
import { stakeAction } from '../actions/stake';
import { faucetAction } from '../actions/faucet';
import { deployAction } from '../actions/deploy';
import { greenfieldAction } from '../actions/gnfd';

// Mock the wallet provider
import * as walletProviderModule from '../providers/wallet';

describe('BNB Plugin Action Handlers', () => {
  beforeEach(() => {
    mockLogger();
    
    // Mock bnbWalletProvider
    spyOn(walletProviderModule.bnbWalletProvider, 'get').mockResolvedValue({
      text: 'BNB chain Wallet Address: 0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d',
      values: {
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d',
        balance: '1.0',
        chainId: 56,
        chainName: 'BSC Mainnet',
        nativeCurrency: 'BNB',
      },
    });
  });

  afterEach(() => {
    mock.restore();
  });

  describe('getBalanceAction handler', () => {
    let mockRuntime: MockRuntime;
    let mockMessage: Partial<Memory>;
    let mockState: State;
    let callbackFn: HandlerCallback;

    beforeEach(() => {
      const setup = setupActionTest();
      mockRuntime = setup.mockRuntime;
      mockMessage = setup.mockMessage;
      mockState = setup.mockState;
      callbackFn = setup.callbackFn as HandlerCallback;
    });

    it('should handle successful balance request for native token', async () => {
      // Mock the wallet provider initialization
      const mockWalletProvider = {
        getAddress: mock().mockReturnValue('0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d'),
        getBalance: mock().mockResolvedValue('1.5'),
        switchChain: mock(),
        getChainConfigs: mock().mockReturnValue({
          id: 56,
          name: 'BSC Mainnet',
          nativeCurrency: { symbol: 'BNB' },
        }),
        getPublicClient: mock().mockReturnValue({
          getBalance: mock().mockResolvedValue(BigInt('1500000000000000000')),
        }),
      };

      spyOn(walletProviderModule, 'initWalletProvider').mockReturnValue(mockWalletProvider as any);

      // Mock the useModel response
      mockRuntime.useModel.mockResolvedValue(`
        <response>
          <chain>bsc</chain>
          <address>0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d</address>
          <token>BNB</token>
        </response>
      `);

      mockMessage.content = {
        text: 'Check my balance of BNB',
        channelType: 'direct',
        source: 'direct',
      };

      const result = await getBalanceAction.handler(
        mockRuntime as IAgentRuntime,
        mockMessage as Memory,
        mockState,
        {},
        callbackFn
      );

      expect(result).toBe(true);
      expect(mockRuntime.useModel).toHaveBeenCalled();
      expect(callbackFn).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Balance of'),
          content: expect.objectContaining({
            chain: 'bsc',
            address: expect.any(String),
            balance: expect.objectContaining({
              token: 'BNB',
              amount: expect.any(String),
            }),
          }),
        })
      );
    });

    it('should handle balance request errors gracefully', async () => {
      // Mock wallet provider to throw an error
      spyOn(walletProviderModule, 'initWalletProvider').mockImplementation(() => {
        throw new Error('BNB_PRIVATE_KEY is missing');
      });

      mockRuntime.useModel.mockResolvedValue(`
        <response>
          <chain>bsc</chain>
          <token>USDT</token>
        </response>
      `);

      mockMessage.content = {
        text: 'Check my balance',
        channelType: 'direct',
        source: 'direct',
      };

      const result = await getBalanceAction.handler(
        mockRuntime as IAgentRuntime,
        mockMessage as Memory,
        mockState,
        {},
        callbackFn
      );

      expect(result).toBe(false);
      expect(callbackFn).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('failed'),
          content: expect.objectContaining({
            error: expect.any(String),
          }),
        })
      );
    });

    it('should handle invalid content gracefully', async () => {
      // Mock useModel to return invalid XML
      mockRuntime.useModel.mockResolvedValue('invalid response');

      const result = await getBalanceAction.handler(
        mockRuntime as IAgentRuntime,
        mockMessage as Memory,
        mockState,
        {},
        callbackFn
      );

      expect(result).toBe(false);
      expect(callbackFn).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Unable to process balance request'),
          content: expect.objectContaining({
            error: 'Invalid content',
          }),
        })
      );
    });
  });

  describe('transferAction handler', () => {
    let mockRuntime: MockRuntime;
    let mockMessage: Partial<Memory>;
    let mockState: State;
    let callbackFn: HandlerCallback;

    beforeEach(() => {
      const setup = setupActionTest();
      mockRuntime = setup.mockRuntime;
      mockMessage = setup.mockMessage;
      mockState = setup.mockState;
      callbackFn = setup.callbackFn as HandlerCallback;
    });

    it('should handle successful transfer', async () => {
      const mockWalletProvider = {
        chains: {
          bsc: {
            id: 56,
            name: 'BSC Mainnet',
            nativeCurrency: { symbol: 'BNB' },
          },
        },
        getAddress: mock().mockReturnValue('0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d'),
        switchChain: mock(),
        transfer: mock().mockResolvedValue('0xtxhash123'),
        transferERC20: mock().mockResolvedValue('0xtxhash456'),
        getChainConfigs: mock().mockReturnValue({
          id: 56,
          name: 'BSC Mainnet',
          nativeCurrency: { symbol: 'BNB' },
        }),
        getPublicClient: mock().mockReturnValue({
          getBalance: mock().mockResolvedValue(BigInt('1500000000000000000')),
          readContract: mock()
            .mockResolvedValueOnce(BigInt('1000000000000000000')) // balance
            .mockResolvedValueOnce(18), // decimals
          waitForTransactionReceipt: mock().mockResolvedValue({}),
        }),
        formatAddress: mock().mockImplementation((addr) => Promise.resolve(addr)),
      };

      spyOn(walletProviderModule, 'initWalletProvider').mockReturnValue(mockWalletProvider as any);

      mockRuntime.useModel.mockResolvedValue(`
        <response>
          <chain>bsc</chain>
          <amount>0.1</amount>
          <toAddress>0x1234567890123456789012345678901234567890</toAddress>
          <token>BNB</token>
        </response>
      `);

      mockMessage.content = {
        ...mockMessage.content,
        text: 'Transfer 0.1 BNB to 0x1234567890123456789012345678901234567890',
        channelType: 'direct',
        source: 'direct',
      };

      const result = await transferAction.handler(
        mockRuntime as IAgentRuntime,
        mockMessage as Memory,
        mockState,
        {},
        callbackFn
      );

      expect(result).toBe(true);
      expect(callbackFn).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Successfully transferred'),
          content: expect.objectContaining({
            chain: 'bsc',
            txHash: expect.any(String),
            recipient: expect.any(String),
            amount: expect.any(String),
            token: expect.any(String),
          }),
        })
      );
    });

    it('should handle transfer errors', async () => {
      spyOn(walletProviderModule, 'initWalletProvider').mockImplementation(() => {
        throw new Error('Wallet initialization failed');
      });

      mockRuntime.useModel.mockResolvedValue(`
        <response>
          <chain>bsc</chain>
          <amount>0.1</amount>
          <toAddress>0x1234567890123456789012345678901234567890</toAddress>
          <token>BNB</token>
        </response>
      `);

      const result = await transferAction.handler(
        mockRuntime as IAgentRuntime,
        mockMessage as Memory,
        mockState,
        {},
        callbackFn
      );

      expect(result).toBe(false);
      expect(callbackFn).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Transfer failed'),
          content: expect.objectContaining({
            error: expect.any(String),
          }),
        })
      );
    });
  });

  describe('swapAction handler', () => {
    let mockRuntime: MockRuntime;
    let mockMessage: Partial<Memory>;
    let mockState: State;
    let callbackFn: HandlerCallback;

    beforeEach(() => {
      const setup = setupActionTest();
      mockRuntime = setup.mockRuntime;
      mockMessage = setup.mockMessage;
      mockState = setup.mockState;
      callbackFn = setup.callbackFn as HandlerCallback;
    });

    it('should handle successful swap', async () => {
      const mockWalletProvider = {
        getAddress: mock().mockReturnValue('0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d'),
        switchChain: mock(),
        getChainConfigs: mock().mockReturnValue({
          id: 56,
          name: 'BSC Mainnet',
        }),
        configureLiFiSdk: mock(),
        getTokenAddress: mock().mockImplementation((chain, token) => {
          // Mock token address resolution
          if (token === 'BNB') return '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
          if (token === 'USDT') return '0x55d398326f99059fF775485246999027B3197955';
          return '0x0000000000000000000000000000000000000000';
        }),
      };

      spyOn(walletProviderModule, 'initWalletProvider').mockReturnValue(mockWalletProvider as any);

      // Mock the lifi SDK functions
      const lifiSdk = await import('@lifi/sdk');
      spyOn(lifiSdk, 'getRoutes').mockResolvedValue({
        routes: [
          {
            steps: [
              {
                execution: {
                  process: [
                    {
                      status: 'DONE',
                      txHash: '0xtxhash123',
                    },
                  ],
                },
              },
            ],
          },
        ],
      } as any);
      
      spyOn(lifiSdk, 'executeRoute').mockResolvedValue({
        steps: [
          {
            execution: {
              process: [
                {
                  status: 'DONE',
                  txHash: '0xtxhash123',
                },
              ],
            },
          },
        ],
      } as any);

      mockRuntime.useModel.mockResolvedValue(`
        <response>
          <chain>bsc</chain>
          <inputToken>BNB</inputToken>
          <outputToken>USDT</outputToken>
          <amount>0.1</amount>
        </response>
      `);

      mockMessage.content = {
        ...mockMessage.content,
        text: 'Swap 0.1 BNB to USDT',
        channelType: 'direct',
        source: 'direct',
      };

      const result = await swapAction.handler(
        mockRuntime as IAgentRuntime,
        mockMessage as Memory,
        mockState,
        {},
        callbackFn
      );

      expect(result).toBe(true);
      expect(callbackFn).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Successfully swapped'),
          content: expect.objectContaining({
            chain: 'bsc',
            txHash: expect.any(String),
            fromToken: 'BNB',
            toToken: 'USDT',
            amount: '0.1',
          }),
        })
      );
    });
  });

  describe('stakeAction handler', () => {
    let mockRuntime: MockRuntime;
    let mockMessage: Partial<Memory>;
    let mockState: State;
    let callbackFn: HandlerCallback;

    beforeEach(() => {
      const setup = setupActionTest();
      mockRuntime = setup.mockRuntime;
      mockMessage = setup.mockMessage;
      mockState = setup.mockState;
      callbackFn = setup.callbackFn as HandlerCallback;
    });

    it('should handle stake operation', async () => {
      const mockWalletProvider = {
        chains: {
          bsc: {
            id: 56,
            name: 'BSC Mainnet',
            nativeCurrency: { symbol: 'BNB' },
          },
        },
        getAddress: mock().mockReturnValue('0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d'),
        getAccount: mock().mockReturnValue({
          address: '0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d',
        }),
        switchChain: mock(),
        getWalletClient: mock().mockReturnValue({
          account: {
            address: '0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d',
          },
          writeContract: mock().mockResolvedValue('0xtxhash'),
        }),
        getPublicClient: mock().mockReturnValue({
          simulateContract: mock().mockResolvedValue({ request: {} }),
          waitForTransactionReceipt: mock().mockResolvedValue({}),
          readContract: mock().mockResolvedValue(BigInt('1000000000000000000')), // slisBNB balance
        }),
      };

      spyOn(walletProviderModule, 'initWalletProvider').mockReturnValue(mockWalletProvider as any);

      mockRuntime.useModel.mockResolvedValue(`
        <response>
          <chain>bsc</chain>
          <action>deposit</action>
          <amount>10</amount>
        </response>
      `);

      mockMessage.content = {
        ...mockMessage.content,
        text: 'Stake 10 BNB',
        channelType: 'direct',
        source: 'direct',
      };

      const result = await stakeAction.handler(
        mockRuntime as IAgentRuntime,
        mockMessage as Memory,
        mockState,
        {},
        callbackFn
      );

      expect(result).toBe(true);
      expect(callbackFn).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Successfully do'),
          content: expect.objectContaining({
            response: expect.any(String),
          }),
        })
      );
    });
  });

  describe('Error handling across all actions', () => {
    it('should handle network errors gracefully', async () => {
      const setup = setupActionTest();
      const mockRuntime = setup.mockRuntime;
      const mockMessage = setup.mockMessage;
      const mockState = setup.mockState;
      const callbackFn = setup.callbackFn as HandlerCallback;

      // Mock network error
      spyOn(walletProviderModule, 'initWalletProvider').mockImplementation(() => {
        throw new Error('Network connection failed');
      });

      mockRuntime.useModel.mockResolvedValue(`
        <response>
          <chain>bsc</chain>
          <token>BNB</token>
        </response>
      `);

      const result = await getBalanceAction.handler(
        mockRuntime as IAgentRuntime,
        mockMessage as Memory,
        mockState,
        {},
        callbackFn
      );

      expect(result).toBe(false);
      expect(callbackFn).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('failed'),
          content: expect.objectContaining({
            error: expect.stringContaining('Network'),
          }),
        })
      );
    });

    it('should handle invalid addresses gracefully', async () => {
      const setup = setupActionTest();
      const mockRuntime = setup.mockRuntime;
      const mockMessage = setup.mockMessage;
      const mockState = setup.mockState;
      const callbackFn = setup.callbackFn as HandlerCallback;

      const mockWalletProvider = {
        getAddress: mock().mockReturnValue('0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d'),
        formatAddress: mock().mockImplementation(() => {
          throw new Error('Invalid address format');
        }),
      };

      spyOn(walletProviderModule, 'initWalletProvider').mockReturnValue(mockWalletProvider as any);

      mockRuntime.useModel.mockResolvedValue(`
        <response>
          <chain>bsc</chain>
          <amount>0.1</amount>
          <toAddress>invalid-address</toAddress>
          <token>BNB</token>
        </response>
      `);

      const result = await transferAction.handler(
        mockRuntime as IAgentRuntime,
        mockMessage as Memory,
        mockState,
        {},
        callbackFn
      );

      expect(result).toBe(false);
      expect(callbackFn).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('failed'),
        })
      );
    });
  });
});

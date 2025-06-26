import { describe, expect, it, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import { setupActionTest, mockLogger } from './test-utils';
import type { MockRuntime } from './test-utils';
import { type IAgentRuntime, type Memory, type State, type HandlerCallback } from '@elizaos/core';

// Import actions for edge case testing
import { getBalanceAction } from '../actions/getBalance';
import { transferAction } from '../actions/transfer';
import { swapAction } from '../actions/swap';

// Mock the wallet provider
import * as walletProviderModule from '../providers/wallet';

describe('BNB Plugin Edge Cases', () => {
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

  describe('Edge cases for getBalance', () => {
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

    it('should handle empty token field (default to native token)', async () => {
      const mockWalletProvider = {
        getAddress: mock().mockReturnValue('0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d'),
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

      mockRuntime.useModel.mockResolvedValue(`
        <response>
          <chain>bsc</chain>
          <address>0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d</address>
          <token></token>
        </response>
      `);

      const result = await getBalanceAction.handler(
        mockRuntime as IAgentRuntime,
        mockMessage as Memory,
        mockState,
        {},
        callbackFn
      );

      expect(result).toBe(true);
      expect(callbackFn).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            balance: expect.objectContaining({
              token: 'BNB',
            }),
          }),
        })
      );
    });

    it('should handle null address (use wallet address)', async () => {
      const mockWalletProvider = {
        getAddress: mock().mockReturnValue('0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d'),
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

      mockRuntime.useModel.mockResolvedValue(`
        <response>
          <chain>bsc</chain>
          <address>null</address>
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

      expect(result).toBe(true);
      expect(callbackFn).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            address: '0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d',
          }),
        })
      );
    });

    it('should handle token symbol that looks like an address', async () => {
      const mockWalletProvider = {
        getAddress: mock().mockReturnValue('0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d'),
        switchChain: mock(),
        getChainConfigs: mock().mockReturnValue({
          id: 56,
          name: 'BSC Mainnet',
          nativeCurrency: { symbol: 'BNB' },
        }),
        getPublicClient: mock().mockReturnValue({
          readContract: mock()
            .mockResolvedValueOnce(BigInt('1000000000000000000')) // balance
            .mockResolvedValueOnce(18), // decimals
        }),
      };

      spyOn(walletProviderModule, 'initWalletProvider').mockReturnValue(mockWalletProvider as any);

      mockRuntime.useModel.mockResolvedValue(`
        <response>
          <chain>bsc</chain>
          <token>0x55d398326f99059fF775485246999027B3197955</token>
        </response>
      `);

      const result = await getBalanceAction.handler(
        mockRuntime as IAgentRuntime,
        mockMessage as Memory,
        mockState,
        {},
        callbackFn
      );

      expect(result).toBe(true);
      expect(callbackFn).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            balance: expect.objectContaining({
              token: '0x55d398326f99059fF775485246999027B3197955',
              amount: expect.any(String),
            }),
          }),
        })
      );
    });
  });

  describe('Edge cases for transfer', () => {
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

    it('should handle very small amounts', async () => {
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
        getChainConfigs: mock().mockReturnValue({
          id: 56,
          name: 'BSC Mainnet',
          nativeCurrency: { symbol: 'BNB' },
        }),
        getPublicClient: mock().mockReturnValue({
          waitForTransactionReceipt: mock().mockResolvedValue({}),
        }),
        formatAddress: mock().mockResolvedValue('0x1234567890123456789012345678901234567890'),
      };

      spyOn(walletProviderModule, 'initWalletProvider').mockReturnValue(mockWalletProvider as any);

      mockRuntime.useModel.mockResolvedValue(`
        <response>
          <chain>bsc</chain>
          <amount>0.000000001</amount>
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

      expect(result).toBe(true);
      expect(mockWalletProvider.transfer).toHaveBeenCalledWith(
        'bsc',
        '0x1234567890123456789012345678901234567890',
        BigInt('1000000000'), // 0.000000001 * 10^18
        expect.any(Object)
      );
    });

    it('should handle zero amount gracefully', async () => {
      const mockWalletProvider = {
        getAddress: mock().mockReturnValue('0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d'),
        switchChain: mock(),
        formatAddress: mock().mockResolvedValue('0x1234567890123456789012345678901234567890'),
      };

      spyOn(walletProviderModule, 'initWalletProvider').mockReturnValue(mockWalletProvider as any);

      mockRuntime.useModel.mockResolvedValue(`
        <response>
          <chain>bsc</chain>
          <amount>0</amount>
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

    it('should handle self-transfer', async () => {
      const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d';
      const mockWalletProvider = {
        chains: {
          bsc: {
            id: 56,
            name: 'BSC Mainnet',
            nativeCurrency: { symbol: 'BNB' },
          },
        },
        getAddress: mock().mockReturnValue(walletAddress),
        switchChain: mock(),
        transfer: mock().mockResolvedValue('0xtxhash123'),
        formatAddress: mock().mockResolvedValue(walletAddress),
        getChainConfigs: mock().mockReturnValue({
          id: 56,
          name: 'BSC Mainnet',
          nativeCurrency: { symbol: 'BNB' },
        }),
        getPublicClient: mock().mockReturnValue({
          waitForTransactionReceipt: mock().mockResolvedValue({}),
        }),
      };

      spyOn(walletProviderModule, 'initWalletProvider').mockReturnValue(mockWalletProvider as any);

      mockRuntime.useModel.mockResolvedValue(`
        <response>
          <chain>bsc</chain>
          <amount>0.1</amount>
          <toAddress>${walletAddress}</toAddress>
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

      // Should still process the transfer (some users might want to test or have reasons)
      expect(result).toBe(true);
      expect(mockWalletProvider.transfer).toHaveBeenCalled();
    });
  });

  describe('Edge cases for swap', () => {
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

    it('should handle same token swap (should fail)', async () => {
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

      mockRuntime.useModel.mockResolvedValue(`
        <response>
          <chain>bsc</chain>
          <inputToken>USDT</inputToken>
          <outputToken>USDT</outputToken>
          <amount>100</amount>
        </response>
      `);

      const result = await swapAction.handler(
        mockRuntime as IAgentRuntime,
        mockMessage as Memory,
        mockState,
        {},
        callbackFn
      );

      expect(result).toBe(false);
      
      expect(callbackFn).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Swap failed'),
          content: expect.objectContaining({
            error: expect.stringContaining('Cannot swap from and to the same token'),
            fromToken: 'USDT',
            toToken: 'USDT',
          }),
        })
      );
    });

    it('should handle missing chain information', async () => {
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

      // Mock invalid XML response
      mockRuntime.useModel.mockResolvedValue(`
        <response>
          <fromToken>BNB</fromToken>
          <toToken>USDT</toToken>
          <amount>0.1</amount>
        </response>
      `);

      const result = await swapAction.handler(
        mockRuntime as IAgentRuntime,
        mockMessage as Memory,
        mockState,
        {},
        callbackFn
      );

      // Without chain info, the swap should still work with default chain (bsc)
      expect(result).toBe(false);
      expect(callbackFn).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Unable to process swap request'),
          content: expect.objectContaining({
            error: 'Invalid content',
          }),
        })
      );
    });
  });

  describe('Chain validation edge cases', () => {
    it('should handle unsupported chain gracefully', async () => {
      const setup = setupActionTest();
      const mockRuntime = setup.mockRuntime;
      const mockMessage = setup.mockMessage;
      const mockState = setup.mockState;
      const callbackFn = setup.callbackFn as HandlerCallback;

      const mockWalletProvider = {
        getAddress: mock().mockReturnValue('0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d'),
        switchChain: mock().mockImplementation(() => {
          throw new Error('Unsupported chain: polygon');
        }),
      };

      spyOn(walletProviderModule, 'initWalletProvider').mockReturnValue(mockWalletProvider as any);

      mockRuntime.useModel.mockResolvedValue(`
        <response>
          <chain>polygon</chain>
          <token>MATIC</token>
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
            error: expect.stringContaining('Unsupported chain'),
          }),
        })
      );
    });
  });

  describe('Concurrent request handling', () => {
    it('should handle multiple balance requests concurrently', async () => {
      const setup = setupActionTest();
      const mockRuntime = setup.mockRuntime;
      const mockState = setup.mockState;

      const mockWalletProvider = {
        getAddress: mock().mockReturnValue('0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d'),
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

      mockRuntime.useModel.mockResolvedValue(`
        <response>
          <chain>bsc</chain>
          <token>BNB</token>
        </response>
      `);

      // Execute multiple requests concurrently
      const promises = Array(5)
        .fill(null)
        .map(() =>
          getBalanceAction.handler(
            mockRuntime as IAgentRuntime,
            { content: { text: 'Check balance' } } as Memory,
            mockState,
            {},
            mock() as HandlerCallback
          )
        );

      const results = await Promise.all(promises);

      // All should succeed
      expect(results.every((r) => r === true)).toBe(true);
      expect(mockWalletProvider.switchChain).toHaveBeenCalledTimes(5);
    });
  });
});

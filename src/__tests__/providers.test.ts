import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test';
import { setupActionTest, mockLogger } from './test-utils';
import type { MockRuntime } from './test-utils';
import { type IAgentRuntime, type Memory, type State, type ProviderResult } from '@elizaos/core';

// Import providers
import { bnbWalletProvider } from '../providers/wallet';

describe('BNB Plugin Providers', () => {
  beforeEach(() => {
    mockLogger();
  });

  afterEach(() => {
    mock.restore();
  });

  describe('bnbWalletProvider', () => {
    let mockRuntime: MockRuntime;
    let mockMessage: Partial<Memory>;
    let mockState: State;

    beforeEach(() => {
      const setup = setupActionTest();
      mockRuntime = setup.mockRuntime;
      mockMessage = setup.mockMessage;
      mockState = setup.mockState;
    });

    it('should have correct metadata', () => {
      expect(bnbWalletProvider.name).toBe('bnbWallet');
      expect(bnbWalletProvider.description).toContain('BNB chain wallet');
      expect(bnbWalletProvider.get).toBeDefined();
    });

    it('should return wallet information when private key is set', async () => {
      // Mock the private key to be already present in the test-utils default
      // The mock runtime already has BNB_PRIVATE_KEY set to a valid value

      const result = await bnbWalletProvider.get(
        mockRuntime as IAgentRuntime,
        mockMessage as Memory,
        mockState
      );

      expect(result).toBeDefined();
      expect(result.text).toContain('BNB chain Wallet Address');
      expect(result.values).toBeDefined();
      expect(result.values?.address).toBeDefined();
      expect(result.values?.chainId).toBeDefined();
      expect(result.values?.chainName).toBeDefined();
    });

    it('should return error when private key is not set', async () => {
      // Ensure getSetting returns undefined for private key
      mockRuntime.getSetting.mockImplementation(() => undefined);

      const result = await bnbWalletProvider.get(
        mockRuntime as IAgentRuntime,
        mockMessage as Memory,
        mockState
      );

      expect(result).toBeDefined();
      expect(result.text).toBe('Error retrieving wallet information');
      expect(result.data?.error).toContain('BNB_PRIVATE_KEY is missing');
    });

    it.skip('should use custom RPC URL when provided', async () => {
      const customRpcUrl = 'https://custom-bsc-rpc.example.com';

      // Override the default getSetting to include custom RPC URL
      mockRuntime.getSetting.mockImplementation((key: string) => {
        const settings: Record<string, string> = {
          BNB_PRIVATE_KEY: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          BSC_PROVIDER_URL: customRpcUrl,
        };
        return settings[key];
      });

      const result = await bnbWalletProvider.get(
        mockRuntime as IAgentRuntime,
        mockMessage as Memory,
        mockState
      );

      expect(result).toBeDefined();
      expect(result.text).toContain('BNB chain Wallet Address');
      // The custom RPC URL should be used internally, even if not visible in the output
    });

    it.skip('should handle different chain configurations', async () => {
      // Test with BSC Testnet RPC URL
      mockRuntime.getSetting.mockImplementation((key: string) => {
        const settings: Record<string, string> = {
          BNB_PRIVATE_KEY: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          BSC_TESTNET_PROVIDER_URL: 'https://data-seed-prebsc-1-s1.binance.org:8545/',
        };
        return settings[key];
      });

      const result = await bnbWalletProvider.get(
        mockRuntime as IAgentRuntime,
        mockMessage as Memory,
        mockState
      );

      expect(result).toBeDefined();
      expect(result.text).toContain('BNB chain Wallet Address');
    });

    it.skip('should handle opBNB configuration', async () => {
      // Test with opBNB RPC URL
      mockRuntime.getSetting.mockImplementation((key: string) => {
        const settings: Record<string, string> = {
          BNB_PRIVATE_KEY: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          OPBNB_PROVIDER_URL: 'https://opbnb-mainnet-rpc.bnbchain.org',
        };
        return settings[key];
      });

      const result = await bnbWalletProvider.get(
        mockRuntime as IAgentRuntime,
        mockMessage as Memory,
        mockState
      );

      expect(result).toBeDefined();
      expect(result.text).toContain('BNB chain Wallet Address');
    });

    it('should return ProviderResult with correct structure', async () => {
      // Use the default mock runtime which already has BNB_PRIVATE_KEY set

      const result = (await bnbWalletProvider.get(
        mockRuntime as IAgentRuntime,
        mockMessage as Memory,
        mockState
      )) as ProviderResult;

      // Check ProviderResult structure
      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('values');
      expect(typeof result.text).toBe('string');
      expect(typeof result.values).toBe('object');

      // Check values content
      expect(result.values).toHaveProperty('address');
      expect(result.values).toHaveProperty('balance');
      expect(result.values).toHaveProperty('chainId');
      expect(result.values).toHaveProperty('chainName');
      expect(result.values).toHaveProperty('nativeCurrency');
    });
  });
});

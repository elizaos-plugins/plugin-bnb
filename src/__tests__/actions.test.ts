import { describe, expect, it, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import { setupActionTest, mockLogger, createMockState } from './test-utils';
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

describe('BNB Plugin Actions', () => {
  beforeEach(() => {
    mockLogger();
  });

  afterEach(() => {
    mock.restore();
  });

  describe('getBalanceAction', () => {
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

    it('should have correct metadata', () => {
      expect(getBalanceAction.name).toBe('getBalance');
      expect(getBalanceAction.description).toContain('balance');
      expect(getBalanceAction.validate).toBeDefined();
      expect(getBalanceAction.handler).toBeDefined();
      expect(getBalanceAction.examples).toBeDefined();
    });

    it('should validate correctly', async () => {
      const isValid = await getBalanceAction.validate(mockRuntime as IAgentRuntime);
      expect(isValid).toBe(true);
    });

    it('should handle balance request', async () => {
      // Import wallet provider module and spy on it
      const walletProviderModule = await import('../providers/wallet');
      
      // Mock the wallet provider
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

      // Mock the provider to return wallet info properly
      mockRuntime.providers = [
        {
          name: 'bnbWallet',
          get: async () => ({
            text: 'BNB chain Wallet Address: 0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d',
            values: {
              address: '0x742d35Cc6634C0532925a3b844Bc9e7595f02D5d',
              balance: '1.0',
              chainId: 56,
              chainName: 'BSC Mainnet',
              nativeCurrency: 'BNB',
            },
          }),
        },
      ];

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
      expect(callbackFn).toHaveBeenCalled();

      // Verify the callback was called with balance information
      expect(callbackFn).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Balance of'),
          content: expect.objectContaining({
            chain: 'bsc',
            address: expect.any(String),
            balance: expect.any(Object),
          }),
        })
      );
    });
  });

  describe('transferAction', () => {
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

    it('should have correct metadata', () => {
      expect(transferAction.name).toBe('transfer');
      expect(transferAction.description).toContain('Transfer');
      expect(transferAction.validate).toBeDefined();
      expect(transferAction.handler).toBeDefined();
      expect(transferAction.examples).toBeDefined();
    });

    it('should validate correctly', async () => {
      const isValid = await transferAction.validate(mockRuntime as IAgentRuntime);
      expect(isValid).toBe(true);
    });
  });

  describe('swapAction', () => {
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

    it('should have correct metadata', () => {
      expect(swapAction.name).toBe('swap');
      expect(swapAction.description).toContain('Swap');
      expect(swapAction.validate).toBeDefined();
      expect(swapAction.handler).toBeDefined();
      expect(swapAction.examples).toBeDefined();
    });

    it('should validate correctly', async () => {
      const isValid = await swapAction.validate(mockRuntime as IAgentRuntime);
      expect(isValid).toBe(true);
    });
  });

  describe('bridgeAction', () => {
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

    it('should have correct metadata', () => {
      expect(bridgeAction.name).toBe('bridge');
      expect(bridgeAction.description).toContain('Bridge');
      expect(bridgeAction.validate).toBeDefined();
      expect(bridgeAction.handler).toBeDefined();
      expect(bridgeAction.examples).toBeDefined();
    });

    it('should validate correctly', async () => {
      const isValid = await bridgeAction.validate(mockRuntime as IAgentRuntime);
      expect(isValid).toBe(true);
    });
  });

  describe('stakeAction', () => {
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

    it('should have correct metadata', () => {
      expect(stakeAction.name).toBe('stake');
      expect(stakeAction.description).toContain('Stake related actions');
      expect(stakeAction.validate).toBeDefined();
      expect(stakeAction.handler).toBeDefined();
      expect(stakeAction.examples).toBeDefined();
    });

    it('should validate correctly', async () => {
      const isValid = await stakeAction.validate(mockRuntime as IAgentRuntime);
      expect(isValid).toBe(true);
    });
  });

  describe('faucetAction', () => {
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

    it('should have correct metadata', () => {
      expect(faucetAction.name).toBe('faucet');
      expect(faucetAction.description).toContain('faucet');
      expect(faucetAction.validate).toBeDefined();
      expect(faucetAction.handler).toBeDefined();
      expect(faucetAction.examples).toBeDefined();
    });

    it('should validate correctly', async () => {
      const isValid = await faucetAction.validate(mockRuntime as IAgentRuntime);
      expect(isValid).toBe(true);
    });
  });

  describe('deployAction', () => {
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

    it('should have correct metadata', () => {
      expect(deployAction.name).toBe('deploy_token');
      expect(deployAction.description).toContain('Deploy');
      expect(deployAction.validate).toBeDefined();
      expect(deployAction.handler).toBeDefined();
      expect(deployAction.examples).toBeDefined();
    });

    it('should validate correctly', async () => {
      const isValid = await deployAction.validate(mockRuntime as IAgentRuntime);
      expect(isValid).toBe(true);
    });
  });

  describe('greenfieldAction', () => {
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

    it('should have correct metadata', () => {
      expect(greenfieldAction.name).toBe('GREENFIELD_ACTION');
      expect(greenfieldAction.description).toContain('greenfield');
      expect(greenfieldAction.validate).toBeDefined();
      expect(greenfieldAction.handler).toBeDefined();
      expect(greenfieldAction.examples).toBeDefined();
    });

    it('should validate correctly', async () => {
      const isValid = await greenfieldAction.validate(mockRuntime as IAgentRuntime);
      expect(isValid).toBe(true);
    });
  });

  describe('getBalanceTestnetAction', () => {
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

    it('should have correct metadata', () => {
      expect(getBalanceTestnetAction.name).toBe('getBalanceTestnet');
      expect(getBalanceTestnetAction.description).toContain('testnet');
      expect(getBalanceTestnetAction.validate).toBeDefined();
      expect(getBalanceTestnetAction.handler).toBeDefined();
      expect(getBalanceTestnetAction.examples).toBeDefined();
    });

    it('should validate correctly', async () => {
      const isValid = await getBalanceTestnetAction.validate(mockRuntime as IAgentRuntime);
      expect(isValid).toBe(true);
    });
  });
});

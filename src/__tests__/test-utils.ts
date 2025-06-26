import { mock, spyOn } from 'bun:test';
import {
  type IAgentRuntime,
  type Memory,
  type State,
  type Character,
  type UUID,
  type Content,
  elizaLogger,
} from '@elizaos/core';

// Mock Runtime Type
export type MockRuntime = Partial<IAgentRuntime> & {
  agentId: UUID;
  character: Character;
  getSetting: ReturnType<typeof mock>;
  useModel: ReturnType<typeof mock>;
  composeState: ReturnType<typeof mock>;
  createMemory: ReturnType<typeof mock>;
  getMemories: ReturnType<typeof mock>;
  searchMemories: ReturnType<typeof mock>;
  updateMemory: ReturnType<typeof mock>;
  getRoom: ReturnType<typeof mock>;
  getParticipantUserState: ReturnType<typeof mock>;
  setParticipantUserState: ReturnType<typeof mock>;
  emitEvent: ReturnType<typeof mock>;
  getTasks: ReturnType<typeof mock>;
  providers: any[];
  actions: any[];
  evaluators: any[];
  services: Map<any, any>;
};

// Create Mock Runtime
export function createMockRuntime(overrides: Partial<MockRuntime> = {}): MockRuntime {
  return {
    agentId: 'test-agent-id' as UUID,
    character: {
      name: 'Test Agent',
      bio: 'A test agent for unit testing',
      templates: {
        messageHandlerTemplate: 'Test template {{recentMessages}}',
        shouldRespondTemplate: 'Should respond {{recentMessages}}',
      },
    } as Character,

    // Core methods with default implementations
    useModel: mock().mockResolvedValue('Mock response'),
    composeState: mock().mockResolvedValue({
      values: {
        agentName: 'Test Agent',
        recentMessages: 'Test message',
      },
      data: {
        room: {
          id: 'test-room-id',
          type: 'direct',
        },
      },
    }),
    createMemory: mock().mockResolvedValue({ id: 'memory-id' }),
    getMemories: mock().mockResolvedValue([]),
    searchMemories: mock().mockResolvedValue([]),
    updateMemory: mock().mockResolvedValue(undefined),
    getSetting: mock().mockImplementation((key: string) => {
      const settings: Record<string, string> = {
        TEST_SETTING: 'test-value',
        API_KEY: 'test-api-key',
        BNB_PRIVATE_KEY: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        BNB_PUBLIC_KEY: '0xabcdef1234567890abcdef1234567890abcdef12',
        BSC_PROVIDER_URL: 'https://bsc-dataseed.binance.org/',
        OPBNB_PROVIDER_URL: 'https://opbnb-mainnet-rpc.bnbchain.org',
      };
      return settings[key];
    }),
    getRoom: mock().mockResolvedValue({
      id: 'test-room-id',
      type: 'direct',
      worldId: 'test-world-id',
      serverId: 'test-server-id',
      source: 'test',
    }),
    getParticipantUserState: mock().mockResolvedValue('ACTIVE'),
    setParticipantUserState: mock().mockResolvedValue(undefined),
    emitEvent: mock().mockResolvedValue(undefined),
    getTasks: mock().mockResolvedValue([]),

    // Provider/action/evaluator lists
    providers: [],
    actions: [],
    evaluators: [],
    services: new Map(),

    // Override with custom implementations
    ...overrides,
  };
}

// Create Mock Memory
export function createMockMemory(overrides: Partial<Memory> = {}): Partial<Memory> {
  return {
    id: 'test-message-id' as UUID,
    roomId: 'test-room-id' as UUID,
    entityId: 'test-entity-id' as UUID,
    agentId: 'test-agent-id' as UUID,
    content: {
      text: 'Test message',
      channelType: 'direct',
      source: 'direct',
    } as Content,
    createdAt: Date.now(),
    ...overrides,
  };
}

// Create Mock State
export function createMockState(overrides: Partial<State> = {}): State {
  return {
    values: {
      agentName: 'Test Agent',
      recentMessages: 'User: Test message',
      ...overrides.values,
    },
    data: {
      room: {
        id: 'test-room-id',
        type: 'direct',
      },
      ...overrides.data,
    },
    ...overrides,
  } as State;
}

// Setup Action Test Helper
export function setupActionTest(
  options: {
    runtimeOverrides?: Partial<MockRuntime>;
    messageOverrides?: Partial<Memory>;
    stateOverrides?: Partial<State>;
  } = {}
) {
  const mockRuntime = createMockRuntime(options.runtimeOverrides);
  const mockMessage = createMockMemory(options.messageOverrides);
  const mockState = createMockState(options.stateOverrides);
  const callbackFn = mock();

  return {
    mockRuntime,
    mockMessage,
    mockState,
    callbackFn,
  };
}

// Mock Logger Helper
export function mockLogger() {
  spyOn(elizaLogger, 'error').mockImplementation(() => {});
  spyOn(elizaLogger, 'warn').mockImplementation(() => {});
  spyOn(elizaLogger, 'info').mockImplementation(() => {});
  spyOn(elizaLogger, 'debug').mockImplementation(() => {});
  spyOn(elizaLogger, 'log').mockImplementation(() => {});
}

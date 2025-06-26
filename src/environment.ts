import type { IAgentRuntime } from '@elizaos/core';
import { z } from 'zod';

// Default RPC URLs as fallbacks
const DEFAULT_BSC_PROVIDER_URL =
  'https://bsc-mainnet.nodereal.io/v1/64a9df0874fb4a93b9d0a3849de012d3';
const DEFAULT_BSC_TESTNET_PROVIDER_URL = 'https://data-seed-prebsc-2-s3.bnbchain.org:8545';
const DEFAULT_OPBNB_PROVIDER_URL = 'https://opbnb-mainnet-rpc.bnbchain.org';

export const bnbEnvSchema = z.object({
  BNB_PRIVATE_KEY: z.string().optional(),
  BNB_PUBLIC_KEY: z.string().optional(),
  BSC_PROVIDER_URL: z.string().default(DEFAULT_BSC_PROVIDER_URL),
  BSC_TESTNET_PROVIDER_URL: z.string().default(DEFAULT_BSC_TESTNET_PROVIDER_URL),
  OPBNB_PROVIDER_URL: z.string().default(DEFAULT_OPBNB_PROVIDER_URL),
});

export type BnbConfig = z.infer<typeof bnbEnvSchema>;

/**
 * Get configuration with defaults
 */
export function getConfig(): BnbConfig {
  return {
    BNB_PRIVATE_KEY: process.env.BNB_PRIVATE_KEY,
    BNB_PUBLIC_KEY: process.env.BNB_PUBLIC_KEY,
    BSC_PROVIDER_URL: process.env.BSC_PROVIDER_URL || DEFAULT_BSC_PROVIDER_URL,
    BSC_TESTNET_PROVIDER_URL:
      process.env.BSC_TESTNET_PROVIDER_URL || DEFAULT_BSC_TESTNET_PROVIDER_URL,
    OPBNB_PROVIDER_URL: process.env.OPBNB_PROVIDER_URL || DEFAULT_OPBNB_PROVIDER_URL,
  };
}

/**
 * Validate BNB configuration using runtime settings or environment variables
 */
export async function validateBnbConfig(runtime: IAgentRuntime): Promise<BnbConfig> {
  try {
    const config = {
      BNB_PRIVATE_KEY: runtime.getSetting('BNB_PRIVATE_KEY') || process.env.BNB_PRIVATE_KEY,
      BNB_PUBLIC_KEY: runtime.getSetting('BNB_PUBLIC_KEY') || process.env.BNB_PUBLIC_KEY,
      BSC_PROVIDER_URL:
        runtime.getSetting('BSC_PROVIDER_URL') ||
        process.env.BSC_PROVIDER_URL ||
        DEFAULT_BSC_PROVIDER_URL,
      BSC_TESTNET_PROVIDER_URL:
        runtime.getSetting('BSC_TESTNET_PROVIDER_URL') ||
        process.env.BSC_TESTNET_PROVIDER_URL ||
        DEFAULT_BSC_TESTNET_PROVIDER_URL,
      OPBNB_PROVIDER_URL:
        runtime.getSetting('OPBNB_PROVIDER_URL') ||
        process.env.OPBNB_PROVIDER_URL ||
        DEFAULT_OPBNB_PROVIDER_URL,
    };

    return bnbEnvSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join('\n');
      throw new Error(`BNB configuration validation failed:\n${errorMessages}`);
    }
    throw error;
  }
}

/**
 * Check if a wallet is configured (either private or public key)
 */
export function hasWalletConfigured(config: BnbConfig): boolean {
  return !!(config.BNB_PRIVATE_KEY || config.BNB_PUBLIC_KEY);
}

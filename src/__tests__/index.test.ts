import { describe, expect, it } from 'bun:test';
import { bnbPlugin } from '../index';
import type { Plugin } from '@elizaos/core';

describe('BNB Plugin', () => {
  it('should export a valid plugin object', () => {
    expect(bnbPlugin).toBeDefined();
    expect(bnbPlugin.name).toBe('bnb');
    expect(bnbPlugin.description).toContain('BNB Smart Chain');
  });

  it('should have the correct plugin structure', () => {
    expect(bnbPlugin).toHaveProperty('name');
    expect(bnbPlugin).toHaveProperty('description');
    expect(bnbPlugin).toHaveProperty('providers');
    expect(bnbPlugin).toHaveProperty('actions');
    expect(bnbPlugin).toHaveProperty('evaluators');
    expect(bnbPlugin).toHaveProperty('services');
  });

  it('should have 1 provider', () => {
    expect(Array.isArray(bnbPlugin.providers)).toBe(true);
    expect(bnbPlugin.providers).toHaveLength(1);
    expect(bnbPlugin.providers![0].name).toBe('bnbWallet');
  });

  it('should have 9 actions', () => {
    expect(Array.isArray(bnbPlugin.actions)).toBe(true);
    expect(bnbPlugin.actions).toHaveLength(9);

    const actionNames = bnbPlugin.actions!.map((a) => a.name);
    expect(actionNames).toContain('getBalance');
    expect(actionNames).toContain('getBalanceTestnet');
    expect(actionNames).toContain('transfer');
    expect(actionNames).toContain('swap');
    expect(actionNames).toContain('bridge');
    expect(actionNames).toContain('stake');
    expect(actionNames).toContain('faucet');
    expect(actionNames).toContain('deploy_token');
    expect(actionNames).toContain('GREENFIELD_ACTION');
  });

  it('should have empty evaluators array', () => {
    expect(Array.isArray(bnbPlugin.evaluators)).toBe(true);
    expect(bnbPlugin.evaluators).toHaveLength(0);
  });

  it('should have empty services array', () => {
    expect(Array.isArray(bnbPlugin.services)).toBe(true);
    expect(bnbPlugin.services).toHaveLength(0);
  });

  it('should have valid action metadata', () => {
    bnbPlugin.actions!.forEach((action) => {
      expect(action).toHaveProperty('name');
      expect(action).toHaveProperty('description');
      expect(action).toHaveProperty('handler');
      expect(action).toHaveProperty('validate');
      expect(action).toHaveProperty('examples');

      expect(typeof action.name).toBe('string');
      expect(typeof action.description).toBe('string');
      expect(typeof action.handler).toBe('function');
      expect(typeof action.validate).toBe('function');
      expect(Array.isArray(action.examples)).toBe(true);
    });
  });

  it('should have valid provider metadata', () => {
    bnbPlugin.providers!.forEach((provider) => {
      expect(provider).toHaveProperty('name');
      expect(provider).toHaveProperty('get');

      expect(typeof provider.name).toBe('string');
      expect(typeof provider.get).toBe('function');

      if (provider.description) {
        expect(typeof provider.description).toBe('string');
      }
    });
  });

  it('should export all necessary components', () => {
    // Test that the plugin exports are available
    expect(bnbPlugin).toBeDefined();
    expect(bnbPlugin.name).toBe('bnb');

    // Test action names are unique
    const actionNames = bnbPlugin.actions!.map((a) => a.name);
    const uniqueActionNames = new Set(actionNames);
    expect(uniqueActionNames.size).toBe(actionNames.length);
  });
});

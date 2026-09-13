// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultAgentConfig, matrixForTier, type AgentConfig } from '@lumacast/protocol';
import { AgentConfigStore } from '../../../../app/main/agent/agent-config-store';

let userDataPath: string;

function configFilePath(): string {
  return path.join(userDataPath, 'agent-config.json');
}

describe('AgentConfigStore', () => {
  beforeEach(() => {
    userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-agent-config-store-'));
  });

  afterEach(() => {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  });

  it('returns defaults when no config file exists yet', () => {
    const store = new AgentConfigStore(userDataPath);
    expect(store.load()).toEqual(createDefaultAgentConfig());
  });

  it('round-trips a saved config through load', () => {
    const store = new AgentConfigStore(userDataPath);
    const config: AgentConfig = {
      ...createDefaultAgentConfig(),
      provider: 'openai',
      model: 'gpt-5',
      baseUrl: null,
      instructions: 'Prefer concise answers.',
    };

    store.save(config);

    expect(fs.existsSync(configFilePath())).toBe(true);
    expect(new AgentConfigStore(userDataPath).load()).toEqual(config);
  });

  it('loads a config file written before the filesystem field existed, filling in its default', () => {
    const preFilesystemConfig = createDefaultAgentConfig() as unknown as Record<string, unknown>;
    Reflect.deleteProperty(preFilesystemConfig, 'filesystem');
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(configFilePath(), JSON.stringify(preFilesystemConfig), 'utf-8');

    const store = new AgentConfigStore(userDataPath);
    expect(store.load()).toEqual(createDefaultAgentConfig());
    // Not a decode failure — no backup should have been written.
    expect(fs.existsSync(`${configFilePath()}.bak`)).toBe(false);
  });

  it('round-trips a saved config with populated filesystem.allowedRoots', () => {
    const store = new AgentConfigStore(userDataPath);
    const config: AgentConfig = {
      ...createDefaultAgentConfig(),
      filesystem: { allowedRoots: ['/Users/nico/Documents', '/Users/nico/Movies'] },
    };

    store.save(config);

    expect(new AgentConfigStore(userDataPath).load()).toEqual(config);
  });

  it('falls back to defaults and keeps a .bak copy when the file is not valid JSON', () => {
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(configFilePath(), '{ not valid json', 'utf-8');

    const store = new AgentConfigStore(userDataPath);
    expect(store.load()).toEqual(createDefaultAgentConfig());

    expect(fs.existsSync(`${configFilePath()}.bak`)).toBe(true);
    expect(fs.readFileSync(`${configFilePath()}.bak`, 'utf-8')).toBe('{ not valid json');
  });

  it('falls back to defaults and keeps a .bak copy when the file is valid JSON but fails decode', () => {
    const malformed = JSON.stringify({ version: 1, provider: 'not-a-real-provider' });
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(configFilePath(), malformed, 'utf-8');

    const store = new AgentConfigStore(userDataPath);
    expect(store.load()).toEqual(createDefaultAgentConfig());

    expect(fs.existsSync(`${configFilePath()}.bak`)).toBe(true);
    expect(fs.readFileSync(`${configFilePath()}.bak`, 'utf-8')).toBe(malformed);
  });

  it('update merges a patch into the current config and persists it', () => {
    const store = new AgentConfigStore(userDataPath);

    const first = store.update({ provider: 'anthropic', model: 'claude-opus-4' });
    expect(first.provider).toBe('anthropic');
    expect(first.model).toBe('claude-opus-4');
    expect(first.instructions).toBe('');

    const second = store.update({ instructions: 'Be terse.' });
    expect(second.provider).toBe('anthropic');
    expect(second.model).toBe('claude-opus-4');
    expect(second.instructions).toBe('Be terse.');

    expect(new AgentConfigStore(userDataPath).load()).toEqual(second);
  });

  it('update merges mcp shallowly, preserving fields the patch omits', () => {
    const store = new AgentConfigStore(userDataPath);
    store.update({
      mcp: {
        enabled: true,
        clients: [
          {
            id: 'client-1',
            name: 'Editor',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastSeenAt: null,
            permissions: { matrix: matrixForTier('read-only'), showSafetyInterlock: true },
            tokenHash: 'a'.repeat(64),
          },
        ],
      },
    });

    const updated = store.update({ mcp: { enabled: false } });

    expect(updated.mcp.enabled).toBe(false);
    expect(updated.mcp.clients).toHaveLength(1);
    expect(updated.mcp.clients[0].id).toBe('client-1');
  });
});

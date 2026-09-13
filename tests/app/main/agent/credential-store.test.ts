// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_PROVIDER_IDS } from '@lumacast/protocol';
import { registerSecretForRedaction } from '../../../../app/main/redaction';
import { AgentCredentialStore, type AgentSafeStorage } from '../../../../app/main/agent/credential-store';

vi.mock('../../../../app/main/redaction', () => ({
  registerSecretForRedaction: vi.fn(),
}));

let userDataPath: string;

function fakeSafeStorage(available = true): AgentSafeStorage {
  return {
    isEncryptionAvailable: vi.fn(() => available),
    encryptString: vi.fn((plainText: string) => Buffer.from(`enc:${plainText}`, 'utf-8')),
    decryptString: vi.fn((encrypted: Buffer) => {
      const text = encrypted.toString('utf-8');
      if (!text.startsWith('enc:')) throw new Error('bad ciphertext');
      return text.slice('enc:'.length);
    }),
  };
}

describe('AgentCredentialStore', () => {
  beforeEach(() => {
    userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-agent-credentials-'));
    vi.mocked(registerSecretForRedaction).mockClear();
  });

  afterEach(() => {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  });

  it('status() reports no keys before anything is set', () => {
    const store = new AgentCredentialStore(userDataPath, fakeSafeStorage());
    expect(store.status()).toEqual(AGENT_PROVIDER_IDS.map((provider) => ({ provider, hasKey: false, keyHint: null })));
  });

  it('setKey stores an encrypted key, never plaintext, and getKey returns it back', () => {
    const store = new AgentCredentialStore(userDataPath, fakeSafeStorage());

    store.setKey('anthropic', 'sk-ant-super-secret-key-0001');

    const raw = fs.readFileSync(path.join(userDataPath, 'agent-credentials.json'), 'utf-8');
    expect(raw).not.toContain('sk-ant-super-secret-key-0001');

    expect(store.getKey('anthropic')).toBe('sk-ant-super-secret-key-0001');
  });

  it('status() reports hasKey and a last-4-chars hint once a key is set', () => {
    const store = new AgentCredentialStore(userDataPath, fakeSafeStorage());
    store.setKey('openai', 'sk-openai-abcd1234');

    const statuses = store.status();
    const openaiStatus = statuses.find((entry) => entry.provider === 'openai');
    expect(openaiStatus).toEqual({ provider: 'openai', hasKey: true, keyHint: '1234' });

    for (const entry of statuses) {
      if (entry.provider !== 'openai') expect(entry.hasKey).toBe(false);
    }
  });

  it('deleteKey removes a stored key', () => {
    const store = new AgentCredentialStore(userDataPath, fakeSafeStorage());
    store.setKey('google', 'AIzaSomeGoogleKeyValue');
    expect(store.getKey('google')).not.toBeNull();

    store.deleteKey('google');

    expect(store.getKey('google')).toBeNull();
    expect(store.status().find((entry) => entry.provider === 'google')).toEqual({ provider: 'google', hasKey: false, keyHint: null });
  });

  it('deleteKey is a no-op when nothing is stored for that provider', () => {
    const store = new AgentCredentialStore(userDataPath, fakeSafeStorage());
    expect(() => store.deleteKey('openrouter')).not.toThrow();
  });

  it('getKey returns null for a provider with no stored key', () => {
    const store = new AgentCredentialStore(userDataPath, fakeSafeStorage());
    expect(store.getKey('openai-compatible')).toBeNull();
  });

  it('setKey throws and writes nothing when secure storage is unavailable', () => {
    const store = new AgentCredentialStore(userDataPath, fakeSafeStorage(false));

    expect(() => store.setKey('anthropic', 'sk-ant-should-not-be-written')).toThrow('Secure storage is unavailable on this system');
    expect(fs.existsSync(path.join(userDataPath, 'agent-credentials.json'))).toBe(false);
  });

  it('registers the key for redaction on set and on a successful get', () => {
    const store = new AgentCredentialStore(userDataPath, fakeSafeStorage());

    store.setKey('anthropic', 'sk-ant-redact-me-0001');
    expect(registerSecretForRedaction).toHaveBeenCalledWith('sk-ant-redact-me-0001');

    vi.mocked(registerSecretForRedaction).mockClear();
    store.getKey('anthropic');
    expect(registerSecretForRedaction).toHaveBeenCalledWith('sk-ant-redact-me-0001');
  });
});

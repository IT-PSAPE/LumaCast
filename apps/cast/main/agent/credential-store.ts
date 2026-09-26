import fs from 'node:fs';
import path from 'node:path';
import type { AgentCredentialStatus, AgentProviderId } from '@lumacast/protocol';
import { AGENT_PROVIDER_IDS } from '@lumacast/protocol';
import { registerSecretForRedaction } from '../redaction';

const CREDENTIALS_FILE = 'agent-credentials.json';
const CREDENTIALS_VERSION = 1;

interface StoredCredentialsFile {
  version: 1;
  keys: Partial<Record<AgentProviderId, string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStoredCredentialsFile(value: unknown): value is StoredCredentialsFile {
  if (!isRecord(value)) return false;
  if (value.version !== CREDENTIALS_VERSION) return false;
  if (!isRecord(value.keys)) return false;
  return Object.entries(value.keys).every(([provider, encoded]) => {
    return (AGENT_PROVIDER_IDS as readonly string[]).includes(provider) && typeof encoded === 'string';
  });
}

/** The subset of Electron's `safeStorage` this store needs, so tests can inject a fake instead of the real OS keychain. */
export type AgentSafeStorage = Pick<Electron.SafeStorage, 'isEncryptionAvailable' | 'encryptString' | 'decryptString'>;

/**
 * Stores LLM provider API keys at `<userData>/agent-credentials.json`,
 * encrypted at rest via Electron's `safeStorage` (OS keychain-backed) and
 * never written in plaintext. `safeStorage` is injected through the
 * constructor rather than imported directly so tests can exercise this
 * store with a fake, and so this file stays a thin Electron-facing shim
 * rather than a place native keychain behavior gets re-implemented.
 *
 * Every key that is set or successfully read is also handed to
 * `registerSecretForRedaction` (`app/main/redaction.ts`) so it never shows
 * up verbatim in logs.
 */
export class AgentCredentialStore {
  private readonly filePath: string;
  private readonly safeStorage: AgentSafeStorage;

  constructor(userDataPath: string, safeStorage: AgentSafeStorage) {
    this.filePath = path.join(userDataPath, CREDENTIALS_FILE);
    this.safeStorage = safeStorage;
  }

  setKey(provider: AgentProviderId, apiKey: string): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is unavailable on this system');
    }
    registerSecretForRedaction(apiKey);

    const file = this.readFile();
    const encrypted = this.safeStorage.encryptString(apiKey);
    file.keys[provider] = encrypted.toString('base64');
    this.writeFile(file);
  }

  getKey(provider: AgentProviderId): string | null {
    const file = this.readFile();
    const encoded = file.keys[provider];
    if (!encoded) return null;

    try {
      const decrypted = this.safeStorage.decryptString(Buffer.from(encoded, 'base64'));
      registerSecretForRedaction(decrypted);
      return decrypted;
    } catch (error) {
      console.warn(`[AgentCredentialStore] Failed to decrypt stored key for ${provider}:`, error);
      return null;
    }
  }

  deleteKey(provider: AgentProviderId): void {
    const file = this.readFile();
    if (!(provider in file.keys)) return;
    delete file.keys[provider];
    this.writeFile(file);
  }

  status(): AgentCredentialStatus[] {
    const file = this.readFile();
    return AGENT_PROVIDER_IDS.map((provider) => {
      const encoded = file.keys[provider];
      if (!encoded) return { provider, hasKey: false, keyHint: null };
      return { provider, hasKey: true, keyHint: this.hintFor(provider, encoded) };
    });
  }

  /** Decrypts just to compute the last-4-chars hint; falls back to no hint if decryption fails rather than throwing from a read-only status call. */
  private hintFor(provider: AgentProviderId, encoded: string): string | null {
    try {
      const decrypted = this.safeStorage.decryptString(Buffer.from(encoded, 'base64'));
      registerSecretForRedaction(decrypted);
      return decrypted.slice(-4);
    } catch (error) {
      console.warn(`[AgentCredentialStore] Failed to decrypt stored key for ${provider}:`, error);
      return null;
    }
  }

  private readFile(): StoredCredentialsFile {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as unknown;
    } catch {
      return { version: CREDENTIALS_VERSION, keys: {} };
    }
    if (!isStoredCredentialsFile(parsed)) {
      console.warn('[AgentCredentialStore] Invalid credentials file, treating as empty');
      return { version: CREDENTIALS_VERSION, keys: {} };
    }
    return parsed;
  }

  private writeFile(file: StoredCredentialsFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(file, null, 2), 'utf-8');
    fs.renameSync(tempPath, this.filePath);
  }
}

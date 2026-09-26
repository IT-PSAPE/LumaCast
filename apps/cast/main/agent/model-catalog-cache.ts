import fs from 'node:fs';
import path from 'node:path';
import { AGENT_PROVIDER_IDS, type AgentModelInfo, type AgentModelValidation, type AgentProviderId } from '@lumacast/protocol';

const FRESH_MS = 60 * 60 * 1000;
interface CatalogEntry {
  provider: AgentProviderId;
  baseUrl: string | null;
  fetchedAt: number;
  models: AgentModelInfo[];
}
type LoadCatalog = () => Promise<AgentModelInfo[]>;

function isModel(value: unknown): value is AgentModelInfo {
  if (!value || typeof value !== 'object') return false;
  const model = value as Record<string, unknown>;
  const limit = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0);
  return typeof model.id === 'string' && model.id.length > 0 && typeof model.label === 'string'
    && limit(model.contextWindow) && limit(model.maxOutputTokens)
    && typeof model.supportsTools === 'boolean' && typeof model.isFree === 'boolean'
    && (model.vendor === null || typeof model.vendor === 'string');
}

/** Non-authoritative display metadata only. Never persists keys, grants, or conversation data. */
export class ModelCatalogCache {
  private readonly filePath: string;
  private readonly entries = new Map<string, CatalogEntry>();
  private readonly pending = new Map<string, Promise<AgentModelInfo[]>>();

  constructor(userDataPath: string, private readonly now: () => number = Date.now) {
    this.filePath = path.join(userDataPath, 'agent-model-catalogs.json');
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (data?.version !== 1 || !Array.isArray(data.entries)) return;
      for (const entry of data.entries) {
        if (!entry || !AGENT_PROVIDER_IDS.includes(entry.provider)
          || !(entry.baseUrl === null || typeof entry.baseUrl === 'string')
          || !Number.isFinite(entry.fetchedAt) || entry.fetchedAt > this.now()
          || !Array.isArray(entry.models) || !entry.models.every(isModel)) continue;
        this.entries.set(this.key(entry.provider, entry.baseUrl), entry);
      }
    } catch { /* Missing or corrupt metadata is disposable; config and credentials are separate. */ }
  }

  async list(provider: AgentProviderId, baseUrl: string | null, load: LoadCatalog, refresh = false): Promise<AgentModelInfo[]> {
    const key = this.key(provider, baseUrl);
    const cached = this.entries.get(key);
    if (cached && !refresh) {
      if (!this.isFresh(cached)) {
        // Settings remain usable offline; a stale catalog is never evidence that a model was removed.
        void this.fetch(provider, baseUrl, load).catch(() => {});
      }
      return cached.models;
    }
    return this.fetch(provider, baseUrl, load);
  }

  async validate(provider: AgentProviderId, baseUrl: string | null, model: string, load: LoadCatalog): Promise<AgentModelValidation> {
    try {
      const cached = this.entries.get(this.key(provider, baseUrl));
      const models = cached && this.isFresh(cached) ? cached.models : await this.fetch(provider, baseUrl, load);
      return models.some((entry) => entry.id === model) ? 'valid' : 'not-found';
    } catch {
      return 'unknown';
    }
  }

  invalidate(provider: AgentProviderId): void {
    for (const [key, entry] of this.entries) if (entry.provider === provider) this.entries.delete(key);
    for (const key of this.pending.keys()) if (JSON.parse(key)[0] === provider) this.pending.delete(key);
    this.persist();
  }

  private key(provider: AgentProviderId, baseUrl: string | null): string {
    // Fixed-endpoint adapters ignore the settings URL. Only these two consume it.
    return JSON.stringify([provider, provider === 'openai-compatible' || provider === 'opencode' ? baseUrl : null]);
  }

  private isFresh(entry: CatalogEntry): boolean {
    const age = this.now() - entry.fetchedAt;
    return age >= 0 && age < FRESH_MS;
  }

  private fetch(provider: AgentProviderId, baseUrl: string | null, load: LoadCatalog): Promise<AgentModelInfo[]> {
    const key = this.key(provider, baseUrl);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const pending = Promise.resolve().then(load).then((models) => {
      if (!models.every(isModel)) throw new Error('The provider returned an invalid model catalog.');
      // Credential replacement invalidates in-flight work too.
      if (this.pending.get(key) === pending) {
        this.entries.set(key, { provider, baseUrl: JSON.parse(key)[1], fetchedAt: this.now(), models });
        this.persist();
      }
      return models;
    }).finally(() => {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    });
    this.pending.set(key, pending);
    return pending;
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.tmp`;
      fs.writeFileSync(temp, JSON.stringify({ version: 1, entries: [...this.entries.values()] }), 'utf8');
      fs.renameSync(temp, this.filePath);
    } catch {
      console.warn('[ModelCatalogCache] Could not persist model metadata.');
    }
  }
}

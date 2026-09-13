import fs from 'node:fs';
import path from 'node:path';
import type { AgentConfig, AgentConfigUpdate } from '@lumacast/protocol';
import { CodecError, createDefaultAgentConfig, decodeAgentConfig, type CodecContext } from '@lumacast/protocol';

const CONFIG_FILE = 'agent-config.json';

function agentConfigContext(operation: string): CodecContext {
  return { boundary: 'agent-config', operation, path: '' };
}

/**
 * Persists the LLM agent's provider/model selection, custom instructions,
 * and permission grants to `<userData>/agent-config.json`. Lives in
 * `app/main` (not `@lumacast/protocol` or another headless package) because
 * it touches Node's `fs` directly — the same split `NdiConfigStore`
 * (`packages/engine/src/ndi-config-store.ts`) uses for its own persisted
 * preferences file.
 *
 * Unlike `NdiConfigStore`'s per-field healing (its file is compatibility-
 * tolerant operator preferences), a corrupt or invalid agent-config file is
 * not healed field by field: this file also carries permission grants, so a
 * partially-trusted merge could silently resurrect a stale grant. Instead a
 * failed decode discards the file's authority entirely and falls back to
 * `createDefaultAgentConfig()` — safe defaults — while preserving the bad
 * file as `<file>.bak` so it stays diagnosable.
 */
export class AgentConfigStore {
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, CONFIG_FILE);
  }

  load(): AgentConfig {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf-8');
    } catch {
      // No file yet (first run) or unreadable — defaults, nothing to back up.
      return createDefaultAgentConfig();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      console.warn('[AgentConfigStore] Config file is not valid JSON, using defaults:', error);
      this.backupBadFile(raw);
      return createDefaultAgentConfig();
    }

    try {
      return decodeAgentConfig(parsed, agentConfigContext('load'));
    } catch (error) {
      if (error instanceof CodecError) {
        console.warn('[AgentConfigStore] Invalid config file, using defaults:', error.message);
      } else {
        console.warn('[AgentConfigStore] Invalid config file, using defaults:', error);
      }
      this.backupBadFile(raw);
      return createDefaultAgentConfig();
    }
  }

  save(config: AgentConfig): void {
    this.ensureDir();
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf-8');
    fs.renameSync(tempPath, this.filePath);
  }

  update(patch: AgentConfigUpdate): AgentConfig {
    const current = this.load();
    const next: AgentConfig = {
      ...current,
      ...patch,
      version: 1,
      mcp: { ...current.mcp, ...patch.mcp },
    };
    this.save(next);
    return next;
  }

  private ensureDir(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  /** Best-effort: preserves the bad file's exact contents at `<file>.bak` so it stays inspectable after being discarded. */
  private backupBadFile(raw: string): void {
    try {
      fs.writeFileSync(`${this.filePath}.bak`, raw, 'utf-8');
    } catch (error) {
      console.warn('[AgentConfigStore] Failed to back up invalid config file:', error);
    }
  }
}

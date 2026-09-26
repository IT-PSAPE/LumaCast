import fs from 'node:fs';
import path from 'node:path';
import type { Id } from '@lumacast/kernel';
import { createId, nowIso } from '@lumacast/kernel';
import type {
  AgentMessage,
  AgentMessagePatch,
  AgentProviderId,
  AgentThread,
  AgentThreadCreateInput,
  AgentThreadSummary,
} from '@lumacast/protocol';
import { CodecError, decodeAgentThread, deriveThreadTitle, type CodecContext } from '@lumacast/protocol';

const THREADS_DIR = path.join('agent', 'threads');
const DEFAULT_TITLE = 'New chat';

function threadContext(operation: string): CodecContext {
  return { boundary: 'agent-thread', operation, path: '' };
}

function summaryOf(thread: AgentThread): AgentThreadSummary {
  const { id, title, createdAt, updatedAt, messageCount, provider, model } = thread;
  return { id, title, createdAt, updatedAt, messageCount, provider, model };
}

interface CacheEntry {
  /** `${mtimeMs}:${size}` of the file this summary was read from — invalidated when either changes. */
  key: string;
  summary: AgentThreadSummary;
}

/**
 * Persists agent chat threads at `<userData>/agent/threads/<threadId>.json`,
 * one JSON file per thread holding the full `AgentThread` (metadata plus
 * messages). Lives in `app/main` (not `@lumacast/protocol` or another
 * headless package) for the same reason `AgentConfigStore`
 * (`app/main/agent/agent-config-store.ts`) does: it touches Node's `fs`
 * directly. Writes are atomic (tmp file + rename), matching that store's
 * idiom.
 *
 * `list()` is expected to be called far more often than any single thread
 * changes, so thread summaries are cached in memory keyed by each file's
 * `mtimeMs:size`; a repeat `list()` call re-reads only the files that
 * changed since the last scan (including changes made outside this store).
 * A thread file that fails to parse or decode is skipped rather than thrown
 * from `list()` — it is warned about and renamed to `<id>.json.corrupt` so
 * it stays diagnosable without blocking every other thread, mirroring
 * `AgentConfigStore`'s `.bak` handling of a bad file.
 *
 * The store is synchronous, like `AgentConfigStore` — thread files are
 * small, and every operation re-reads the affected thread from disk before
 * mutating it, so there is no in-memory state to keep consistent across
 * calls beyond the `list()` summary cache.
 */
export class AgentThreadStore {
  private readonly rootPath: string;
  private readonly cache = new Map<Id, CacheEntry>();

  constructor(userDataPath: string) {
    this.rootPath = path.join(userDataPath, THREADS_DIR);
  }

  list(): AgentThreadSummary[] {
    let entries: string[];
    try {
      entries = fs.readdirSync(this.rootPath);
    } catch {
      // No threads directory yet (first run) — nothing to list.
      return [];
    }

    const seenIds = new Set<string>();
    const summaries: AgentThreadSummary[] = [];

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const id = entry.slice(0, -'.json'.length);
      seenIds.add(id);

      let stat: fs.Stats;
      try {
        stat = fs.statSync(this.filePath(id));
      } catch {
        continue;
      }
      const key = `${stat.mtimeMs}:${stat.size}`;

      const cached = this.cache.get(id);
      if (cached && cached.key === key) {
        summaries.push(cached.summary);
        continue;
      }

      const thread = this.readThreadFile(id);
      if (!thread) continue;
      const summary = summaryOf(thread);
      this.cache.set(id, { key, summary });
      summaries.push(summary);
    }

    for (const cachedId of this.cache.keys()) {
      if (!seenIds.has(cachedId)) this.cache.delete(cachedId);
    }

    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: Id): AgentThread | null {
    return this.readThreadFile(id);
  }

  create(input: AgentThreadCreateInput): AgentThread {
    const now = nowIso();
    const thread: AgentThread = {
      id: createId(),
      title: input.title?.trim() || DEFAULT_TITLE,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      provider: input.provider,
      model: input.model,
      messages: [],
    };
    this.writeThreadFile(thread);
    return thread;
  }

  appendMessage(
    threadId: Id,
    message: Omit<AgentMessage, 'id' | 'createdAt'> & Partial<Pick<AgentMessage, 'id' | 'createdAt'>>,
  ): AgentMessage {
    const thread = this.requireThread(threadId);

    const fullMessage: AgentMessage = {
      id: message.id ?? createId(),
      role: message.role,
      parts: message.parts,
      createdAt: message.createdAt ?? nowIso(),
      usage: message.usage,
    };

    thread.messages.push(fullMessage);
    thread.messageCount = thread.messages.length;
    thread.updatedAt = nowIso();

    if (thread.title === DEFAULT_TITLE && fullMessage.role === 'user') {
      const textPart = fullMessage.parts.find((part) => part.type === 'text');
      if (textPart && textPart.type === 'text') {
        thread.title = deriveThreadTitle(textPart.text);
      }
    }

    this.writeThreadFile(thread);
    return fullMessage;
  }

  updateMessage(threadId: Id, messageId: Id, patch: AgentMessagePatch): AgentMessage {
    const thread = this.requireThread(threadId);
    const message = thread.messages.find((candidate) => candidate.id === messageId);
    if (!message) throw new Error('Message not found');

    if (patch.parts !== undefined) message.parts = patch.parts;
    if (patch.usage !== undefined) message.usage = patch.usage;
    thread.updatedAt = nowIso();

    this.writeThreadFile(thread);
    return message;
  }

  rename(threadId: Id, title: string): AgentThreadSummary {
    const thread = this.requireThread(threadId);
    thread.title = title;
    thread.updatedAt = nowIso();
    this.writeThreadFile(thread);
    return summaryOf(thread);
  }

  setThreadModel(threadId: Id, provider: AgentProviderId | null, model: string | null): AgentThreadSummary {
    const thread = this.requireThread(threadId);
    thread.provider = provider;
    thread.model = model;
    thread.updatedAt = nowIso();
    this.writeThreadFile(thread);
    return summaryOf(thread);
  }

  delete(threadId: Id): void {
    this.cache.delete(threadId);
    try {
      fs.unlinkSync(this.filePath(threadId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private requireThread(threadId: Id): AgentThread {
    const thread = this.readThreadFile(threadId);
    if (!thread) throw new Error('Thread not found');
    return thread;
  }

  private filePath(id: Id): string {
    return path.join(this.rootPath, `${id}.json`);
  }

  /** Reads, parses, and decodes one thread file. Returns `null` (never throws) for a missing, unparseable, or invalid file; the latter two are quarantined. */
  private readThreadFile(id: Id): AgentThread | null {
    const filePath = this.filePath(id);
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      console.warn(`[AgentThreadStore] Thread file ${id}.json is not valid JSON, skipping:`, error);
      this.quarantine(id);
      return null;
    }

    try {
      return decodeAgentThread(parsed, threadContext('load'));
    } catch (error) {
      if (error instanceof CodecError) {
        console.warn(`[AgentThreadStore] Invalid thread file ${id}.json, skipping:`, error.message);
      } else {
        console.warn(`[AgentThreadStore] Invalid thread file ${id}.json, skipping:`, error);
      }
      this.quarantine(id);
      return null;
    }
  }

  /** Best-effort: preserves a bad file at `<id>.json.corrupt` so it stays inspectable after being discarded, and drops it from the summary cache. */
  private quarantine(id: Id): void {
    this.cache.delete(id);
    try {
      fs.renameSync(this.filePath(id), `${this.filePath(id)}.corrupt`);
    } catch (error) {
      console.warn(`[AgentThreadStore] Failed to quarantine corrupt thread file ${id}.json:`, error);
    }
  }

  private writeThreadFile(thread: AgentThread): void {
    fs.mkdirSync(this.rootPath, { recursive: true });
    const filePath = this.filePath(thread.id);
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(thread, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
    // Force the next list() to re-stat and re-read rather than trust a cache
    // entry keyed by the pre-write mtime/size.
    this.cache.delete(thread.id);
  }
}

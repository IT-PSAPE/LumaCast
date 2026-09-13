// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@lumacast/protocol';
import { AgentThreadStore } from '../../../../app/main/agent/thread-store';

let userDataPath: string;

function threadsDir(): string {
  return path.join(userDataPath, 'agent', 'threads');
}

function threadFilePath(id: string): string {
  return path.join(threadsDir(), `${id}.json`);
}

function readThreadFile(id: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(threadFilePath(id), 'utf-8')) as Record<string, unknown>;
}

function writeThreadFile(id: string, data: Record<string, unknown>): void {
  fs.mkdirSync(threadsDir(), { recursive: true });
  fs.writeFileSync(threadFilePath(id), JSON.stringify(data, null, 2), 'utf-8');
}

function setUpdatedAt(id: string, updatedAt: string): void {
  const data = readThreadFile(id);
  data.updatedAt = updatedAt;
  writeThreadFile(id, data);
}

const userMessage = (text: string): Omit<AgentMessage, 'id' | 'createdAt'> => ({
  role: 'user',
  parts: [{ type: 'text', text }],
  usage: null,
});

describe('AgentThreadStore', () => {
  beforeEach(() => {
    userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-agent-threads-'));
  });

  afterEach(() => {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  });

  describe('directory creation', () => {
    it('does not create the threads directory until a thread is written', () => {
      new AgentThreadStore(userDataPath);
      expect(fs.existsSync(threadsDir())).toBe(false);
    });

    it('list() returns an empty array before any thread exists', () => {
      const store = new AgentThreadStore(userDataPath);
      expect(store.list()).toEqual([]);
    });
  });

  describe('create', () => {
    it('creates a thread with defaults and persists it to its own file', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: 'anthropic', model: 'claude-opus-4' });

      expect(thread.title).toBe('New chat');
      expect(thread.provider).toBe('anthropic');
      expect(thread.model).toBe('claude-opus-4');
      expect(thread.messageCount).toBe(0);
      expect(thread.messages).toEqual([]);
      expect(thread.createdAt).toBe(thread.updatedAt);
      expect(typeof thread.id).toBe('string');
      expect(thread.id.length).toBeGreaterThan(0);

      expect(fs.existsSync(threadFilePath(thread.id))).toBe(true);
      expect(new AgentThreadStore(userDataPath).get(thread.id)).toEqual(thread);
    });

    it('uses a provided title, trimmed', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ title: '  My custom title  ', provider: null, model: null });
      expect(thread.title).toBe('My custom title');
    });

    it('falls back to the default title when given only whitespace', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ title: '   ', provider: null, model: null });
      expect(thread.title).toBe('New chat');
    });
  });

  describe('list', () => {
    it('orders threads by updatedAt, newest first', () => {
      const store = new AgentThreadStore(userDataPath);
      const a = store.create({ provider: null, model: null });
      const b = store.create({ provider: null, model: null });
      const c = store.create({ provider: null, model: null });

      setUpdatedAt(a.id, '2026-01-01T00:00:00.000Z');
      setUpdatedAt(b.id, '2026-03-01T00:00:00.000Z');
      setUpdatedAt(c.id, '2026-02-01T00:00:00.000Z');

      expect(store.list().map((summary) => summary.id)).toEqual([b.id, c.id, a.id]);
    });

    it('summaries omit the messages array', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: null, model: null });
      store.appendMessage(thread.id, userMessage('Hello'));

      const [summary] = store.list();
      expect(summary).not.toHaveProperty('messages');
      expect(summary.messageCount).toBe(1);
    });

    it('reuses cached summaries across list() calls when nothing changed on disk', () => {
      const store = new AgentThreadStore(userDataPath);
      store.create({ provider: null, model: null });
      store.create({ provider: null, model: null });

      // Warm the cache; the write-then-invalidate from create() means this
      // first call still reads both files once.
      expect(store.list()).toHaveLength(2);

      const readSpy = vi.spyOn(fs, 'readFileSync');
      const summaries = store.list();

      expect(summaries).toHaveLength(2);
      expect(readSpy).not.toHaveBeenCalled();
      readSpy.mockRestore();
    });

    it('invalidates the cache when a thread file changes on disk outside the store', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: null, model: null });
      store.rename(thread.id, 'Original title');

      expect(store.list()[0].title).toBe('Original title');

      const data = readThreadFile(thread.id);
      data.title = 'Changed outside the store';
      writeThreadFile(thread.id, data);
      // Force a distinct mtime even on filesystems with coarse timestamp resolution.
      const future = new Date(Date.now() + 5000);
      fs.utimesSync(threadFilePath(thread.id), future, future);

      const summaries = store.list();
      expect(summaries.find((s) => s.id === thread.id)?.title).toBe('Changed outside the store');
    });

    it('skips a thread file that is not valid JSON, warns, and quarantines it', () => {
      writeThreadFile('not-json-thread', {}); // placeholder to create the directory
      fs.writeFileSync(threadFilePath('not-json-thread'), '{ not valid json', 'utf-8');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = new AgentThreadStore(userDataPath);
      const summaries = store.list();

      expect(summaries).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalled();
      expect(fs.existsSync(`${threadFilePath('not-json-thread')}.corrupt`)).toBe(true);
      expect(fs.existsSync(threadFilePath('not-json-thread'))).toBe(false);
      warnSpy.mockRestore();
    });

    it('skips a thread file that is valid JSON but fails schema decode, warns, and quarantines it', () => {
      writeThreadFile('bad-schema-thread', { id: 'bad-schema-thread', title: 'x' });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = new AgentThreadStore(userDataPath);
      const summaries = store.list();

      expect(summaries).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalled();
      expect(fs.existsSync(`${threadFilePath('bad-schema-thread')}.corrupt`)).toBe(true);
      warnSpy.mockRestore();
    });

    it('does not let a corrupt file block other threads from listing', () => {
      const store = new AgentThreadStore(userDataPath);
      const good = store.create({ provider: null, model: null });
      writeThreadFile('corrupt-thread', {});
      fs.writeFileSync(threadFilePath('corrupt-thread'), 'not json at all', 'utf-8');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const summaries = store.list();
      warnSpy.mockRestore();

      expect(summaries.map((s) => s.id)).toEqual([good.id]);
    });
  });

  describe('get', () => {
    it('returns the full thread including messages', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: null, model: null });
      store.appendMessage(thread.id, userMessage('Hi'));

      const fetched = store.get(thread.id)!;
      expect(fetched.messages).toHaveLength(1);
      expect(fetched.messages[0].parts).toEqual([{ type: 'text', text: 'Hi' }]);
    });

    it('returns null for an unknown thread id', () => {
      const store = new AgentThreadStore(userDataPath);
      expect(store.get('does-not-exist')).toBeNull();
    });

    it('returns null (rather than throwing) for a corrupt thread file', () => {
      writeThreadFile('corrupt-thread', {});
      fs.writeFileSync(threadFilePath('corrupt-thread'), 'not json', 'utf-8');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = new AgentThreadStore(userDataPath);
      expect(store.get('corrupt-thread')).toBeNull();
      warnSpy.mockRestore();
    });
  });

  describe('appendMessage', () => {
    it('generates an id and createdAt, bumps updatedAt and messageCount', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: null, model: null });

      const message = store.appendMessage(thread.id, {
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hello' }],
        usage: { inputTokens: 10, outputTokens: 20 },
      });

      expect(typeof message.id).toBe('string');
      expect(message.id.length).toBeGreaterThan(0);
      expect(typeof message.createdAt).toBe('string');

      const updated = store.get(thread.id)!;
      expect(updated.messageCount).toBe(1);
      expect(updated.messages).toEqual([message]);
      expect(typeof updated.updatedAt).toBe('string');
    });

    it('honors a caller-provided id and createdAt', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: null, model: null });

      const message = store.appendMessage(thread.id, {
        id: 'fixed-id',
        role: 'user',
        parts: [{ type: 'text', text: 'Hi' }],
        createdAt: '2020-01-01T00:00:00.000Z',
        usage: null,
      });

      expect(message.id).toBe('fixed-id');
      expect(message.createdAt).toBe('2020-01-01T00:00:00.000Z');
    });

    it('derives the thread title from the first user message with a text part', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: null, model: null });

      store.appendMessage(thread.id, userMessage('  How do I configure NDI output for a second screen?  '));

      expect(store.get(thread.id)!.title).toBe('How do I configure NDI output for a second screen?');
    });

    it('does not re-derive the title once it has moved away from the default', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: null, model: null });
      store.rename(thread.id, 'Custom title');

      store.appendMessage(thread.id, userMessage('This should not become the title'));

      expect(store.get(thread.id)!.title).toBe('Custom title');
    });

    it('does not derive a title from an assistant message', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: null, model: null });

      store.appendMessage(thread.id, {
        role: 'assistant',
        parts: [{ type: 'text', text: 'An assistant message should not set the title' }],
        usage: null,
      });

      expect(store.get(thread.id)!.title).toBe('New chat');
    });

    it('does not derive a title from a user message with no text part', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: null, model: null });

      store.appendMessage(thread.id, {
        role: 'user',
        parts: [
          {
            type: 'tool_call',
            callId: 'call-1',
            actionId: 'noop',
            arguments: null,
            status: 'pending',
            result: null,
            error: null,
            startedAt: null,
            finishedAt: null,
          },
        ],
        usage: null,
      });

      expect(store.get(thread.id)!.title).toBe('New chat');
    });

    it('truncates a long first message into a title capped at 60 characters', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: null, model: null });

      store.appendMessage(thread.id, userMessage('a'.repeat(100)));

      const title = store.get(thread.id)!.title;
      expect(title.length).toBe(60);
      expect(title.endsWith('…')).toBe(true);
    });

    it('appends multiple messages in order and keeps messageCount in sync', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: null, model: null });

      store.appendMessage(thread.id, userMessage('First'));
      store.appendMessage(thread.id, { role: 'assistant', parts: [{ type: 'text', text: 'Second' }], usage: null });

      const updated = store.get(thread.id)!;
      expect(updated.messageCount).toBe(2);
      expect(updated.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    });

    it('throws "Thread not found" for an unknown thread id', () => {
      const store = new AgentThreadStore(userDataPath);
      expect(() => store.appendMessage('does-not-exist', userMessage('Hi'))).toThrow('Thread not found');
    });
  });

  describe('updateMessage', () => {
    it('replaces parts when the patch includes them, leaving usage untouched', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: null, model: null });
      const message = store.appendMessage(thread.id, {
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hi' }],
        usage: { inputTokens: 1, outputTokens: 2 },
      });

      const updated = store.updateMessage(thread.id, message.id, { parts: [{ type: 'text', text: 'Bye' }] });

      expect(updated.parts).toEqual([{ type: 'text', text: 'Bye' }]);
      expect(updated.usage).toEqual({ inputTokens: 1, outputTokens: 2 });
    });

    it('replaces usage when the patch includes it, leaving parts untouched', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: null, model: null });
      const message = store.appendMessage(thread.id, {
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hi' }],
        usage: null,
      });

      const updated = store.updateMessage(thread.id, message.id, { usage: { inputTokens: 5, outputTokens: 7 } });

      expect(updated.usage).toEqual({ inputTokens: 5, outputTokens: 7 });
      expect(updated.parts).toEqual([{ type: 'text', text: 'Hi' }]);
    });

    it('can clear usage back to null', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: null, model: null });
      const message = store.appendMessage(thread.id, {
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hi' }],
        usage: { inputTokens: 1, outputTokens: 2 },
      });

      const updated = store.updateMessage(thread.id, message.id, { usage: null });
      expect(updated.usage).toBeNull();
    });

    it('persists the update to disk', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: null, model: null });
      const message = store.appendMessage(thread.id, { role: 'assistant', parts: [{ type: 'text', text: 'Hi' }], usage: null });

      store.updateMessage(thread.id, message.id, { parts: [{ type: 'text', text: 'Bye' }] });

      expect(new AgentThreadStore(userDataPath).get(thread.id)!.messages[0].parts).toEqual([{ type: 'text', text: 'Bye' }]);
    });

    it('throws "Message not found" for an unknown message id', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: null, model: null });
      expect(() => store.updateMessage(thread.id, 'does-not-exist', { usage: null })).toThrow('Message not found');
    });

    it('throws "Thread not found" for an unknown thread id', () => {
      const store = new AgentThreadStore(userDataPath);
      expect(() => store.updateMessage('does-not-exist', 'msg-1', { usage: null })).toThrow('Thread not found');
    });
  });

  describe('rename', () => {
    it('updates the title and updatedAt, and returns the new summary', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: null, model: null });

      const summary = store.rename(thread.id, 'A better title');

      expect(summary.title).toBe('A better title');
      expect(store.get(thread.id)!.title).toBe('A better title');
    });

    it('throws "Thread not found" for an unknown thread id', () => {
      const store = new AgentThreadStore(userDataPath);
      expect(() => store.rename('does-not-exist', 'title')).toThrow('Thread not found');
    });
  });

  describe('setThreadModel', () => {
    it('updates provider and model, and returns the new summary', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: null, model: null });

      const summary = store.setThreadModel(thread.id, 'openai', 'gpt-5');

      expect(summary.provider).toBe('openai');
      expect(summary.model).toBe('gpt-5');
      expect(store.get(thread.id)!.provider).toBe('openai');
      expect(store.get(thread.id)!.model).toBe('gpt-5');
    });

    it('can clear provider and model back to null', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: 'openai', model: 'gpt-5' });

      const summary = store.setThreadModel(thread.id, null, null);

      expect(summary.provider).toBeNull();
      expect(summary.model).toBeNull();
    });

    it('throws "Thread not found" for an unknown thread id', () => {
      const store = new AgentThreadStore(userDataPath);
      expect(() => store.setThreadModel('does-not-exist', 'openai', 'gpt-5')).toThrow('Thread not found');
    });
  });

  describe('delete', () => {
    it('removes the thread file and it no longer appears in list()/get()', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: null, model: null });

      store.delete(thread.id);

      expect(fs.existsSync(threadFilePath(thread.id))).toBe(false);
      expect(store.get(thread.id)).toBeNull();
      expect(store.list()).toEqual([]);
    });

    it('is idempotent: deleting an already-deleted (or never-existing) thread does not throw', () => {
      const store = new AgentThreadStore(userDataPath);
      const thread = store.create({ provider: null, model: null });

      store.delete(thread.id);
      expect(() => store.delete(thread.id)).not.toThrow();
      expect(() => store.delete('never-existed')).not.toThrow();
    });
  });
});

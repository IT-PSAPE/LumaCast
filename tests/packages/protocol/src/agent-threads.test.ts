import { describe, expect, it } from 'vitest';
import type { CodecContext } from '../../../../packages/protocol/src/codecs';
import {
  decodeAgentMessage,
  decodeAgentThread,
  deriveThreadTitle,
  type AgentMessage,
  type AgentThread,
} from '../../../../packages/protocol/src/agent-threads';

const CONTEXT: CodecContext = { boundary: 'test', operation: 'unit', path: '' };

function validMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: 'msg-1',
    role: 'user',
    parts: [{ type: 'text', text: 'Hello there' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    usage: null,
    ...overrides,
  };
}

function validThread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    id: 'thread-1',
    title: 'New chat',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messageCount: 1,
    provider: 'anthropic',
    model: 'claude-opus-4',
    messages: [validMessage()],
    ...overrides,
  };
}

describe('deriveThreadTitle', () => {
  it('returns a short first line unchanged', () => {
    expect(deriveThreadTitle('How do I configure NDI output?')).toBe('How do I configure NDI output?');
  });

  it('trims leading/trailing whitespace', () => {
    expect(deriveThreadTitle('   spaced out title   ')).toBe('spaced out title');
  });

  it('collapses internal runs of whitespace to a single space', () => {
    expect(deriveThreadTitle('too    many\tspaces   here')).toBe('too many spaces here');
  });

  it('uses only the first line, ignoring the rest of the message', () => {
    expect(deriveThreadTitle('First line only\nSecond line ignored\nThird line ignored')).toBe('First line only');
  });

  it('falls back to "New chat" for an empty string', () => {
    expect(deriveThreadTitle('')).toBe('New chat');
  });

  it('falls back to "New chat" for a whitespace-only string', () => {
    expect(deriveThreadTitle('   \t  ')).toBe('New chat');
  });

  it('falls back to "New chat" when the first line is blank even if later lines have content', () => {
    expect(deriveThreadTitle('   \nSecond line has text')).toBe('New chat');
  });

  it('leaves a title of exactly 60 characters unchanged', () => {
    const sixty = 'a'.repeat(60);
    expect(deriveThreadTitle(sixty)).toBe(sixty);
    expect(deriveThreadTitle(sixty).length).toBe(60);
  });

  it('truncates a title longer than 60 characters and appends an ellipsis, total length 60', () => {
    const long = 'a'.repeat(100);
    const title = deriveThreadTitle(long);
    expect(title.length).toBe(60);
    expect(title.endsWith('…')).toBe(true);
    expect(title).toBe(`${'a'.repeat(59)}…`);
  });

  it('truncates before collapsing does not leave trailing partial whitespace runs uncollapsed', () => {
    const long = `${'a'.repeat(58)}   ${'b'.repeat(20)}`;
    const title = deriveThreadTitle(long);
    expect(title.length).toBe(60);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('decodeAgentMessage', () => {
  it('accepts a message with a text part round-tripped through JSON', () => {
    const message = validMessage();
    expect(decodeAgentMessage(JSON.parse(JSON.stringify(message)), CONTEXT)).toEqual(message);
  });

  it('accepts a message with a populated usage', () => {
    const message = validMessage({ usage: { inputTokens: 12, outputTokens: 34 } });
    expect(decodeAgentMessage(message, CONTEXT)).toEqual(message);
  });

  it('accepts a message with a tool_call part covering every status', () => {
    const statuses = ['pending', 'awaiting_permission', 'running', 'succeeded', 'failed', 'denied', 'cancelled'] as const;
    for (const status of statuses) {
      const message = validMessage({
        role: 'assistant',
        parts: [
          {
            type: 'tool_call',
            callId: 'call-1',
            actionId: 'slide.create',
            arguments: { slideId: 'abc', nested: { ok: true, list: [1, 2, 3] } },
            status,
            result: status === 'succeeded' ? { ok: true } : null,
            error: status === 'failed' ? 'boom' : null,
            startedAt: '2026-01-01T00:00:01.000Z',
            finishedAt: status === 'pending' || status === 'awaiting_permission' || status === 'running' ? null : '2026-01-01T00:00:02.000Z',
          },
        ],
      });
      expect(decodeAgentMessage(message, CONTEXT)).toEqual(message);
    }
  });

  it('accepts a tool_call part whose arguments/result are primitives, arrays, or null', () => {
    for (const value of ['text-arg', 42, true, null, [1, 'two', false], { deep: { nested: [null, 1, 'x'] } }]) {
      const message = validMessage({
        parts: [
          {
            type: 'tool_call',
            callId: 'call-1',
            actionId: 'noop',
            arguments: value,
            status: 'succeeded',
            result: value,
            error: null,
            startedAt: null,
            finishedAt: null,
          },
        ],
      });
      expect(decodeAgentMessage(message, CONTEXT)).toEqual(message);
    }
  });

  it('accepts a message with an error part', () => {
    const message = validMessage({ parts: [{ type: 'error', code: 'rate_limited', message: 'Too many requests' }] });
    expect(decodeAgentMessage(message, CONTEXT)).toEqual(message);
  });

  it('rejects a non-object value', () => {
    expect(() => decodeAgentMessage('nope', CONTEXT)).toThrow();
    expect(() => decodeAgentMessage(null, CONTEXT)).toThrow();
  });

  it('rejects an unknown top-level field', () => {
    expect(() => decodeAgentMessage({ ...validMessage(), extra: true }, CONTEXT)).toThrow();
  });

  it('rejects an invalid role', () => {
    expect(() => decodeAgentMessage({ ...validMessage(), role: 'system' }, CONTEXT)).toThrow();
  });

  it('rejects an invalid part type', () => {
    const message = validMessage({ parts: [{ type: 'thinking', text: 'nope' } as never] });
    expect(() => decodeAgentMessage(message, CONTEXT)).toThrow();
  });

  it('rejects a part with an unknown field', () => {
    const message = validMessage({ parts: [{ type: 'text', text: 'hi', extra: true } as never] });
    expect(() => decodeAgentMessage(message, CONTEXT)).toThrow();
  });

  it('rejects an invalid tool_call status', () => {
    const message = validMessage({
      parts: [
        {
          type: 'tool_call',
          callId: 'call-1',
          actionId: 'noop',
          arguments: null,
          status: 'in-progress' as never,
          result: null,
          error: null,
          startedAt: null,
          finishedAt: null,
        },
      ],
    });
    expect(() => decodeAgentMessage(message, CONTEXT)).toThrow();
  });

  it('rejects tool_call arguments that are not JSON-serialisable', () => {
    const message = validMessage({
      parts: [
        {
          type: 'tool_call',
          callId: 'call-1',
          actionId: 'noop',
          arguments: (() => {}) as never,
          status: 'pending',
          result: null,
          error: null,
          startedAt: null,
          finishedAt: null,
        },
      ],
    });
    expect(() => decodeAgentMessage(message, CONTEXT)).toThrow();
  });

  it('rejects tool_call result that is not JSON-serialisable', () => {
    const message = validMessage({
      parts: [
        {
          type: 'tool_call',
          callId: 'call-1',
          actionId: 'noop',
          arguments: null,
          status: 'succeeded',
          result: { nested: { fn: (() => {}) as never } },
          error: null,
          startedAt: null,
          finishedAt: null,
        },
      ],
    });
    expect(() => decodeAgentMessage(message, CONTEXT)).toThrow();
  });

  it('rejects parts that is not an array', () => {
    expect(() => decodeAgentMessage({ ...validMessage(), parts: 'nope' as never }, CONTEXT)).toThrow();
  });

  it('rejects a usage object with a non-numeric field', () => {
    const message = validMessage({ usage: { inputTokens: 'a lot' as never, outputTokens: null } });
    expect(() => decodeAgentMessage(message, CONTEXT)).toThrow();
  });

  it('rejects a usage object with an unknown field', () => {
    const message = { ...validMessage(), usage: { inputTokens: 1, outputTokens: 1, extra: true } };
    expect(() => decodeAgentMessage(message, CONTEXT)).toThrow();
  });
});

describe('decodeAgentThread', () => {
  it('accepts a full thread round-tripped through JSON', () => {
    const thread = validThread();
    expect(decodeAgentThread(JSON.parse(JSON.stringify(thread)), CONTEXT)).toEqual(thread);
  });

  it('accepts a thread with a null provider/model and no messages', () => {
    const thread = validThread({ provider: null, model: null, messageCount: 0, messages: [] });
    expect(decodeAgentThread(thread, CONTEXT)).toEqual(thread);
  });

  it('rejects a non-object value', () => {
    expect(() => decodeAgentThread('nope', CONTEXT)).toThrow();
    expect(() => decodeAgentThread(null, CONTEXT)).toThrow();
  });

  it('rejects an unknown top-level field', () => {
    expect(() => decodeAgentThread({ ...validThread(), extra: true }, CONTEXT)).toThrow();
  });

  it('rejects an invalid provider id', () => {
    expect(() => decodeAgentThread({ ...validThread(), provider: 'not-a-provider' }, CONTEXT)).toThrow();
  });

  it('rejects a non-finite messageCount', () => {
    expect(() => decodeAgentThread({ ...validThread(), messageCount: Number.NaN }, CONTEXT)).toThrow();
    expect(() => decodeAgentThread({ ...validThread(), messageCount: '1' as never }, CONTEXT)).toThrow();
  });

  it('rejects messages that is not an array', () => {
    expect(() => decodeAgentThread({ ...validThread(), messages: {} as never }, CONTEXT)).toThrow();
  });

  it('rejects a thread whose nested message is invalid, with a path pointing into the message', () => {
    const thread = validThread({ messages: [{ ...validMessage(), role: 'system' as never }] });
    expect(() => decodeAgentThread(thread, CONTEXT)).toThrow(/messages\[0\]\.role/);
  });

  it('rejects a missing required field', () => {
    const thread = validThread() as unknown as Record<string, unknown>;
    Reflect.deleteProperty(thread, 'updatedAt');
    expect(() => decodeAgentThread(thread, CONTEXT)).toThrow();
  });
});

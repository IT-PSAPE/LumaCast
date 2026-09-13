import { describe, expect, it } from 'vitest';
import {
  CodecError,
  decodeAgentActionRequest,
  decodeAgentActionResponse,
  decodeAgentPrincipal,
  describeAgentPrincipal,
  type CodecContext,
} from '@lumacast/protocol';

const context: CodecContext = { boundary: 'rpc', operation: 'agentRespondAction', path: '' };

describe('decodeAgentPrincipal', () => {
  it('decodes both principal kinds', () => {
    expect(decodeAgentPrincipal({ kind: 'in-app', threadId: 't1' }, context)).toEqual({ kind: 'in-app', threadId: 't1' });
    expect(decodeAgentPrincipal({ kind: 'mcp', clientId: 'c1', clientName: 'Editor' }, context)).toEqual({
      kind: 'mcp',
      clientId: 'c1',
      clientName: 'Editor',
    });
  });

  it('rejects a foreign field on the wrong kind', () => {
    expect(() => decodeAgentPrincipal({ kind: 'in-app', threadId: 't1', clientName: 'x' }, context)).toThrow(CodecError);
  });

  it('rejects an unknown kind', () => {
    expect(() => decodeAgentPrincipal({ kind: 'cli' }, context)).toThrow(CodecError);
  });
});

describe('describeAgentPrincipal', () => {
  it('names the in-app assistant and an MCP client', () => {
    expect(describeAgentPrincipal({ kind: 'in-app', threadId: 't1' })).toBe('Assistant');
    expect(describeAgentPrincipal({ kind: 'mcp', clientId: 'c1', clientName: 'Editor' })).toBe('Editor');
  });
});

describe('decodeAgentActionResponse', () => {
  it('decodes a success with an arbitrary result payload', () => {
    const result = { ok: true, changed: { playlists: { upserted: ['p1'], deleted: [] } } };
    expect(decodeAgentActionResponse({ requestId: 'r1', outcome: 'succeeded', result }, context)).toEqual({
      requestId: 'r1',
      outcome: 'succeeded',
      result,
    });
  });

  it('keeps an always-allow grant on success and failure', () => {
    expect(decodeAgentActionResponse({ requestId: 'r1', outcome: 'succeeded', result: null, alwaysAllow: 'broadcast' }, context))
      .toMatchObject({ alwaysAllow: 'broadcast' });
    expect(decodeAgentActionResponse({ requestId: 'r1', outcome: 'failed', error: 'boom', alwaysAllow: 'write' }, context))
      .toMatchObject({ outcome: 'failed', error: 'boom', alwaysAllow: 'write' });
  });

  it('omits alwaysAllow when it was not sent', () => {
    const decoded = decodeAgentActionResponse({ requestId: 'r1', outcome: 'succeeded', result: 1 }, context);
    expect('alwaysAllow' in decoded).toBe(false);
  });

  it('rejects an unknown risk class in alwaysAllow', () => {
    expect(() => decodeAgentActionResponse({ requestId: 'r1', outcome: 'succeeded', result: null, alwaysAllow: 'nuclear' }, context))
      .toThrow(CodecError);
  });

  it('decodes every denial reason and rejects an invented one', () => {
    for (const reason of ['user', 'interlock', 'invalid-params', 'unknown-action']) {
      expect(decodeAgentActionResponse({ requestId: 'r1', outcome: 'denied', reason }, context)).toEqual({
        requestId: 'r1',
        outcome: 'denied',
        reason,
      });
    }
    expect(() => decodeAgentActionResponse({ requestId: 'r1', outcome: 'denied', reason: 'vibes' }, context)).toThrow(CodecError);
  });

  it('decodes a cancellation', () => {
    expect(decodeAgentActionResponse({ requestId: 'r1', outcome: 'cancelled' }, context)).toEqual({
      requestId: 'r1',
      outcome: 'cancelled',
    });
  });

  it('rejects a missing requestId, an unknown outcome, and extra fields', () => {
    expect(() => decodeAgentActionResponse({ outcome: 'cancelled' }, context)).toThrow(CodecError);
    expect(() => decodeAgentActionResponse({ requestId: 'r1', outcome: 'maybe' }, context)).toThrow(CodecError);
    expect(() => decodeAgentActionResponse({ requestId: 'r1', outcome: 'cancelled', result: 1 }, context)).toThrow(CodecError);
    expect(() => decodeAgentActionResponse('nope', context)).toThrow(CodecError);
  });

  it('requires an error message on failure', () => {
    expect(() => decodeAgentActionResponse({ requestId: 'r1', outcome: 'failed' }, context)).toThrow(CodecError);
  });
});

describe('decodeAgentActionRequest', () => {
  const request = {
    requestId: 'r1',
    principal: { kind: 'in-app', threadId: 't1' },
    actionId: 'playlist.create',
    params: { name: 'Sunday' },
    decision: 'auto',
    interlockEnabled: true,
    batchId: null,
  };

  it('decodes a well-formed request', () => {
    expect(decodeAgentActionRequest(request, context)).toEqual(request);
  });

  it('rejects a deny decision, which must never reach the renderer', () => {
    expect(() => decodeAgentActionRequest({ ...request, decision: 'deny' }, context)).toThrow(CodecError);
  });

  it('rejects a non-boolean interlock flag and a non-string batch id', () => {
    expect(() => decodeAgentActionRequest({ ...request, interlockEnabled: 'yes' }, context)).toThrow(CodecError);
    expect(() => decodeAgentActionRequest({ ...request, batchId: 7 }, context)).toThrow(CodecError);
  });
});

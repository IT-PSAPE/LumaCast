import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AgentConfig, AgentMcpClient, AgentPrincipal } from '@lumacast/protocol';
import { createDefaultAgentConfig, matrixForTier } from '@lumacast/protocol';
import {
  SessionGrants,
  decideAction,
  hashMcpToken,
  principalKey,
  resolvePrincipalPermissions,
  verifyMcpToken,
} from '../../../../app/main/agent/permission-policy';

const IN_APP: AgentPrincipal = { kind: 'in-app', threadId: 'thread-1' };
const MCP: AgentPrincipal = { kind: 'mcp', clientId: 'client-1', clientName: 'Editor' };

function client(overrides: Partial<AgentMcpClient> = {}): AgentMcpClient {
  return {
    id: 'client-1',
    name: 'Editor',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: null,
    permissions: { matrix: matrixForTier('read-only'), showSafetyInterlock: true },
    tokenHash: hashMcpToken('token-1'),
    ...overrides,
  };
}

function configWith(clients: AgentMcpClient[]): AgentConfig {
  const config = createDefaultAgentConfig();
  return { ...config, mcp: { ...config.mcp, enabled: true, clients } };
}

describe('principalKey', () => {
  it('collapses every in-app thread onto one key', () => {
    expect(principalKey(IN_APP)).toBe('in-app');
    expect(principalKey({ kind: 'in-app', threadId: 'thread-2' })).toBe('in-app');
  });

  it('scopes an MCP principal to its client id, not its announced name', () => {
    expect(principalKey(MCP)).toBe('mcp:client-1');
    expect(principalKey({ kind: 'mcp', clientId: 'client-1', clientName: 'Renamed' })).toBe('mcp:client-1');
  });
});

describe('SessionGrants', () => {
  it('starts empty and records one risk class at a time', () => {
    const grants = new SessionGrants();
    expect(grants.has('in-app', 'write')).toBe(false);
    grants.grant('in-app', 'write');
    expect(grants.has('in-app', 'write')).toBe(true);
    expect(grants.has('in-app', 'destructive')).toBe(false);
  });

  it('keeps principals independent', () => {
    const grants = new SessionGrants();
    grants.grant('in-app', 'destructive');
    expect(grants.has('mcp:client-1', 'destructive')).toBe(false);
  });

  it('clears one principal without touching the others', () => {
    const grants = new SessionGrants();
    grants.grant('in-app', 'write');
    grants.grant('mcp:client-1', 'write');
    grants.clear('mcp:client-1');
    expect(grants.has('mcp:client-1', 'write')).toBe(false);
    expect(grants.has('in-app', 'write')).toBe(true);
  });

  it('clears everything when no key is given', () => {
    const grants = new SessionGrants();
    grants.grant('in-app', 'write');
    grants.grant('mcp:client-1', 'broadcast');
    grants.clear();
    expect(grants.has('in-app', 'write')).toBe(false);
    expect(grants.has('mcp:client-1', 'broadcast')).toBe(false);
  });
});

describe('resolvePrincipalPermissions', () => {
  it('returns the in-app settings for the assistant', () => {
    const config = createDefaultAgentConfig();
    expect(resolvePrincipalPermissions(config, IN_APP)).toBe(config.inApp);
  });

  it('returns the named client’s own settings', () => {
    const config = configWith([client()]);
    expect(resolvePrincipalPermissions(config, MCP)?.matrix).toEqual(matrixForTier('read-only'));
  });

  it('returns null for an MCP client that is not (or is no longer) configured', () => {
    expect(resolvePrincipalPermissions(configWith([]), MCP)).toBeNull();
    expect(resolvePrincipalPermissions(configWith([client({ id: 'other' })]), MCP)).toBeNull();
  });
});

describe('decideAction', () => {
  const grants = () => new SessionGrants();

  it('runs an auto class silently', () => {
    const permissions = { matrix: matrixForTier('content'), showSafetyInterlock: true };
    expect(decideAction(permissions, grants(), 'in-app', 'write')).toEqual({ decision: 'auto', interlockEnabled: true });
  });

  it('prompts for an ask class', () => {
    const permissions = { matrix: matrixForTier('content'), showSafetyInterlock: false };
    expect(decideAction(permissions, grants(), 'in-app', 'destructive')).toEqual({
      decision: 'ask',
      interlockEnabled: false,
    });
  });

  it('refuses a deny class', () => {
    const permissions = { matrix: matrixForTier('read-only'), showSafetyInterlock: true };
    expect(decideAction(permissions, grants(), 'in-app', 'write').decision).toBe('deny');
  });

  it('upgrades an ask class to auto once the user has answered "always allow"', () => {
    const permissions = { matrix: matrixForTier('content'), showSafetyInterlock: true };
    const session = grants();
    expect(decideAction(permissions, session, 'in-app', 'destructive').decision).toBe('ask');
    session.grant('in-app', 'destructive');
    expect(decideAction(permissions, session, 'in-app', 'destructive').decision).toBe('auto');
  });

  it('never lets a session grant override a configured deny', () => {
    const permissions = { matrix: matrixForTier('read-only'), showSafetyInterlock: true };
    const session = grants();
    session.grant('in-app', 'broadcast');
    expect(decideAction(permissions, session, 'in-app', 'broadcast').decision).toBe('deny');
  });

  it('scopes a grant to the principal that earned it', () => {
    const permissions = { matrix: matrixForTier('content'), showSafetyInterlock: true };
    const session = grants();
    session.grant('in-app', 'destructive');
    expect(decideAction(permissions, session, 'mcp:client-1', 'destructive').decision).toBe('ask');
  });

  it('passes the interlock flag through untouched', () => {
    const on = { matrix: matrixForTier('unrestricted'), showSafetyInterlock: true };
    const off = { matrix: matrixForTier('unrestricted'), showSafetyInterlock: false };
    expect(decideAction(on, grants(), 'in-app', 'broadcast').interlockEnabled).toBe(true);
    expect(decideAction(off, grants(), 'in-app', 'broadcast').interlockEnabled).toBe(false);
  });
});

describe('verifyMcpToken', () => {
  it('hashes with sha256 hex', () => {
    expect(hashMcpToken('token-1')).toBe(crypto.createHash('sha256').update('token-1', 'utf-8').digest('hex'));
    expect(hashMcpToken('token-1')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('finds the client whose stored hash matches', () => {
    const config = configWith([client({ id: 'a', tokenHash: hashMcpToken('aaa') }), client({ id: 'b', tokenHash: hashMcpToken('bbb') })]);
    expect(verifyMcpToken(config, 'bbb')?.id).toBe('b');
  });

  it('rejects an unknown token, an empty token, and a raw hash replayed as a token', () => {
    const config = configWith([client({ tokenHash: hashMcpToken('aaa') })]);
    expect(verifyMcpToken(config, 'nope')).toBeNull();
    expect(verifyMcpToken(config, '')).toBeNull();
    expect(verifyMcpToken(config, hashMcpToken('aaa'))).toBeNull();
  });

  it('rejects every token when no client is configured', () => {
    expect(verifyMcpToken(configWith([]), 'aaa')).toBeNull();
  });
});

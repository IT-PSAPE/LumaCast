import { describe, expect, it } from 'vitest';
import { ACTION_RISK_CLASSES } from '../../../../packages/commands/src/actions';
import type { CodecContext } from '../../../../packages/protocol/src/codecs';
import {
  AGENT_PERMISSION_TIERS,
  AGENT_PROVIDER_IDS,
  AGENT_PROVIDERS,
  DEFAULT_MCP_PORT,
  createDefaultAgentConfig,
  decodeAgentConfig,
  decodeAgentConfigUpdate,
  matrixForTier,
  tierForMatrix,
  type AgentConfig,
  type AgentPermissionMatrix,
} from '../../../../packages/protocol/src/agent';

const CONTEXT: CodecContext = { boundary: 'test', operation: 'unit', path: '' };

function validMatrix(): AgentPermissionMatrix {
  return matrixForTier('content');
}

function validConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return { ...createDefaultAgentConfig(), ...overrides };
}

describe('AGENT_PROVIDERS / AGENT_PROVIDER_IDS', () => {
  it('has one info entry per provider id, in the same order', () => {
    expect(AGENT_PROVIDERS.map((provider) => provider.id)).toEqual(AGENT_PROVIDER_IDS);
  });

  it('only openai-compatible requires a base URL', () => {
    for (const provider of AGENT_PROVIDERS) {
      expect(provider.requiresBaseUrl).toBe(provider.id === 'openai-compatible');
    }
  });
});

describe('permission tiers <-> matrices round-trip', () => {
  it('matrixForTier returns the exact matrix for every tier', () => {
    expect(matrixForTier('off')).toEqual({ read: 'deny', write: 'deny', destructive: 'deny', broadcast: 'deny', filesystem: 'deny' });
    expect(matrixForTier('read-only')).toEqual({ read: 'auto', write: 'deny', destructive: 'deny', broadcast: 'deny', filesystem: 'deny' });
    expect(matrixForTier('ask-everything')).toEqual({ read: 'auto', write: 'ask', destructive: 'ask', broadcast: 'ask', filesystem: 'ask' });
    expect(matrixForTier('content')).toEqual({ read: 'auto', write: 'auto', destructive: 'ask', broadcast: 'ask', filesystem: 'ask' });
    expect(matrixForTier('content-and-files')).toEqual({
      read: 'auto',
      write: 'auto',
      destructive: 'ask',
      broadcast: 'ask',
      filesystem: 'auto',
    });
    expect(matrixForTier('all-but-broadcast')).toEqual({
      read: 'auto',
      write: 'auto',
      destructive: 'auto',
      broadcast: 'ask',
      filesystem: 'auto',
    });
    expect(matrixForTier('unrestricted')).toEqual({ read: 'auto', write: 'auto', destructive: 'auto', broadcast: 'auto', filesystem: 'auto' });
  });

  it('tierForMatrix recovers the tier id for every known tier', () => {
    for (const tier of AGENT_PERMISSION_TIERS) {
      expect(tierForMatrix(matrixForTier(tier.id))).toBe(tier.id);
    }
  });

  it('tierForMatrix returns null for a matrix matching no known tier', () => {
    const custom: AgentPermissionMatrix = { read: 'ask', write: 'deny', destructive: 'auto', broadcast: 'deny', filesystem: 'ask' };
    expect(tierForMatrix(custom)).toBeNull();
  });

  it('matrixForTier returns a fresh copy each call (callers cannot mutate the shared tier table)', () => {
    const a = matrixForTier('content');
    a.read = 'deny';
    expect(matrixForTier('content').read).toBe('auto');
  });

  it('every tier matrix covers every action risk class', () => {
    for (const tier of AGENT_PERMISSION_TIERS) {
      expect(Object.keys(tier.matrix).sort()).toEqual([...ACTION_RISK_CLASSES].sort());
    }
  });
});

describe('createDefaultAgentConfig', () => {
  it('defaults to the content tier with the safety interlock on and MCP disabled', () => {
    const config = createDefaultAgentConfig();
    expect(config.version).toBe(1);
    expect(config.provider).toBeNull();
    expect(config.model).toBeNull();
    expect(config.baseUrl).toBeNull();
    expect(config.instructions).toBe('');
    expect(config.inApp.matrix).toEqual(matrixForTier('content'));
    expect(config.inApp.showSafetyInterlock).toBe(true);
    expect(config.mcp).toEqual({ enabled: false, clients: [], port: DEFAULT_MCP_PORT });
    expect(config.filesystem).toEqual({ allowedRoots: [] });
  });
});

describe('decodeAgentConfig', () => {
  it('accepts a default config round-tripped through JSON', () => {
    const config = validConfig();
    const decoded = decodeAgentConfig(JSON.parse(JSON.stringify(config)), CONTEXT);
    expect(decoded).toEqual(config);
  });

  it('accepts a config with a populated MCP client', () => {
    const config = validConfig({
      provider: 'anthropic',
      model: 'claude-opus-4',
      mcp: {
        enabled: true,
        clients: [
          {
            id: 'client-1',
            name: 'Editor',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastSeenAt: null,
            permissions: { matrix: validMatrix(), showSafetyInterlock: false },
            tokenHash: 'b3a1'.repeat(16),
          },
        ],
        port: DEFAULT_MCP_PORT,
      },
    });
    expect(decodeAgentConfig(config, CONTEXT)).toEqual(config);
  });

  it('rejects an mcp client with no tokenHash', () => {
    const client = {
      id: 'client-1',
      name: 'Editor',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: null,
      permissions: { matrix: validMatrix(), showSafetyInterlock: false },
    };
    const config = validConfig({ mcp: { enabled: true, clients: [client as never], port: DEFAULT_MCP_PORT } });
    expect(() => decodeAgentConfig(config, CONTEXT)).toThrow(/tokenHash/);
  });

  it('rejects an mcp client whose tokenHash is not a string', () => {
    const config = validConfig({
      mcp: {
        enabled: true,
        clients: [
          {
            id: 'client-1',
            name: 'Editor',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastSeenAt: null,
            permissions: { matrix: validMatrix(), showSafetyInterlock: false },
            tokenHash: 12 as never,
          },
        ],
        port: DEFAULT_MCP_PORT,
      },
    });
    expect(() => decodeAgentConfig(config, CONTEXT)).toThrow(/tokenHash/);
  });

  it('rejects a non-object value', () => {
    expect(() => decodeAgentConfig('nope', CONTEXT)).toThrow();
    expect(() => decodeAgentConfig(null, CONTEXT)).toThrow();
  });

  it('rejects an unknown top-level field', () => {
    expect(() => decodeAgentConfig({ ...validConfig(), extra: true }, CONTEXT)).toThrow();
  });

  it('rejects a wrong version', () => {
    expect(() => decodeAgentConfig({ ...validConfig(), version: 2 }, CONTEXT)).toThrow();
  });

  it('rejects an unknown provider id', () => {
    expect(() => decodeAgentConfig({ ...validConfig(), provider: 'not-a-provider' }, CONTEXT)).toThrow();
  });

  it('rejects a permission matrix with an invalid decision', () => {
    const config = validConfig();
    config.inApp.matrix.write = 'sometimes' as never;
    expect(() => decodeAgentConfig(config, CONTEXT)).toThrow();
  });

  it('rejects a permission matrix missing a risk class', () => {
    const config = validConfig() as unknown as Record<string, unknown>;
    const inApp = config.inApp as Record<string, unknown>;
    const matrix = inApp.matrix as Record<string, unknown>;
    Reflect.deleteProperty(matrix, 'filesystem');
    expect(() => decodeAgentConfig(config, CONTEXT)).toThrow();
  });

  it('rejects a non-boolean showSafetyInterlock', () => {
    const config = validConfig();
    (config.inApp as unknown as Record<string, unknown>).showSafetyInterlock = 'yes';
    expect(() => decodeAgentConfig(config, CONTEXT)).toThrow();
  });

  it('rejects mcp.clients that is not an array', () => {
    const config = validConfig() as unknown as Record<string, unknown>;
    (config.mcp as Record<string, unknown>).clients = 'nope';
    expect(() => decodeAgentConfig(config, CONTEXT)).toThrow();
  });

  it('rejects an mcp client with an unknown field', () => {
    const config = validConfig({
      mcp: {
        enabled: true,
        clients: [
          {
            id: 'client-1',
            name: 'Editor',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastSeenAt: null,
            permissions: { matrix: validMatrix(), showSafetyInterlock: false },
            tokenHash: 'b3a1'.repeat(16),
            extra: true,
          } as never,
        ],
        port: DEFAULT_MCP_PORT,
      },
    });
    expect(() => decodeAgentConfig(config, CONTEXT)).toThrow();
  });

  it('accepts an explicit numeric mcp.port', () => {
    const config = validConfig({ mcp: { enabled: false, clients: [], port: 9000 } });
    expect(decodeAgentConfig(config, CONTEXT)).toEqual(config);
  });

  it('accepts a null mcp.port (ephemeral)', () => {
    const config = validConfig({ mcp: { enabled: false, clients: [], port: null } });
    expect(decodeAgentConfig(config, CONTEXT)).toEqual(config);
  });

  it('fills the default mcp.port when a stored config file predates the field', () => {
    const config = validConfig() as unknown as Record<string, unknown>;
    Reflect.deleteProperty(config.mcp as Record<string, unknown>, 'port');
    expect(decodeAgentConfig(config, CONTEXT)).toEqual(validConfig());
  });

  it('rejects a non-integer mcp.port', () => {
    const config = validConfig({ mcp: { enabled: false, clients: [], port: 90.5 } });
    expect(() => decodeAgentConfig(config, CONTEXT)).toThrow(/port/);
  });

  it('rejects an out-of-range mcp.port', () => {
    expect(() => decodeAgentConfig(validConfig({ mcp: { enabled: false, clients: [], port: 0 } }), CONTEXT)).toThrow(/port/);
    expect(() => decodeAgentConfig(validConfig({ mcp: { enabled: false, clients: [], port: 70_000 } }), CONTEXT)).toThrow(/port/);
  });

  it('rejects a non-numeric mcp.port', () => {
    const config = validConfig({ mcp: { enabled: false, clients: [], port: '9000' as never } });
    expect(() => decodeAgentConfig(config, CONTEXT)).toThrow(/port/);
  });

  it('accepts a config with populated filesystem.allowedRoots', () => {
    const config = validConfig({ filesystem: { allowedRoots: ['/Users/nico/Documents', '/Users/nico/Movies'] } });
    expect(decodeAgentConfig(config, CONTEXT)).toEqual(config);
  });

  it('fills the default filesystem config when a stored config file predates the field', () => {
    const config = validConfig() as unknown as Record<string, unknown>;
    Reflect.deleteProperty(config, 'filesystem');
    expect(decodeAgentConfig(config, CONTEXT)).toEqual(validConfig());
  });

  it('rejects a filesystem.allowedRoots that is not an array', () => {
    const config = validConfig({ filesystem: { allowedRoots: 'not-an-array' as never } });
    expect(() => decodeAgentConfig(config, CONTEXT)).toThrow();
  });

  it('rejects a filesystem.allowedRoots entry that is not a string', () => {
    const config = validConfig({ filesystem: { allowedRoots: [42 as never] } });
    expect(() => decodeAgentConfig(config, CONTEXT)).toThrow();
  });

  it('rejects an unknown field inside filesystem', () => {
    const config = validConfig() as unknown as Record<string, unknown>;
    config.filesystem = { allowedRoots: [], extra: true };
    expect(() => decodeAgentConfig(config, CONTEXT)).toThrow();
  });

  it('rejects a non-object filesystem value', () => {
    const config = validConfig() as unknown as Record<string, unknown>;
    config.filesystem = 'nope';
    expect(() => decodeAgentConfig(config, CONTEXT)).toThrow();
  });
});

describe('decodeAgentConfigUpdate', () => {
  it('accepts an empty patch', () => {
    expect(decodeAgentConfigUpdate({}, CONTEXT)).toEqual({});
  });

  it('accepts a partial patch with only instructions', () => {
    expect(decodeAgentConfigUpdate({ instructions: 'Be terse.' }, CONTEXT)).toEqual({ instructions: 'Be terse.' });
  });

  it('accepts a partial patch that only enables mcp', () => {
    expect(decodeAgentConfigUpdate({ mcp: { enabled: true } }, CONTEXT)).toEqual({ mcp: { enabled: true } });
  });

  it('accepts a null provider (clearing selection)', () => {
    expect(decodeAgentConfigUpdate({ provider: null }, CONTEXT)).toEqual({ provider: null });
  });

  it('rejects an unknown top-level field', () => {
    expect(() => decodeAgentConfigUpdate({ version: 1 }, CONTEXT)).toThrow();
  });

  it('rejects an invalid provider id', () => {
    expect(() => decodeAgentConfigUpdate({ provider: 'not-a-provider' }, CONTEXT)).toThrow();
  });

  it('rejects an mcp patch with an unknown field', () => {
    expect(() => decodeAgentConfigUpdate({ mcp: { bogus: true } }, CONTEXT)).toThrow();
  });

  it('accepts a patch that only sets mcp.port', () => {
    expect(decodeAgentConfigUpdate({ mcp: { port: 9000 } }, CONTEXT)).toEqual({ mcp: { port: 9000 } });
  });

  it('accepts a patch that clears mcp.port to ephemeral', () => {
    expect(decodeAgentConfigUpdate({ mcp: { port: null } }, CONTEXT)).toEqual({ mcp: { port: null } });
  });

  it('rejects an invalid mcp.port in a patch', () => {
    expect(() => decodeAgentConfigUpdate({ mcp: { port: 0 } }, CONTEXT)).toThrow(/port/);
    expect(() => decodeAgentConfigUpdate({ mcp: { port: 1.5 } }, CONTEXT)).toThrow(/port/);
    expect(() => decodeAgentConfigUpdate({ mcp: { port: '9000' } }, CONTEXT)).toThrow(/port/);
  });

  it('rejects an inApp patch with an invalid matrix', () => {
    expect(() =>
      decodeAgentConfigUpdate({ inApp: { matrix: { ...validMatrix(), read: 'nope' }, showSafetyInterlock: true } }, CONTEXT),
    ).toThrow();
  });

  it('accepts a filesystem patch granting allowed roots', () => {
    expect(decodeAgentConfigUpdate({ filesystem: { allowedRoots: ['/Users/nico/Documents'] } }, CONTEXT)).toEqual({
      filesystem: { allowedRoots: ['/Users/nico/Documents'] },
    });
  });

  it('rejects a filesystem patch with a non-array allowedRoots', () => {
    expect(() => decodeAgentConfigUpdate({ filesystem: { allowedRoots: 'nope' } }, CONTEXT)).toThrow();
  });

  it('rejects a filesystem patch with an unknown field', () => {
    expect(() => decodeAgentConfigUpdate({ filesystem: { allowedRoots: [], bogus: true } }, CONTEXT)).toThrow();
  });
});

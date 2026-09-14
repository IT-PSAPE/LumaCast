import { describe, expect, it } from 'vitest';
import { ACTION_RISK_CLASSES } from '../../../../packages/commands/src/actions';
import type { CodecContext } from '../../../../packages/protocol/src/codecs';
import {
  AGENT_PERMISSION_TIERS,
  AGENT_PROVIDER_IDS,
  AGENT_PROVIDERS,
  DEFAULT_MCP_PORT,
  cleanCatalogModelName,
  createDefaultAgentConfig,
  decodeAgentConfig,
  decodeAgentConfigUpdate,
  inferModelVendor,
  matrixForTier,
  prettifyModelId,
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

  it('exposes OpenCode Zen with its agent API base URL', () => {
    expect(AGENT_PROVIDERS.find((provider) => provider.id === 'opencode')).toEqual({
      id: 'opencode',
      label: 'OpenCode Zen',
      requiresBaseUrl: false,
      defaultBaseUrl: 'https://opencode.ai/zen/v1',
      docsUrl: 'https://opencode.ai/docs/zen',
    });
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
  it('defaults to the unrestricted tier with the safety interlock on and MCP disabled', () => {
    const config = createDefaultAgentConfig();
    expect(config.version).toBe(1);
    expect(config.provider).toBeNull();
    expect(config.model).toBeNull();
    expect(config.baseUrl).toBeNull();
    expect(config.instructions).toBe('');
    expect(config.inApp.matrix).toEqual(matrixForTier('unrestricted'));
    expect(config.inApp.showSafetyInterlock).toBe(true);
    expect(config.mcp).toEqual({ enabled: false, clients: [], port: DEFAULT_MCP_PORT });
    expect(config.filesystem).toEqual({ allowedRoots: [] });
    expect(config.composerModels).toEqual({});
  });
});

describe('inferModelVendor', () => {
  it('reads an OpenRouter-style vendor/model id prefix', () => {
    expect(inferModelVendor('anthropic/claude-opus-5')).toBe('anthropic');
    expect(inferModelVendor('meta-llama/llama-3.3-70b-instruct')).toBe('meta');
    expect(inferModelVendor('x-ai/grok-4')).toBe('xai');
    expect(inferModelVendor('qwen/qwen3-coder')).toBe('qwen');
    expect(inferModelVendor('mistralai/mistral-large')).toBe('mistral');
    expect(inferModelVendor('deepseek/deepseek-v3')).toBe('deepseek');
  });

  it('falls back to a models.dev provider.npm package hint', () => {
    expect(inferModelVendor('some-opaque-id', { npm: '@ai-sdk/anthropic' })).toBe('anthropic');
    expect(inferModelVendor('some-opaque-id', { npm: '@ai-sdk/openai' })).toBe('openai');
    expect(inferModelVendor('some-opaque-id', { npm: '@ai-sdk/google' })).toBe('google');
  });

  it('falls back to a "Vendor: Model" catalog name hint', () => {
    expect(inferModelVendor('some-opaque-id', { name: 'Mistral: Large' })).toBe('mistral');
    expect(inferModelVendor('some-opaque-id', { name: 'Anthropic: Claude Sonnet 4' })).toBe('anthropic');
  });

  it('falls back to a model-family pattern in the id when no prefix or hint matches', () => {
    expect(inferModelVendor('claude-opus-5')).toBe('anthropic');
    expect(inferModelVendor('gpt-4o-mini')).toBe('openai');
    expect(inferModelVendor('gemini-3-flash')).toBe('google');
    expect(inferModelVendor('big-pickle')).toBe('opencode');
  });

  it('returns null when nothing about the id or hints identifies a vendor', () => {
    expect(inferModelVendor('some-unknown-vendor/mystery-model')).toBeNull();
    expect(inferModelVendor('totally-opaque-id')).toBeNull();
  });

  it('never throws on odd input', () => {
    expect(() => inferModelVendor('')).not.toThrow();
    expect(inferModelVendor('')).toBeNull();
    expect(() => inferModelVendor('   ')).not.toThrow();
    expect(() => inferModelVendor('a/b/c')).not.toThrow();
    expect(() => inferModelVendor('weird:id::free', { name: undefined, npm: undefined })).not.toThrow();
  });
});

describe('prettifyModelId', () => {
  it('drops a vendor/ prefix and title-cases dash-separated words', () => {
    expect(prettifyModelId('anthropic/claude-code-latest')).toBe('Claude Code Latest');
  });

  it('title-cases a plain id and recognizes acronym tokens', () => {
    expect(prettifyModelId('gpt-4o-mini')).toBe('GPT 4o Mini');
  });

  it('drops an OpenRouter variant suffix and preserves digit-led tokens as-is', () => {
    expect(prettifyModelId('meta-llama/llama-3.3-70b-instruct:free')).toBe('Llama 3.3 70b Instruct');
  });

  it('recognizes the GLM acronym token', () => {
    expect(prettifyModelId('glm-4.6')).toBe('GLM 4.6');
  });

  it('returns an empty string unchanged', () => {
    expect(prettifyModelId('')).toBe('');
  });
});

describe('cleanCatalogModelName', () => {
  it('strips a "Vendor: " prefix', () => {
    expect(cleanCatalogModelName('Anthropic: Claude Sonnet 4', 'anthropic/claude-sonnet-4')).toBe('Claude Sonnet 4');
  });

  it('strips a trailing "(free)" suffix', () => {
    expect(cleanCatalogModelName('Meta: Llama 3.3 70B Instruct (free)', 'meta-llama/llama-3.3-70b-instruct:free')).toBe('Llama 3.3 70B Instruct');
  });

  it('strips a trailing "(beta)" suffix', () => {
    expect(cleanCatalogModelName('Some Vendor: Some Model (beta)', 'vendor/some-model')).toBe('Some Model');
  });

  it('falls back to prettifyModelId when the name is blank', () => {
    expect(cleanCatalogModelName('', 'anthropic/claude-code-latest')).toBe('Claude Code Latest');
    expect(cleanCatalogModelName(null, 'gpt-4o-mini')).toBe('GPT 4o Mini');
    expect(cleanCatalogModelName(undefined, 'glm-4.6')).toBe('GLM 4.6');
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

  it('fills the default composerModels when a stored config file predates the field', () => {
    const config = validConfig() as unknown as Record<string, unknown>;
    Reflect.deleteProperty(config, 'composerModels');
    expect(decodeAgentConfig(config, CONTEXT)).toEqual(validConfig());
  });

  it('accepts a config with populated composerModels', () => {
    const config = validConfig({ composerModels: { openrouter: ['anthropic/claude-opus-5', 'meta-llama/llama-3.3-70b-instruct'] } });
    expect(decodeAgentConfig(config, CONTEXT)).toEqual(config);
  });

  it('rejects a composerModels entry that is not an array', () => {
    const config = validConfig() as unknown as Record<string, unknown>;
    config.composerModels = { openrouter: 'not-an-array' };
    expect(() => decodeAgentConfig(config, CONTEXT)).toThrow();
  });

  it('rejects a composerModels entry whose ids are not strings', () => {
    const config = validConfig() as unknown as Record<string, unknown>;
    config.composerModels = { openrouter: [42] };
    expect(() => decodeAgentConfig(config, CONTEXT)).toThrow();
  });

  it('rejects an unknown provider key in composerModels', () => {
    const config = validConfig() as unknown as Record<string, unknown>;
    config.composerModels = { 'not-a-provider': ['a/b'] };
    expect(() => decodeAgentConfig(config, CONTEXT)).toThrow();
  });

  it('rejects a non-object composerModels value', () => {
    const config = validConfig() as unknown as Record<string, unknown>;
    config.composerModels = 'nope';
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

  it('accepts a composerModels patch and passes it through', () => {
    expect(decodeAgentConfigUpdate({ composerModels: { openrouter: ['anthropic/claude-opus-5'] } }, CONTEXT)).toEqual({
      composerModels: { openrouter: ['anthropic/claude-opus-5'] },
    });
  });

  it('rejects a composerModels patch with a non-array entry', () => {
    expect(() => decodeAgentConfigUpdate({ composerModels: { openrouter: 'nope' } }, CONTEXT)).toThrow();
  });

  it('rejects a composerModels patch with an unknown provider key', () => {
    expect(() => decodeAgentConfigUpdate({ composerModels: { 'not-a-provider': [] } }, CONTEXT)).toThrow();
  });
});

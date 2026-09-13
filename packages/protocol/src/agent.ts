import type { ActionRiskClass } from '@lumacast/commands';
import { ACTION_RISK_CLASSES } from '@lumacast/commands';
import { fail, isRecord, expectString, expectEnum, rejectUnknownKeys, type CodecContext } from './codecs';

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/**
 * The LLM providers the in-app agent and the MCP server can be configured
 * against. `openai-compatible` covers any self-hosted or third-party
 * endpoint that speaks the OpenAI chat-completions wire format.
 */
export type AgentProviderId = 'anthropic' | 'openai' | 'google' | 'openrouter' | 'opencode' | 'openai-compatible';

export const AGENT_PROVIDER_IDS: readonly AgentProviderId[] = ['anthropic', 'openai', 'google', 'openrouter', 'opencode', 'openai-compatible'];

/** Static display/config metadata for one provider, independent of any user's stored credentials. */
export interface AgentProviderInfo {
  id: AgentProviderId;
  label: string;
  /** Whether the user must supply their own base URL (no usable fixed endpoint). */
  requiresBaseUrl: boolean;
  defaultBaseUrl: string | null;
  docsUrl: string;
}

export const AGENT_PROVIDERS: readonly AgentProviderInfo[] = [
  { id: 'anthropic', label: 'Anthropic', requiresBaseUrl: false, defaultBaseUrl: null, docsUrl: 'https://docs.anthropic.com/en/api/getting-started' },
  { id: 'openai', label: 'OpenAI', requiresBaseUrl: false, defaultBaseUrl: null, docsUrl: 'https://platform.openai.com/docs/api-reference' },
  { id: 'google', label: 'Google (Gemini)', requiresBaseUrl: false, defaultBaseUrl: null, docsUrl: 'https://ai.google.dev/gemini-api/docs' },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    requiresBaseUrl: false,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    docsUrl: 'https://openrouter.ai/docs',
  },
  {
    id: 'opencode',
    label: 'OpenCode Zen',
    requiresBaseUrl: false,
    defaultBaseUrl: 'https://opencode.ai/zen/v1',
    docsUrl: 'https://opencode.ai/docs/zen',
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible',
    requiresBaseUrl: true,
    defaultBaseUrl: null,
    docsUrl: 'https://platform.openai.com/docs/api-reference',
  },
];

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/** How an agent principal may act for one risk class: proceed silently, prompt first, or refuse. */
export type AgentPermissionDecision = 'auto' | 'ask' | 'deny';

const AGENT_PERMISSION_DECISIONS: readonly AgentPermissionDecision[] = ['auto', 'ask', 'deny'];

/** One decision per `ActionRiskClass` (`@lumacast/commands`), covering every action an agent principal might call. */
export type AgentPermissionMatrix = Record<ActionRiskClass, AgentPermissionDecision>;

/**
 * A named, pre-built permission matrix a user can pick instead of tuning
 * each risk class by hand. `matrixForTier`/`tierForMatrix` convert between a
 * tier id and its matrix; a matrix matching none of these tiers is "custom"
 * (surfaced in the UI, represented here as `null`).
 */
export type AgentPermissionTier =
  | 'off'
  | 'read-only'
  | 'ask-everything'
  | 'content'
  | 'content-and-files'
  | 'all-but-broadcast'
  | 'unrestricted';

function buildMatrix(
  read: AgentPermissionDecision,
  write: AgentPermissionDecision,
  destructive: AgentPermissionDecision,
  broadcast: AgentPermissionDecision,
  filesystem: AgentPermissionDecision,
): AgentPermissionMatrix {
  return { read, write, destructive, broadcast, filesystem };
}

export const AGENT_PERMISSION_TIERS: readonly { id: AgentPermissionTier; label: string; matrix: AgentPermissionMatrix }[] = [
  { id: 'off', label: 'Off', matrix: buildMatrix('deny', 'deny', 'deny', 'deny', 'deny') },
  { id: 'read-only', label: 'Read-only', matrix: buildMatrix('auto', 'deny', 'deny', 'deny', 'deny') },
  { id: 'ask-everything', label: 'Ask for everything', matrix: buildMatrix('auto', 'ask', 'ask', 'ask', 'ask') },
  { id: 'content', label: 'Content', matrix: buildMatrix('auto', 'auto', 'ask', 'ask', 'ask') },
  { id: 'content-and-files', label: 'Content and files', matrix: buildMatrix('auto', 'auto', 'ask', 'ask', 'auto') },
  { id: 'all-but-broadcast', label: 'All but broadcast', matrix: buildMatrix('auto', 'auto', 'auto', 'ask', 'auto') },
  { id: 'unrestricted', label: 'Unrestricted', matrix: buildMatrix('auto', 'auto', 'auto', 'auto', 'auto') },
];

/** Looks up a tier's matrix. Every `AgentPermissionTier` has exactly one entry, so this never fails. */
export function matrixForTier(tier: AgentPermissionTier): AgentPermissionMatrix {
  const entry = AGENT_PERMISSION_TIERS.find((candidate) => candidate.id === tier);
  if (!entry) throw new Error(`Unknown agent permission tier: ${tier}`);
  return { ...entry.matrix };
}

/** Reverse lookup: the tier whose matrix exactly matches this one, or `null` when it's a custom mix. */
export function tierForMatrix(matrix: AgentPermissionMatrix): AgentPermissionTier | null {
  const entry = AGENT_PERMISSION_TIERS.find((candidate) =>
    ACTION_RISK_CLASSES.every((riskClass) => candidate.matrix[riskClass] === matrix[riskClass]),
  );
  return entry ? entry.id : null;
}

/** Permission settings for one principal (the in-app agent, or one MCP client). */
export interface AgentPrincipalPermissions {
  matrix: AgentPermissionMatrix;
  /** Whether destructive/broadcast actions show a confirming safety interlock before running, even when `auto`. */
  showSafetyInterlock: boolean;
}

/** An MCP client that has connected to this app's MCP server, with its own permission grant. */
export interface AgentMcpClient {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
  permissions: AgentPrincipalPermissions;
  /**
   * SHA-256 (lowercase hex) of the bearer token this client authenticates
   * with. The token itself is shown to the user exactly once, at creation,
   * and is never stored: a stolen config file therefore yields no usable
   * credential. `verifyMcpToken`
   * (`app/main/agent/permission-policy.ts`) hashes an inbound token and
   * compares it here in constant time.
   */
  tokenHash: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Persisted agent configuration: provider/model selection, custom instructions, and permission grants. */
export interface AgentConfig {
  version: 1;
  provider: AgentProviderId | null;
  model: string | null;
  baseUrl: string | null;
  /** The user's custom system instructions, prepended to every agent conversation. */
  instructions: string;
  /** Permissions for the in-app agent (chat panel), as opposed to external MCP clients. */
  inApp: AgentPrincipalPermissions;
  mcp: {
    enabled: boolean;
    clients: AgentMcpClient[];
    /**
     * Loopback TCP port the MCP host binds to. `null` means ephemeral (the
     * host asks the OS for a free port and reports back which one it got).
     * The default is a fixed, memorable port so a paste-once `mcp-remote`
     * config snippet keeps working across restarts; the host still falls
     * back to an ephemeral port itself if this one is already taken.
     */
    port: number | null;
  };
  /**
   * Absolute directories the user has granted for agent-originated filesystem
   * reads (import-by-path, document-text-extraction) — the same access a
   * user gesture like a picker or drop already has implicitly, extended to
   * an external agent that calls those tools directly. Enforced by
   * `PathAuthorizer` (`app/main/agent/path-authorization.ts`), not here.
   */
  filesystem: { allowedRoots: string[] };
}

function defaultFilesystemConfig(): AgentConfig['filesystem'] {
  return { allowedRoots: [] };
}

/** Fixed default loopback port for the MCP host; see `AgentConfig.mcp.port`. */
export const DEFAULT_MCP_PORT = 43117;

export function createDefaultAgentConfig(): AgentConfig {
  return {
    version: 1,
    provider: null,
    model: null,
    baseUrl: null,
    instructions: '',
    inApp: { matrix: matrixForTier('content'), showSafetyInterlock: true },
    mcp: { enabled: false, clients: [], port: DEFAULT_MCP_PORT },
    filesystem: defaultFilesystemConfig(),
  };
}

/** A patch applied via `AgentConfigStore.update`. `version` is fixed; `mcp` merges shallowly rather than replacing wholesale. */
export type AgentConfigUpdate = Partial<Omit<AgentConfig, 'version' | 'mcp'>> & { mcp?: Partial<AgentConfig['mcp']> };

// ---------------------------------------------------------------------------
// Credentials and models
// ---------------------------------------------------------------------------

/** Whether a provider has a stored key, without ever exposing the key itself. */
export interface AgentCredentialStatus {
  provider: AgentProviderId;
  hasKey: boolean;
  /** Last 4 characters of the key, so the user can recognize which key is stored. */
  keyHint: string | null;
}

export interface AgentModelInfo {
  id: string;
  label: string;
  contextWindow: number | null;
  /** Maximum value for the provider's per-request output-token cap (`max_tokens`/`maxOutputTokens`), or `null` when the provider doesn't report one. */
  maxOutputTokens: number | null;
  supportsTools: boolean;
  /** Whether authoritative catalog metadata reports zero input and output cost for this model. */
  isFree: boolean;
}

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

function child(context: CodecContext, segment: string): CodecContext {
  return { ...context, path: context.path ? `${context.path}.${segment}` : segment };
}

function expectNullableString(value: unknown, context: CodecContext, field: string): void {
  if (value !== null && typeof value !== 'string') {
    fail(child(context, field), `must be a string or null, got ${typeof value === 'string' ? value : String(value)}`);
  }
}

/** `null` means ephemeral; otherwise a valid TCP port number. */
function decodeMcpPort(value: unknown, context: CodecContext, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
    fail(child(context, field), `must be an integer between 1 and 65535, or null, got ${String(value)}`);
  }
  return value as number;
}

function decodePermissionMatrix(value: unknown, context: CodecContext): AgentPermissionMatrix {
  if (!isRecord(value)) fail(context, 'permission matrix must be an object');
  rejectUnknownKeys(value, context, ACTION_RISK_CLASSES);
  const result = {} as AgentPermissionMatrix;
  for (const riskClass of ACTION_RISK_CLASSES) {
    result[riskClass] = expectEnum(value[riskClass], context, riskClass, AGENT_PERMISSION_DECISIONS);
  }
  return result;
}

export function decodeAgentPrincipalPermissions(value: unknown, context: CodecContext): AgentPrincipalPermissions {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['matrix', 'showSafetyInterlock']);
  const matrix = decodePermissionMatrix(value.matrix, child(context, 'matrix'));
  if (typeof value.showSafetyInterlock !== 'boolean') {
    fail(child(context, 'showSafetyInterlock'), `must be a boolean, got ${String(value.showSafetyInterlock)}`);
  }
  return { matrix, showSafetyInterlock: value.showSafetyInterlock };
}

/**
 * Optional on decode: a config file written before this field existed has no
 * `filesystem` key at all, and must still load rather than being discarded
 * as invalid — so the caller only invokes this when the key is present, and
 * falls back to `defaultFilesystemConfig()` otherwise.
 */
function decodeFilesystemConfig(value: unknown, context: CodecContext): AgentConfig['filesystem'] {
  if (!isRecord(value)) fail(context, 'must be an object');
  rejectUnknownKeys(value, context, ['allowedRoots']);
  if (!Array.isArray(value.allowedRoots)) {
    fail(child(context, 'allowedRoots'), `must be an array, got ${String(value.allowedRoots)}`);
  }
  const allowedRoots = value.allowedRoots.map((root, index) =>
    expectString(root, context, `allowedRoots[${index}]`),
  );
  return { allowedRoots };
}

export function decodeAgentMcpClient(value: unknown, context: CodecContext): AgentMcpClient {
  if (!isRecord(value)) fail(context, 'mcp client must be an object');
  rejectUnknownKeys(value, context, ['id', 'name', 'createdAt', 'lastSeenAt', 'permissions', 'tokenHash']);
  expectString(value.id, context, 'id');
  expectString(value.name, context, 'name');
  expectString(value.createdAt, context, 'createdAt');
  expectNullableString(value.lastSeenAt, context, 'lastSeenAt');
  expectString(value.tokenHash, context, 'tokenHash');
  const permissions = decodeAgentPrincipalPermissions(value.permissions, child(context, 'permissions'));
  return {
    id: value.id as string,
    name: value.name as string,
    createdAt: value.createdAt as string,
    lastSeenAt: value.lastSeenAt as string | null,
    permissions,
    tokenHash: value.tokenHash as string,
  };
}

/** Full-object decoder for `AgentConfig` (issue: agent config store). Used to validate the persisted config file on load. */
export function decodeAgentConfig(value: unknown, context: CodecContext): AgentConfig {
  if (!isRecord(value)) fail(context, 'agent config must be an object');
  rejectUnknownKeys(value, context, ['version', 'provider', 'model', 'baseUrl', 'instructions', 'inApp', 'mcp', 'filesystem']);

  if (value.version !== 1) fail(child(context, 'version'), `must be 1, got ${String(value.version)}`);
  if (value.provider !== null) expectEnum(value.provider, context, 'provider', AGENT_PROVIDER_IDS);
  expectNullableString(value.model, context, 'model');
  expectNullableString(value.baseUrl, context, 'baseUrl');
  expectString(value.instructions, context, 'instructions');
  const inApp = decodeAgentPrincipalPermissions(value.inApp, child(context, 'inApp'));

  const mcpValue = value.mcp;
  const mcpContext = child(context, 'mcp');
  if (!isRecord(mcpValue)) fail(mcpContext, 'must be an object');
  rejectUnknownKeys(mcpValue, mcpContext, ['enabled', 'clients', 'port']);
  if (typeof mcpValue.enabled !== 'boolean') {
    fail(child(mcpContext, 'enabled'), `must be a boolean, got ${String(mcpValue.enabled)}`);
  }
  if (!Array.isArray(mcpValue.clients)) {
    fail(child(mcpContext, 'clients'), `must be an array, got ${String(mcpValue.clients)}`);
  }
  const clients = mcpValue.clients.map((client, index) => decodeAgentMcpClient(client, child(mcpContext, `clients[${index}]`)));
  // Optional: a config file written before this field existed has no `port`
  // key, and must still load rather than being rejected.
  const port = mcpValue.port !== undefined ? decodeMcpPort(mcpValue.port, mcpContext, 'port') : DEFAULT_MCP_PORT;

  // Optional: a config file written before this field existed has no
  // `filesystem` key, and must still load rather than being rejected.
  const filesystem =
    value.filesystem !== undefined
      ? decodeFilesystemConfig(value.filesystem, child(context, 'filesystem'))
      : defaultFilesystemConfig();

  return {
    version: 1,
    provider: (value.provider as AgentProviderId | null) ?? null,
    model: value.model as string | null,
    baseUrl: value.baseUrl as string | null,
    instructions: value.instructions as string,
    inApp,
    mcp: { enabled: mcpValue.enabled, clients, port },
    filesystem,
  };
}

/** Partial decoder for `AgentConfigUpdate`. Every field is optional; only the fields present are validated and returned. */
export function decodeAgentConfigUpdate(value: unknown, context: CodecContext): AgentConfigUpdate {
  if (!isRecord(value)) fail(context, 'agent config update must be an object');
  rejectUnknownKeys(value, context, ['provider', 'model', 'baseUrl', 'instructions', 'inApp', 'mcp', 'filesystem']);

  const update: AgentConfigUpdate = {};

  if (value.provider !== undefined) {
    if (value.provider !== null) expectEnum(value.provider, context, 'provider', AGENT_PROVIDER_IDS);
    update.provider = value.provider as AgentProviderId | null;
  }
  if (value.model !== undefined) {
    expectNullableString(value.model, context, 'model');
    update.model = value.model as string | null;
  }
  if (value.baseUrl !== undefined) {
    expectNullableString(value.baseUrl, context, 'baseUrl');
    update.baseUrl = value.baseUrl as string | null;
  }
  if (value.instructions !== undefined) {
    expectString(value.instructions, context, 'instructions');
    update.instructions = value.instructions as string;
  }
  if (value.inApp !== undefined) {
    update.inApp = decodeAgentPrincipalPermissions(value.inApp, child(context, 'inApp'));
  }
  if (value.mcp !== undefined) {
    const mcpValue = value.mcp;
    const mcpContext = child(context, 'mcp');
    if (!isRecord(mcpValue)) fail(mcpContext, 'must be an object');
    rejectUnknownKeys(mcpValue, mcpContext, ['enabled', 'clients', 'port']);

    const mcpUpdate: Partial<AgentConfig['mcp']> = {};
    if (mcpValue.enabled !== undefined) {
      if (typeof mcpValue.enabled !== 'boolean') {
        fail(child(mcpContext, 'enabled'), `must be a boolean, got ${String(mcpValue.enabled)}`);
      }
      mcpUpdate.enabled = mcpValue.enabled;
    }
    if (mcpValue.clients !== undefined) {
      if (!Array.isArray(mcpValue.clients)) {
        fail(child(mcpContext, 'clients'), `must be an array, got ${String(mcpValue.clients)}`);
      }
      mcpUpdate.clients = mcpValue.clients.map((client, index) =>
        decodeAgentMcpClient(client, child(mcpContext, `clients[${index}]`)),
      );
    }
    if (mcpValue.port !== undefined) {
      mcpUpdate.port = decodeMcpPort(mcpValue.port, mcpContext, 'port');
    }
    update.mcp = mcpUpdate;
  }
  if (value.filesystem !== undefined) {
    update.filesystem = decodeFilesystemConfig(value.filesystem, child(context, 'filesystem'));
  }

  return update;
}

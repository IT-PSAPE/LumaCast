// The wire contract for the in-app agent runtime: the streamed events one
// agent run emits, and the input shape of every `agent:*` RPC the renderer
// can call.
//
// `agent-actions.ts` covers main → renderer *action dispatch* (ADR-0037).
// This module covers the opposite direction: the renderer driving the model
// loop that lives in main (ADR-0038). Model calls, provider credentials, and
// filesystem authorization all stay in main; the renderer only sends text,
// receives stream events, and renders them.
//
// Every input type here has a decoder below. Main is the trusted side of the
// action-dispatch protocol but the *untrusted* side of this one — every one
// of these values originates in the renderer — so each `agent:*` handler
// decodes before it touches a store, a provider, or the filesystem.
import type { Id } from '@lumacast/kernel';
import type { MediaAssetType } from '@lumacast/composition';
import type {
  AgentMcpClient,
  AgentPermissionTier,
  AgentPrincipalPermissions,
  AgentProviderId,
} from './agent';
import { AGENT_PERMISSION_TIERS, AGENT_PROVIDER_IDS, decodeAgentPrincipalPermissions } from './agent';
import type { AgentMessage, AgentMessagePart } from './agent-threads';
import { fail, isRecord, expectString, expectEnum, rejectUnknownKeys, type CodecContext } from './codecs';

// ---------------------------------------------------------------------------
// Run events
// ---------------------------------------------------------------------------

/**
 * Why a run stopped producing output. `not-configured`/`no-credential`/
 * `invalid-model`/`agent-disabled` are precondition failures raised before any
 * provider call; the rest mirror `ProviderErrorCode`
 * (`app/main/agent/providers/types.ts`) plus `internal` for a bug in the loop
 * itself.
 */
export type AgentRunErrorCode =
  | 'not-configured'
  | 'no-credential'
  | 'invalid-model'
  | 'agent-disabled'
  | 'auth'
  | 'rate_limit'
  | 'network'
  | 'provider'
  | 'aborted'
  | 'internal';

export const AGENT_RUN_ERROR_CODES: readonly AgentRunErrorCode[] = [
  'not-configured',
  'no-credential',
  'invalid-model',
  'agent-disabled',
  'auth',
  'rate_limit',
  'network',
  'provider',
  'aborted',
  'internal',
];

export type AgentRunFinishReason = 'completed' | 'stopped' | 'error' | 'max_iterations';

/**
 * One streamed update from an in-flight agent run, delivered over
 * `AGENT_EVENTS.threadEvent`. A run always ends with exactly one
 * `run_finished`, and always emits `message_completed` for its assistant
 * message first — even when it failed — so the renderer never has to
 * reconcile a half-streamed message against the persisted thread.
 */
export type AgentThreadEvent =
  | { type: 'run_started'; threadId: Id; runId: string; assistantMessageId: Id }
  | { type: 'text_delta'; threadId: Id; messageId: Id; text: string }
  | { type: 'tool_call_updated'; threadId: Id; messageId: Id; part: Extract<AgentMessagePart, { type: 'tool_call' }> }
  | { type: 'message_completed'; threadId: Id; message: AgentMessage }
  | { type: 'run_error'; threadId: Id; code: AgentRunErrorCode; message: string }
  | { type: 'run_finished'; threadId: Id; runId: string; reason: AgentRunFinishReason };

// ---------------------------------------------------------------------------
// RPC input shapes
// ---------------------------------------------------------------------------

export interface AgentSendMessageInput {
  threadId: Id;
  text: string;
}

/** Addresses one thread, for the RPCs whose only argument is which thread. */
export interface AgentThreadIdInput {
  id: Id;
}

export interface AgentRenameThreadInput {
  id: Id;
  title: string;
}

/** `null`/`null` clears the per-thread override and falls back to the config's provider/model. */
export interface AgentSetThreadModelInput {
  id: Id;
  provider: AgentProviderId | null;
  model: string | null;
}

export interface AgentSetCredentialInput {
  provider: AgentProviderId;
  apiKey: string;
}

export interface AgentProviderInput {
  provider: AgentProviderId;
}

export interface AgentListModelsInput {
  provider: AgentProviderId;
  baseUrl?: string | null;
  /** Bypass the saved catalog when the user explicitly asks to refresh. */
  refresh?: boolean;
}

export interface AgentValidateModelInput {
  provider: AgentProviderId;
  model: string;
  baseUrl?: string | null;
}

/** `unknown` means the provider offers no way to check — not that the model is bad. */
export type AgentModelValidation = 'valid' | 'not-found' | 'unknown';

export interface AgentFilesystemRootInput {
  path: string;
}

export interface AgentImportMediaInput {
  path: string;
  name?: string;
  type?: MediaAssetType;
}

export interface AgentReplaceMediaSourceInput {
  id: Id;
  path: string;
}

export interface AgentExtractDocumentInput {
  path: string;
  maxChars?: number;
}

/** The agent-facing projection of `DocumentExtractionResult` (`app/main/agent/document-extraction.ts`). */
export interface AgentDocumentText {
  fileName: string;
  kind: string;
  text: string;
  charCount: number;
  truncated: boolean;
  pageCount: number | null;
  title: string | null;
}

// ---------------------------------------------------------------------------
// MCP host
// ---------------------------------------------------------------------------

export interface AgentMcpStatus {
  enabled: boolean;
  running: boolean;
  port: number | null;
  endpoint: string | null;
  clients: AgentMcpClient[];
  lastError: string | null;
}

export interface AgentMcpEnabledInput {
  enabled: boolean;
}

export interface AgentMcpClientCreateInput {
  name: string;
  tier?: AgentPermissionTier;
}

/**
 * The one and only time the bearer token is readable. It is hashed into
 * `client.tokenHash` and discarded; a user who loses it revokes the client
 * and creates another.
 */
export interface AgentMcpClientCreated {
  client: AgentMcpClient;
  token: string;
  /** A ready-to-paste Claude Desktop `mcpServers` entry pointing at this app's endpoint. */
  configSnippet: string;
}

export interface AgentMcpClientIdInput {
  clientId: string;
}

export interface AgentMcpClientPermissionsInput {
  clientId: string;
  permissions: AgentPrincipalPermissions;
}

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

const AGENT_PERMISSION_TIER_IDS: readonly AgentPermissionTier[] = AGENT_PERMISSION_TIERS.map((tier) => tier.id);

const MEDIA_ASSET_TYPES: readonly MediaAssetType[] = ['image', 'video', 'audio'];

function child(context: CodecContext, segment: string): CodecContext {
  return { ...context, path: context.path ? `${context.path}.${segment}` : segment };
}

function expectRecord(value: unknown, context: CodecContext, what: string): Record<string, unknown> {
  if (!isRecord(value)) fail(context, `${what} must be an object`);
  return value;
}

function expectNonEmptyString(value: unknown, context: CodecContext, field: string): string {
  const text = expectString(value, context, field);
  if (text.length === 0) fail(child(context, field), 'must not be empty');
  return text;
}

/** Optional `baseUrl`: absent and explicit `null` both mean "use the provider default". */
function decodeOptionalBaseUrl(value: unknown, context: CodecContext): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return expectString(value, context, 'baseUrl');
}

export function decodeAgentSendMessageInput(value: unknown, context: CodecContext): AgentSendMessageInput {
  const record = expectRecord(value, context, 'agent send message input');
  rejectUnknownKeys(record, context, ['threadId', 'text']);
  return {
    threadId: expectNonEmptyString(record.threadId, context, 'threadId') as Id,
    text: expectString(record.text, context, 'text'),
  };
}

export function decodeAgentThreadIdInput(value: unknown, context: CodecContext): AgentThreadIdInput {
  const record = expectRecord(value, context, 'agent thread id input');
  rejectUnknownKeys(record, context, ['id']);
  return { id: expectNonEmptyString(record.id, context, 'id') as Id };
}

export function decodeAgentRenameThreadInput(value: unknown, context: CodecContext): AgentRenameThreadInput {
  const record = expectRecord(value, context, 'agent rename thread input');
  rejectUnknownKeys(record, context, ['id', 'title']);
  return {
    id: expectNonEmptyString(record.id, context, 'id') as Id,
    title: expectString(record.title, context, 'title'),
  };
}

/**
 * `AgentThreadCreateInput` lives in `agent-threads.ts` (the store's own
 * vocabulary); its decoder lives here with the rest of the RPC trust
 * boundary rather than there, because the store is only ever fed values that
 * already crossed this boundary.
 */
export function decodeAgentThreadCreateInput(
  value: unknown,
  context: CodecContext,
): { title?: string; provider: AgentProviderId | null; model: string | null } {
  const record = expectRecord(value, context, 'agent thread create input');
  rejectUnknownKeys(record, context, ['title', 'provider', 'model']);
  const provider = record.provider === null ? null : expectEnum(record.provider, context, 'provider', AGENT_PROVIDER_IDS);
  const model = record.model === null ? null : expectString(record.model, context, 'model');
  if (record.title === undefined) return { provider, model };
  return { title: expectString(record.title, context, 'title'), provider, model };
}

export function decodeAgentSetThreadModelInput(value: unknown, context: CodecContext): AgentSetThreadModelInput {
  const record = expectRecord(value, context, 'agent set thread model input');
  rejectUnknownKeys(record, context, ['id', 'provider', 'model']);
  return {
    id: expectNonEmptyString(record.id, context, 'id') as Id,
    provider: record.provider === null ? null : expectEnum(record.provider, context, 'provider', AGENT_PROVIDER_IDS),
    model: record.model === null ? null : expectString(record.model, context, 'model'),
  };
}

export function decodeAgentSetCredentialInput(value: unknown, context: CodecContext): AgentSetCredentialInput {
  const record = expectRecord(value, context, 'agent set credential input');
  rejectUnknownKeys(record, context, ['provider', 'apiKey']);
  return {
    provider: expectEnum(record.provider, context, 'provider', AGENT_PROVIDER_IDS),
    apiKey: expectNonEmptyString(record.apiKey, context, 'apiKey'),
  };
}

export function decodeAgentProviderInput(value: unknown, context: CodecContext): AgentProviderInput {
  const record = expectRecord(value, context, 'agent provider input');
  rejectUnknownKeys(record, context, ['provider']);
  return { provider: expectEnum(record.provider, context, 'provider', AGENT_PROVIDER_IDS) };
}

export function decodeAgentListModelsInput(value: unknown, context: CodecContext): AgentListModelsInput {
  const record = expectRecord(value, context, 'agent list models input');
  rejectUnknownKeys(record, context, ['provider', 'baseUrl', 'refresh']);
  const provider = expectEnum(record.provider, context, 'provider', AGENT_PROVIDER_IDS);
  const baseUrl = decodeOptionalBaseUrl(record.baseUrl, context);
  const input: AgentListModelsInput = baseUrl === undefined ? { provider } : { provider, baseUrl };
  if (record.refresh !== undefined) {
    if (typeof record.refresh !== 'boolean') fail(context, 'refresh must be a boolean');
    input.refresh = record.refresh as boolean;
  }
  return input;
}

export function decodeAgentValidateModelInput(value: unknown, context: CodecContext): AgentValidateModelInput {
  const record = expectRecord(value, context, 'agent validate model input');
  rejectUnknownKeys(record, context, ['provider', 'model', 'baseUrl']);
  const provider = expectEnum(record.provider, context, 'provider', AGENT_PROVIDER_IDS);
  const model = expectNonEmptyString(record.model, context, 'model');
  const baseUrl = decodeOptionalBaseUrl(record.baseUrl, context);
  return baseUrl === undefined ? { provider, model } : { provider, model, baseUrl };
}

export function decodeAgentFilesystemRootInput(value: unknown, context: CodecContext): AgentFilesystemRootInput {
  const record = expectRecord(value, context, 'agent filesystem root input');
  rejectUnknownKeys(record, context, ['path']);
  return { path: expectNonEmptyString(record.path, context, 'path') };
}

export function decodeAgentImportMediaInput(value: unknown, context: CodecContext): AgentImportMediaInput {
  const record = expectRecord(value, context, 'agent import media input');
  rejectUnknownKeys(record, context, ['path', 'name', 'type']);
  const input: AgentImportMediaInput = { path: expectNonEmptyString(record.path, context, 'path') };
  if (record.name !== undefined) input.name = expectString(record.name, context, 'name');
  if (record.type !== undefined) input.type = expectEnum(record.type, context, 'type', MEDIA_ASSET_TYPES);
  return input;
}

export function decodeAgentReplaceMediaSourceInput(value: unknown, context: CodecContext): AgentReplaceMediaSourceInput {
  const record = expectRecord(value, context, 'agent replace media source input');
  rejectUnknownKeys(record, context, ['id', 'path']);
  return {
    id: expectNonEmptyString(record.id, context, 'id') as Id,
    path: expectNonEmptyString(record.path, context, 'path'),
  };
}

export function decodeAgentExtractDocumentInput(value: unknown, context: CodecContext): AgentExtractDocumentInput {
  const record = expectRecord(value, context, 'agent extract document input');
  rejectUnknownKeys(record, context, ['path', 'maxChars']);
  const input: AgentExtractDocumentInput = { path: expectNonEmptyString(record.path, context, 'path') };
  if (record.maxChars !== undefined) {
    if (typeof record.maxChars !== 'number' || !Number.isFinite(record.maxChars) || record.maxChars <= 0) {
      fail(child(context, 'maxChars'), `must be a positive finite number, got ${String(record.maxChars)}`);
    }
    input.maxChars = Math.floor(record.maxChars);
  }
  return input;
}

export function decodeAgentMcpEnabledInput(value: unknown, context: CodecContext): AgentMcpEnabledInput {
  const record = expectRecord(value, context, 'agent mcp enabled input');
  rejectUnknownKeys(record, context, ['enabled']);
  if (typeof record.enabled !== 'boolean') {
    fail(child(context, 'enabled'), `must be a boolean, got ${String(record.enabled)}`);
  }
  return { enabled: record.enabled };
}

export function decodeAgentMcpClientCreateInput(value: unknown, context: CodecContext): AgentMcpClientCreateInput {
  const record = expectRecord(value, context, 'agent mcp client create input');
  rejectUnknownKeys(record, context, ['name', 'tier']);
  const input: AgentMcpClientCreateInput = { name: expectNonEmptyString(record.name, context, 'name') };
  if (record.tier !== undefined) input.tier = expectEnum(record.tier, context, 'tier', AGENT_PERMISSION_TIER_IDS);
  return input;
}

export function decodeAgentMcpClientIdInput(value: unknown, context: CodecContext): AgentMcpClientIdInput {
  const record = expectRecord(value, context, 'agent mcp client id input');
  rejectUnknownKeys(record, context, ['clientId']);
  return { clientId: expectNonEmptyString(record.clientId, context, 'clientId') };
}

export function decodeAgentMcpClientPermissionsInput(
  value: unknown,
  context: CodecContext,
): AgentMcpClientPermissionsInput {
  const record = expectRecord(value, context, 'agent mcp client permissions input');
  rejectUnknownKeys(record, context, ['clientId', 'permissions']);
  return {
    clientId: expectNonEmptyString(record.clientId, context, 'clientId'),
    permissions: decodeAgentPrincipalPermissions(record.permissions, child(context, 'permissions')),
  };
}

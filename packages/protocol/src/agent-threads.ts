import type { Id } from '@lumacast/kernel';
import type { AgentProviderId } from './agent';
import { AGENT_PROVIDER_IDS } from './agent';
import { fail, isRecord, expectString, expectEnum, rejectUnknownKeys, type CodecContext } from './codecs';

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Lifecycle of one tool call the agent has issued, from proposal through to a terminal state. */
export type AgentToolCallStatus = 'pending' | 'awaiting_permission' | 'running' | 'succeeded' | 'failed' | 'denied' | 'cancelled';

const AGENT_TOOL_CALL_STATUSES: readonly AgentToolCallStatus[] = [
  'pending',
  'awaiting_permission',
  'running',
  'succeeded',
  'failed',
  'denied',
  'cancelled',
];

/**
 * One piece of an `AgentMessage`. A single message can interleave prose with
 * tool calls (and the errors they raise), so parts — not the message as a
 * whole — carry that structure.
 */
export type AgentMessagePart =
  | { type: 'text'; text: string }
  | {
      type: 'tool_call';
      callId: string;
      actionId: string;
      arguments: unknown;
      status: AgentToolCallStatus;
      result: unknown | null;
      error: string | null;
      startedAt: string | null;
      finishedAt: string | null;
    }
  | { type: 'error'; code: string; message: string };

const AGENT_MESSAGE_PART_TYPES = ['text', 'tool_call', 'error'] as const;

export type AgentMessageRole = 'user' | 'assistant';

const AGENT_MESSAGE_ROLES: readonly AgentMessageRole[] = ['user', 'assistant'];

/** Token accounting for one message, when the provider reports it. Either field may be unavailable even when the other is present. */
export interface AgentMessageUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface AgentMessage {
  id: Id;
  role: AgentMessageRole;
  parts: AgentMessagePart[];
  createdAt: string;
  usage: AgentMessageUsage | null;
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

/** Thread metadata without its message body — the shape a thread list renders. */
export interface AgentThreadSummary {
  id: Id;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  provider: AgentProviderId | null;
  model: string | null;
}

export interface AgentThread extends AgentThreadSummary {
  messages: AgentMessage[];
}

export interface AgentThreadCreateInput {
  title?: string;
  provider: AgentProviderId | null;
  model: string | null;
}

/** A patch applied via `AgentThreadStore.updateMessage`. Only the fields present are changed. */
export interface AgentMessagePatch {
  parts?: AgentMessagePart[];
  usage?: AgentMessageUsage | null;
}

const DEFAULT_THREAD_TITLE = 'New chat';
const MAX_THREAD_TITLE_LENGTH = 60;

/**
 * Derives a thread's display title from the first user message's text: the
 * first line, trimmed and whitespace-collapsed, capped at 60 characters
 * (truncated with a trailing '…' when longer). Falls back to `'New chat'`
 * when that leaves nothing (an empty or whitespace-only message).
 */
export function deriveThreadTitle(firstUserText: string): string {
  const firstLine = firstUserText.split(/\r?\n/, 1)[0] ?? '';
  const collapsed = firstLine.trim().replace(/\s+/g, ' ');
  if (collapsed.length === 0) return DEFAULT_THREAD_TITLE;
  if (collapsed.length <= MAX_THREAD_TITLE_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_THREAD_TITLE_LENGTH - 1)}…`;
}

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

function child(context: CodecContext, segment: string | number): CodecContext {
  return { ...context, path: context.path ? `${context.path}.${segment}` : String(segment) };
}

function expectNullableString(value: unknown, context: CodecContext, field: string): string | null {
  if (value === null) return null;
  return expectString(value, context, field);
}

function expectNullableFiniteNumber(value: unknown, context: CodecContext, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(child(context, field), `must be a finite number or null, got ${typeof value === 'string' ? value : String(value)}`);
  }
  return value;
}

function expectArrayField(value: unknown, context: CodecContext, field: string): unknown[] {
  if (!Array.isArray(value)) fail(child(context, field), `must be an array, got ${typeof value === 'string' ? value : String(value)}`);
  return value;
}

/** Accepts any value JSON can represent — the opaque shape of a tool call's `arguments`/`result`. */
function isJsonValue(value: unknown): boolean {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === 'string' || kind === 'boolean') return true;
  if (kind === 'number') return Number.isFinite(value as number);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isRecord(value)) return Object.values(value).every(isJsonValue);
  return false;
}

function expectJsonValue(value: unknown, context: CodecContext, field: string): unknown {
  if (!isJsonValue(value)) fail(child(context, field), `must be JSON-serialisable, got ${typeof value}`);
  return value;
}

function decodeAgentMessagePart(value: unknown, context: CodecContext): AgentMessagePart {
  if (!isRecord(value)) fail(context, 'message part must be an object');
  const type = expectEnum(value.type, context, 'type', AGENT_MESSAGE_PART_TYPES);

  if (type === 'text') {
    rejectUnknownKeys(value, context, ['type', 'text']);
    expectString(value.text, context, 'text');
    return { type: 'text', text: value.text as string };
  }

  if (type === 'tool_call') {
    rejectUnknownKeys(value, context, [
      'type',
      'callId',
      'actionId',
      'arguments',
      'status',
      'result',
      'error',
      'startedAt',
      'finishedAt',
    ]);
    expectString(value.callId, context, 'callId');
    expectString(value.actionId, context, 'actionId');
    const args = expectJsonValue(value.arguments, context, 'arguments');
    const status = expectEnum(value.status, context, 'status', AGENT_TOOL_CALL_STATUSES);
    const result = expectJsonValue(value.result, context, 'result');
    const error = expectNullableString(value.error, context, 'error');
    const startedAt = expectNullableString(value.startedAt, context, 'startedAt');
    const finishedAt = expectNullableString(value.finishedAt, context, 'finishedAt');
    return {
      type: 'tool_call',
      callId: value.callId as string,
      actionId: value.actionId as string,
      arguments: args,
      status,
      result,
      error,
      startedAt,
      finishedAt,
    };
  }

  // type === 'error'
  rejectUnknownKeys(value, context, ['type', 'code', 'message']);
  expectString(value.code, context, 'code');
  expectString(value.message, context, 'message');
  return { type: 'error', code: value.code as string, message: value.message as string };
}

function decodeAgentMessageUsage(value: unknown, context: CodecContext): AgentMessageUsage | null {
  if (value === null) return null;
  const usageContext = child(context, 'usage');
  if (!isRecord(value)) fail(usageContext, 'must be an object or null');
  rejectUnknownKeys(value, usageContext, ['inputTokens', 'outputTokens']);
  const inputTokens = expectNullableFiniteNumber(value.inputTokens, usageContext, 'inputTokens');
  const outputTokens = expectNullableFiniteNumber(value.outputTokens, usageContext, 'outputTokens');
  return { inputTokens, outputTokens };
}

/** Full-object decoder for `AgentMessage`. Used both standalone and as part of `decodeAgentThread`. */
export function decodeAgentMessage(value: unknown, context: CodecContext): AgentMessage {
  if (!isRecord(value)) fail(context, 'message must be an object');
  rejectUnknownKeys(value, context, ['id', 'role', 'parts', 'createdAt', 'usage']);
  expectString(value.id, context, 'id');
  const role = expectEnum(value.role, context, 'role', AGENT_MESSAGE_ROLES);
  const partsRaw = expectArrayField(value.parts, context, 'parts');
  const parts = partsRaw.map((part, index) => decodeAgentMessagePart(part, child(context, `parts[${index}]`)));
  expectString(value.createdAt, context, 'createdAt');
  const usage = decodeAgentMessageUsage(value.usage, context);

  return {
    id: value.id as Id,
    role,
    parts,
    createdAt: value.createdAt as string,
    usage,
  };
}

/** Full-object decoder for `AgentThread` (issue: agent thread store). Used to validate a persisted thread file on load. */
export function decodeAgentThread(value: unknown, context: CodecContext): AgentThread {
  if (!isRecord(value)) fail(context, 'thread must be an object');
  rejectUnknownKeys(value, context, ['id', 'title', 'createdAt', 'updatedAt', 'messageCount', 'provider', 'model', 'messages']);

  expectString(value.id, context, 'id');
  expectString(value.title, context, 'title');
  expectString(value.createdAt, context, 'createdAt');
  expectString(value.updatedAt, context, 'updatedAt');
  if (typeof value.messageCount !== 'number' || !Number.isFinite(value.messageCount)) {
    fail(child(context, 'messageCount'), `must be a finite number, got ${String(value.messageCount)}`);
  }
  if (value.provider !== null) expectEnum(value.provider, context, 'provider', AGENT_PROVIDER_IDS);
  expectNullableString(value.model, context, 'model');
  const messagesRaw = expectArrayField(value.messages, context, 'messages');
  const messages = messagesRaw.map((message, index) => decodeAgentMessage(message, child(context, `messages[${index}]`)));

  return {
    id: value.id as Id,
    title: value.title as string,
    createdAt: value.createdAt as string,
    updatedAt: value.updatedAt as string,
    messageCount: value.messageCount as number,
    provider: (value.provider as AgentProviderId | null) ?? null,
    model: value.model as string | null,
    messages,
  };
}

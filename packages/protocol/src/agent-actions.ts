// The action-dispatch wire contract between the main-process agent runtime
// (the in-app assistant and the MCP server) and the renderer.
//
// Main never touches the repository on an agent's behalf. It sends an
// `AgentActionRequest` to the renderer; the renderer validates permission,
// executes the action — through `window.castApi` for persistence actions or
// through renderer contexts for live-show/workbench actions — and answers with
// exactly one `AgentActionResponse` carrying the same `requestId`.
//
// Why the renderer executes: undo history lives there
// (`app/renderer/contexts/app-store.ts`), live-show verbs exist only there,
// and the store's `enqueueStoreWork` already serializes mutations. Routing an
// agent's writes through main would fork both of those.
//
// The response crosses back into main from the renderer, which is the
// untrusted side of the IPC boundary — hence `decodeAgentActionResponse`.
// Requests travel main → renderer and need no such decode.
import type { ActionId, ActionRiskClass } from '@lumacast/commands';
import { ACTION_RISK_CLASSES } from '@lumacast/commands';
import { fail, isRecord, expectString, expectEnum, rejectUnknownKeys, type CodecContext } from './codecs';

// ---------------------------------------------------------------------------
// Principals
// ---------------------------------------------------------------------------

/**
 * Who is asking. `in-app` is the assistant panel inside this window, scoped to
 * one chat thread; `mcp` is an external client connected to this app's MCP
 * server, identified by the id it was granted and the name it announced.
 */
export type AgentPrincipal =
  | { kind: 'in-app'; threadId: string }
  | { kind: 'mcp'; clientId: string; clientName: string };

/** Display name for a principal — what the permission prompt names as the asker. */
export function describeAgentPrincipal(principal: AgentPrincipal): string {
  return principal.kind === 'in-app' ? 'Assistant' : principal.clientName;
}

// ---------------------------------------------------------------------------
// Request / response
// ---------------------------------------------------------------------------

export interface AgentActionRequest {
  /** Correlates the response. Minted by the broker, unique per request. */
  requestId: string;
  principal: AgentPrincipal;
  actionId: ActionId;
  /** The action's parameter object. Shape is per-action; the renderer validates it. */
  params: unknown;
  /**
   * The permission decision main already resolved from the principal's
   * matrix. `deny` never reaches the renderer — main refuses those itself —
   * so only `auto` (run it) and `ask` (prompt first) cross this boundary.
   */
  decision: 'auto' | 'ask';
  /** Whether the principal's show-safety interlock is on (see `AgentPrincipalPermissions`). */
  interlockEnabled: boolean;
  /** The batch this request belongs to, or `null` for a standalone action. */
  batchId: string | null;
}

export type AgentActionDenialReason = 'user' | 'interlock' | 'invalid-params' | 'unknown-action';

export const AGENT_ACTION_DENIAL_REASONS: readonly AgentActionDenialReason[] = [
  'user',
  'interlock',
  'invalid-params',
  'unknown-action',
];

export type AgentActionOutcome = 'succeeded' | 'failed' | 'denied' | 'cancelled';

export const AGENT_ACTION_OUTCOMES: readonly AgentActionOutcome[] = ['succeeded', 'failed', 'denied', 'cancelled'];

export type AgentActionResponse =
  | {
      requestId: string;
      outcome: 'succeeded';
      result: unknown;
      /**
       * Set when the user answered "Always allow" at the prompt. Main records
       * a session grant for this risk class so the same principal stops being
       * asked; it is deliberately not persisted to the config file here.
       */
      alwaysAllow?: ActionRiskClass;
    }
  | { requestId: string; outcome: 'failed'; error: string; alwaysAllow?: ActionRiskClass }
  | { requestId: string; outcome: 'denied'; reason: AgentActionDenialReason }
  | { requestId: string; outcome: 'cancelled' };

/**
 * Brackets a run of actions that should collapse into one undo entry. The
 * renderer opens a history batch on `begin` and commits it on `end`.
 */
export interface AgentBatchEvent {
  batchId: string;
  phase: 'begin' | 'end';
  principal: AgentPrincipal;
}

/** Main withdrawing a request the renderer may still be holding (abort/disconnect). */
export interface AgentActionCancelledEvent {
  requestId: string;
}

// ---------------------------------------------------------------------------
// Result normalization
// ---------------------------------------------------------------------------

/**
 * What the renderer reports back for a mutation instead of a raw
 * `SnapshotPatch`. A patch carries whole rows for every table it touched,
 * which is both enormous and useless as LLM context; the ids that changed are
 * what an agent can actually act on next.
 */
export interface AgentChangeSummary {
  ok: true;
  changed: Record<string, { upserted: string[]; deleted: string[] }>;
}

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

function child(context: CodecContext, segment: string): CodecContext {
  return { ...context, path: context.path ? `${context.path}.${segment}` : segment };
}

/** Decodes an `AgentPrincipal`. Exported because both the response and the batch paths need it. */
export function decodeAgentPrincipal(value: unknown, context: CodecContext): AgentPrincipal {
  if (!isRecord(value)) fail(context, 'principal must be an object');
  const kind = expectEnum(value.kind, context, 'kind', ['in-app', 'mcp'] as const);
  if (kind === 'in-app') {
    rejectUnknownKeys(value, context, ['kind', 'threadId']);
    return { kind, threadId: expectString(value.threadId, context, 'threadId') };
  }
  rejectUnknownKeys(value, context, ['kind', 'clientId', 'clientName']);
  return {
    kind,
    clientId: expectString(value.clientId, context, 'clientId'),
    clientName: expectString(value.clientName, context, 'clientName'),
  };
}

function decodeAlwaysAllow(value: Record<string, unknown>, context: CodecContext): ActionRiskClass | undefined {
  if (value.alwaysAllow === undefined) return undefined;
  return expectEnum(value.alwaysAllow, context, 'alwaysAllow', ACTION_RISK_CLASSES);
}

/**
 * Main-side trust boundary for `agent:respondAction`. The renderer is the
 * untrusted side of this channel, so every field is checked before the broker
 * settles the pending request it names.
 *
 * `result` is deliberately left as `unknown`: it is per-action data the agent
 * runtime hands straight to the model, and the renderer already normalized
 * patches out of it. It is never interpreted as an instruction here.
 */
export function decodeAgentActionResponse(value: unknown, context: CodecContext): AgentActionResponse {
  if (!isRecord(value)) fail(context, 'agent action response must be an object');
  const requestId = expectString(value.requestId, context, 'requestId');
  const outcome = expectEnum(value.outcome, context, 'outcome', AGENT_ACTION_OUTCOMES);

  if (outcome === 'succeeded') {
    rejectUnknownKeys(value, context, ['requestId', 'outcome', 'result', 'alwaysAllow']);
    const alwaysAllow = decodeAlwaysAllow(value, context);
    return alwaysAllow === undefined
      ? { requestId, outcome, result: value.result }
      : { requestId, outcome, result: value.result, alwaysAllow };
  }

  if (outcome === 'failed') {
    rejectUnknownKeys(value, context, ['requestId', 'outcome', 'error', 'alwaysAllow']);
    const error = expectString(value.error, context, 'error');
    const alwaysAllow = decodeAlwaysAllow(value, context);
    return alwaysAllow === undefined ? { requestId, outcome, error } : { requestId, outcome, error, alwaysAllow };
  }

  if (outcome === 'denied') {
    rejectUnknownKeys(value, context, ['requestId', 'outcome', 'reason']);
    return { requestId, outcome, reason: expectEnum(value.reason, context, 'reason', AGENT_ACTION_DENIAL_REASONS) };
  }

  rejectUnknownKeys(value, context, ['requestId', 'outcome']);
  return { requestId, outcome };
}

/**
 * Renderer-side decode for an inbound request. Main is the trusted side of
 * this direction, so this is a shape assertion that keeps a malformed send
 * from corrupting the dispatcher queue, not a security boundary.
 */
export function decodeAgentActionRequest(value: unknown, context: CodecContext): AgentActionRequest {
  if (!isRecord(value)) fail(context, 'agent action request must be an object');
  rejectUnknownKeys(value, context, ['requestId', 'principal', 'actionId', 'params', 'decision', 'interlockEnabled', 'batchId']);
  if (typeof value.interlockEnabled !== 'boolean') {
    fail(child(context, 'interlockEnabled'), `must be a boolean, got ${String(value.interlockEnabled)}`);
  }
  if (value.batchId !== null && typeof value.batchId !== 'string') {
    fail(child(context, 'batchId'), `must be a string or null, got ${String(value.batchId)}`);
  }
  return {
    requestId: expectString(value.requestId, context, 'requestId'),
    principal: decodeAgentPrincipal(value.principal, child(context, 'principal')),
    actionId: expectString(value.actionId, context, 'actionId') as ActionId,
    params: value.params,
    decision: expectEnum(value.decision, context, 'decision', ['auto', 'ask'] as const),
    interlockEnabled: value.interlockEnabled,
    batchId: value.batchId,
  };
}

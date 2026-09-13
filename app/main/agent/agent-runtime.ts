import type { Id } from '@lumacast/kernel';
import { createId, nowIso } from '@lumacast/kernel';
import type { ActionId, ActionRiskClass } from '@lumacast/commands';
import { ACTION_METADATA, ACTION_RISK_CLASSES } from '@lumacast/commands';
import type {
  AgentActionResponse,
  AgentConfig,
  AgentMessage,
  AgentMessagePart,
  AgentMessageUsage,
  AgentPrincipal,
  AgentProviderId,
  AgentRunErrorCode,
  AgentRunFinishReason,
  AgentSendMessageInput,
  AgentThread,
  AgentThreadEvent,
} from '@lumacast/protocol';
import { CodecError, actionIdFromToolName, buildActionToolDefinitions, decodeActionParams, toolNameForAction } from '@lumacast/protocol';
import type { AgentActionBroker } from './action-broker';
import type { AgentConfigStore } from './agent-config-store';
import type { AgentCredentialStore } from './credential-store';
import type { AgentThreadStore } from './thread-store';
import { SessionGrants, decideAction, principalKey, resolvePrincipalPermissions } from './permission-policy';
import { createProviderAdapter } from './providers';
import type { AssistantPart, ProviderErrorCode, ProviderMessage, ProviderToolDefinition } from './providers';

/**
 * The in-app assistant's model loop (ADR-0038).
 *
 * Everything a provider call needs — the API key, the base URL, the streamed
 * HTTP response — stays in main. The renderer sends text and renders the
 * `AgentThreadEvent` stream this class emits; it never sees a credential and
 * never talks to a provider.
 *
 * Effects run the other way: the loop turns a model's tool call into an
 * `AgentActionRequest` and lets the renderer execute it (ADR-0037), so an
 * agent's writes land in the same undo history and the same mutation queue as
 * the user's own edits. One assistant turn's tool calls run sequentially
 * inside a single broker batch, which is what makes a twenty-action turn cost
 * the user exactly one Cmd-Z.
 */

/** Ceiling on assistant/tool round trips in one run, so a looping model cannot run forever. */
export const MAX_ITERATIONS = 25;

/** How often a still-streaming assistant message is flushed to disk. */
const PERSIST_INTERVAL_MS = 250;

/** Character cap on one tool result as the model sees it. The part stores the full value; only the model's copy is trimmed. */
const MAX_TOOL_RESULT_CHARS = 100 * 1024;

const TRUNCATION_SUFFIX = '[truncated]';

/**
 * Actions deliberately withheld from the in-app assistant.
 *
 * `project.getSnapshot` returns the entire database — it would blow the
 * context window on the first call and duplicates the read projections that
 * exist precisely to avoid it. The log and clipboard actions read data the
 * user did not put in the conversation (other sessions' logs, whatever they
 * last copied), which is not something a chat turn should be able to
 * exfiltrate on its own initiative.
 */
export const EXCLUDED_ACTION_IDS: ReadonlySet<ActionId> = new Set<ActionId>([
  'project.getSnapshot',
  'logs.listSessions',
  'logs.readSession',
  'logs.getCurrentPath',
  'logs.getSystemMetrics',
  'clipboard.read',
  'clipboard.write',
]);

const SYSTEM_PREAMBLE = [
  'You are the assistant built into LumaCast, a live presentation application.',
  'The user may be mid-service or mid-show while you work.',
  '',
  'Act through the tools you are given; do not describe changes you have not made.',
  '',
  'Look before you act. Use project_search, the *_list tools, and the *_get tools to find the',
  'real ids of playlists, items, slides, elements, media, themes, overlays, and stages before you',
  'change anything. Never guess or invent an id.',
  '',
  'Refer to media by its assetId, never by a file path or a URL.',
  '',
  'Destructive and broadcast actions (deleting things, taking a slide live, enabling an output)',
  'may prompt the user before they run. Say what you intend to do before you do it, so the prompt',
  'is not a surprise.',
  '',
  'Keep replies short — a sentence or two. When a task spans several steps, do all of them in one',
  'turn rather than asking the user to confirm each step.',
].join('\n');

// ---------------------------------------------------------------------------
// Injectable dependencies
// ---------------------------------------------------------------------------

// Structural subsets rather than the concrete classes, so a test can supply a
// scripted fake without constructing Electron-shaped stores.
export type AgentConfigStoreLike = Pick<AgentConfigStore, 'load'>;
export type AgentCredentialStoreLike = Pick<AgentCredentialStore, 'getKey'>;
export type AgentThreadStoreLike = Pick<AgentThreadStore, 'get' | 'appendMessage' | 'updateMessage'>;
export type AgentActionBrokerLike = Pick<AgentActionBroker, 'request' | 'beginBatch' | 'endBatch'>;

export interface AgentRuntimeDeps {
  configStore: AgentConfigStoreLike;
  credentialStore: AgentCredentialStoreLike;
  threadStore: AgentThreadStoreLike;
  broker: AgentActionBrokerLike;
  /**
   * Shared with the IPC layer so an "always allow" answered here is also
   * honoured by the MCP host. Defaults to a runtime-local instance.
   */
  grants?: SessionGrants;
  createAdapter?: typeof createProviderAdapter;
  emit: (event: AgentThreadEvent) => void;
  now?: () => string;
}

interface ActiveRun {
  runId: string;
  controller: AbortController;
}

type ToolCallPart = Extract<AgentMessagePart, { type: 'tool_call' }>;

interface PendingToolCall {
  part: ToolCallPart;
  /** `null` when the model named a tool that is not a known action. */
  actionId: ActionId | null;
  toolName: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAllDeny(matrix: AgentConfig['inApp']['matrix']): boolean {
  return ACTION_RISK_CLASSES.every((riskClass) => matrix[riskClass] === 'deny');
}

/** `undefined` is not JSON, and a thread file that contains it fails to decode on reload. */
function toJsonValue(value: unknown): unknown {
  return value === undefined ? null : value;
}

/** Serialises one tool result for the model, capped so a large read cannot swallow the context window. */
export function serialiseToolResult(value: unknown): string {
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value) ?? 'null';
    } catch {
      text = String(value);
    }
  }
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}${TRUNCATION_SUFFIX}`;
}

function runErrorCodeForProvider(code: ProviderErrorCode): AgentRunErrorCode {
  if (code === 'invalid_model') return 'invalid-model';
  return code;
}

function textOf(message: AgentMessage): string {
  return message.parts
    .filter((part): part is Extract<AgentMessagePart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function toolResultContent(part: ToolCallPart): { content: string; isError: boolean } {
  if (part.error !== null) return { content: serialiseToolResult({ error: part.error }), isError: true };
  return { content: serialiseToolResult(part.result), isError: false };
}

/**
 * Replays persisted thread history as provider-neutral turns. An assistant
 * message that issued tool calls becomes two provider messages — the
 * assistant turn, then the results for exactly those calls — because that is
 * the shape every provider's history expects.
 */
export function historyToProviderMessages(messages: readonly AgentMessage[]): ProviderMessage[] {
  const out: ProviderMessage[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      const text = textOf(message);
      if (text.length > 0) out.push({ role: 'user', content: text });
      continue;
    }

    const assistantParts: AssistantPart[] = [];
    const toolCalls: ToolCallPart[] = [];
    for (const part of message.parts) {
      if (part.type === 'text') {
        if (part.text.length > 0) assistantParts.push({ type: 'text', text: part.text });
        continue;
      }
      if (part.type !== 'tool_call') continue;
      toolCalls.push(part);
      assistantParts.push({
        type: 'tool_call',
        id: part.callId,
        name: toolNameForAction(part.actionId as ActionId),
        arguments: part.arguments,
        rawArguments: serialiseToolResult(part.arguments),
        parseError: null,
      });
    }
    if (assistantParts.length === 0) continue;
    out.push({ role: 'assistant', parts: assistantParts });
    if (toolCalls.length === 0) continue;
    out.push({
      role: 'tool_results',
      results: toolCalls.map((part) => ({ toolCallId: part.callId, ...toolResultContent(part) })),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export class AgentRuntime {
  private readonly deps: AgentRuntimeDeps;
  private readonly grants: SessionGrants;
  private readonly now: () => string;
  private readonly createAdapter: typeof createProviderAdapter;
  private readonly active = new Map<Id, ActiveRun>();

  constructor(deps: AgentRuntimeDeps) {
    this.deps = deps;
    this.grants = deps.grants ?? new SessionGrants();
    this.now = deps.now ?? nowIso;
    this.createAdapter = deps.createAdapter ?? createProviderAdapter;
  }

  isRunning(threadId: Id): boolean {
    return this.active.has(threadId);
  }

  /**
   * Starts a run and returns its id immediately; everything the run produces
   * arrives as `AgentThreadEvent`s. Rejects only for failures that are the
   * caller's fault and knowable synchronously (no such thread, a run already
   * in flight). A misconfigured provider or a missing key is the *run's*
   * failure, not the call's, so it is reported as a `run_error` event on the
   * thread the user is looking at.
   */
  async sendMessage(input: AgentSendMessageInput): Promise<{ runId: string }> {
    const { threadId, text } = input;
    if (this.active.has(threadId)) {
      throw new Error('This conversation already has a reply in progress.');
    }

    const thread = this.deps.threadStore.get(threadId);
    if (!thread) throw new Error('Thread not found');

    const runId = createId();
    const config = this.deps.configStore.load();

    const precondition = this.checkPreconditions(thread, config);
    if (precondition) {
      this.emit({ type: 'run_error', threadId, code: precondition.code, message: precondition.message });
      this.emit({ type: 'run_finished', threadId, runId, reason: 'error' });
      return { runId };
    }

    const controller = new AbortController();
    this.active.set(threadId, { runId, controller });
    // Deliberately not awaited: the run outlives this call and reports
    // through events.
    void this.run(thread, runId, text, config, controller).finally(() => {
      const current = this.active.get(threadId);
      if (current?.runId === runId) this.active.delete(threadId);
    });

    return { runId };
  }

  /** Aborts the provider stream and any in-flight action request for this thread. No-op when nothing is running. */
  stopGeneration(threadId: Id): void {
    this.active.get(threadId)?.controller.abort();
  }

  // --- Preconditions -----------------------------------------------------

  private checkPreconditions(
    thread: AgentThread,
    config: AgentConfig,
  ): { code: AgentRunErrorCode; message: string } | null {
    if (isAllDeny(config.inApp.matrix)) {
      return { code: 'agent-disabled', message: 'The assistant is turned off in settings.' };
    }
    const provider = thread.provider ?? config.provider;
    const model = thread.model ?? config.model;
    if (!provider || !model) {
      return { code: 'not-configured', message: 'Choose a provider and model for the assistant in settings.' };
    }
    if (!this.deps.credentialStore.getKey(provider)) {
      return { code: 'no-credential', message: `No API key is stored for ${provider}.` };
    }
    return null;
  }

  // --- The loop ----------------------------------------------------------

  private async run(
    thread: AgentThread,
    runId: string,
    text: string,
    config: AgentConfig,
    controller: AbortController,
  ): Promise<void> {
    const threadId = thread.id;
    const principal: AgentPrincipal = { kind: 'in-app', threadId };
    const key = principalKey(principal);
    const provider = (thread.provider ?? config.provider) as AgentProviderId;
    const model = (thread.model ?? config.model) as string;
    // Read through `getKey` rather than caching: that call is also what
    // registers the key with the log redactor.
    const apiKey = this.deps.credentialStore.getKey(provider) as string;

    this.deps.threadStore.appendMessage(threadId, {
      role: 'user',
      parts: [{ type: 'text', text }],
      usage: null,
    });
    const assistant = this.deps.threadStore.appendMessage(threadId, {
      role: 'assistant',
      parts: [],
      usage: null,
    });
    this.emit({ type: 'run_started', threadId, runId, assistantMessageId: assistant.id });

    const parts: AgentMessagePart[] = [];
    let usage: AgentMessageUsage | null = null;
    let lastPersistAt = 0;

    const persist = (): void => {
      lastPersistAt = Date.now();
      try {
        this.deps.threadStore.updateMessage(threadId, assistant.id, { parts: [...parts], usage });
      } catch (error) {
        console.warn('[AgentRuntime] Failed to persist assistant message:', error);
      }
    };

    let finish: AgentRunFinishReason | null = null;

    try {
      const permissions = resolvePrincipalPermissions(config, principal);
      if (!permissions) throw new Error('No permission settings for the in-app assistant.');

      const adapter = this.createAdapter(provider, { apiKey, baseUrl: config.baseUrl });
      const tools = this.buildTools();
      const system = await this.buildSystemPrompt(config, principal, controller.signal);

      const history = this.deps.threadStore.get(threadId);
      const messages: ProviderMessage[] = historyToProviderMessages(
        (history?.messages ?? []).filter((message) => message.id !== assistant.id),
      );

      for (let iteration = 0; iteration < MAX_ITERATIONS && finish === null; iteration += 1) {
        let currentText: Extract<AgentMessagePart, { type: 'text' }> | null = null;
        const turnCalls: PendingToolCall[] = [];
        let stopReason: string | null = null;
        let assistantTurn: AssistantPart[] = [];
        let streamError: { code: ProviderErrorCode; message: string } | null = null;

        for await (const event of adapter.chat({
          model,
          system,
          messages,
          tools,
          maxOutputTokens: null,
          signal: controller.signal,
        })) {
          if (event.type === 'text_delta') {
            if (!currentText) {
              currentText = { type: 'text', text: '' };
              parts.push(currentText);
            }
            currentText.text += event.text;
            this.emit({ type: 'text_delta', threadId, messageId: assistant.id, text: event.text });
            if (Date.now() - lastPersistAt >= PERSIST_INTERVAL_MS) persist();
            continue;
          }

          if (event.type === 'tool_call_end') {
            const actionId = actionIdFromToolName(event.name);
            const part: ToolCallPart = {
              type: 'tool_call',
              callId: event.id,
              actionId: actionId ?? event.name,
              arguments: toJsonValue(event.arguments),
              status: 'pending',
              result: null,
              error: null,
              startedAt: null,
              finishedAt: null,
            };
            parts.push(part);
            turnCalls.push({ part, actionId, toolName: event.name });
            currentText = null;
            this.emit({ type: 'tool_call_updated', threadId, messageId: assistant.id, part: { ...part } });
            continue;
          }

          if (event.type === 'usage') {
            usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
            continue;
          }

          if (event.type === 'done') {
            stopReason = event.stopReason;
            assistantTurn = event.assistant;
            continue;
          }

          if (event.type === 'error') {
            streamError = { code: event.code, message: event.message };
          }
        }

        persist();

        if (controller.signal.aborted) {
          finish = 'stopped';
          break;
        }

        if (streamError) {
          const code = runErrorCodeForProvider(streamError.code);
          parts.push({ type: 'error', code, message: streamError.message });
          persist();
          this.emit({ type: 'run_error', threadId, code, message: streamError.message });
          finish = 'error';
          break;
        }

        if (stopReason !== 'tool_use' || turnCalls.length === 0) {
          finish = 'completed';
          break;
        }

        const batchId = this.deps.broker.beginBatch(principal);
        const results: { toolCallId: string; content: string; isError: boolean }[] = [];
        try {
          for (const call of turnCalls) {
            // A stop mid-batch leaves the remaining calls `pending`; the
            // finish block below marks them cancelled in one pass.
            if (controller.signal.aborted) break;
            await this.executeToolCall(call, {
              threadId,
              messageId: assistant.id,
              principal,
              key,
              permissions,
              batchId,
              signal: controller.signal,
            });
            results.push({ toolCallId: call.part.callId, ...toolResultContent(call.part) });
          }
        } finally {
          this.deps.broker.endBatch(batchId, principal);
        }
        persist();

        if (assistantTurn.length > 0) messages.push({ role: 'assistant', parts: assistantTurn });
        messages.push({ role: 'tool_results', results });

        if (controller.signal.aborted) finish = 'stopped';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      parts.push({ type: 'error', code: 'internal', message });
      this.emit({ type: 'run_error', threadId, code: 'internal', message });
      finish = 'error';
    }

    if (finish === null) finish = 'max_iterations';

    if (finish === 'stopped') {
      for (const part of parts) {
        if (part.type !== 'tool_call') continue;
        // A call that already reached a terminal state keeps it; `finishedAt`
        // is the marker, so a call cancelled by the abort itself is not
        // re-announced here.
        if (part.finishedAt !== null) continue;
        part.status = 'cancelled';
        part.finishedAt = this.now();
        this.emit({ type: 'tool_call_updated', threadId, messageId: assistant.id, part: { ...part } });
      }
    }

    let finalMessage: AgentMessage = { ...assistant, parts: [...parts], usage };
    try {
      finalMessage = this.deps.threadStore.updateMessage(threadId, assistant.id, { parts: [...parts], usage });
    } catch (error) {
      console.warn('[AgentRuntime] Failed to persist final assistant message:', error);
    }

    this.emit({ type: 'message_completed', threadId, message: { ...finalMessage, parts: [...finalMessage.parts] } });
    this.emit({ type: 'run_finished', threadId, runId, reason: finish });
  }

  // --- One tool call -----------------------------------------------------

  private async executeToolCall(
    call: PendingToolCall,
    context: {
      threadId: Id;
      messageId: Id;
      principal: AgentPrincipal;
      key: string;
      permissions: NonNullable<ReturnType<typeof resolvePrincipalPermissions>>;
      batchId: string;
      signal: AbortSignal;
    },
  ): Promise<void> {
    const { part } = call;
    const settle = (status: ToolCallPart['status'], result: unknown, error: string | null): void => {
      part.status = status;
      part.result = toJsonValue(result);
      part.error = error;
      part.finishedAt = this.now();
      this.emit({ type: 'tool_call_updated', threadId: context.threadId, messageId: context.messageId, part: { ...part } });
    };

    part.startedAt = this.now();

    if (call.actionId === null) {
      settle('failed', null, `Unknown tool: ${call.toolName}`);
      return;
    }
    const actionId = call.actionId;

    // Invalid parameters are the model's mistake, not the user's: they are
    // answered as a tool error the model can correct on the next turn, and
    // never reach the renderer as a request the user would have to judge.
    let params: unknown;
    try {
      params = decodeActionParams(actionId, part.arguments, {
        boundary: 'agent-tool',
        operation: actionId,
        path: '',
      });
    } catch (error) {
      const message = error instanceof CodecError || error instanceof Error ? error.message : String(error);
      settle('failed', null, message);
      return;
    }

    const risk: ActionRiskClass = ACTION_METADATA[actionId].risk;
    const { decision, interlockEnabled } = decideAction(context.permissions, this.grants, context.key, risk);

    if (decision === 'deny') {
      settle('denied', null, 'Denied by permission settings');
      return;
    }

    part.status = decision === 'ask' ? 'awaiting_permission' : 'running';
    this.emit({ type: 'tool_call_updated', threadId: context.threadId, messageId: context.messageId, part: { ...part } });

    let response: AgentActionResponse;
    try {
      response = await this.deps.broker.request(
        {
          principal: context.principal,
          actionId,
          params,
          decision,
          interlockEnabled,
          batchId: context.batchId,
        },
        { signal: context.signal },
      );
    } catch (error) {
      settle('failed', null, error instanceof Error ? error.message : String(error));
      return;
    }

    if (response.outcome !== 'denied' && response.outcome !== 'cancelled' && response.alwaysAllow) {
      this.grants.grant(context.key, response.alwaysAllow);
    }

    if (response.outcome === 'succeeded') {
      settle('succeeded', response.result, null);
      return;
    }
    if (response.outcome === 'failed') {
      settle('failed', null, response.error);
      return;
    }
    if (response.outcome === 'denied') {
      settle('denied', null, `Denied by the user (${response.reason})`);
      return;
    }
    settle('cancelled', null, 'Cancelled');
  }

  // --- Prompt and tools --------------------------------------------------

  private buildTools(): ProviderToolDefinition[] {
    return buildActionToolDefinitions((id) => !EXCLUDED_ACTION_IDS.has(id)).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  /**
   * The preamble, then the user's own instructions, then a snapshot of what is
   * actually in the project. The overview is fetched through the same broker
   * every other read goes through; when it fails (no window yet, the user
   * denied it) the run proceeds without it rather than failing.
   */
  private async buildSystemPrompt(
    config: AgentConfig,
    principal: AgentPrincipal,
    signal: AbortSignal,
  ): Promise<string> {
    const sections = [SYSTEM_PREAMBLE];
    const instructions = config.instructions.trim();
    if (instructions.length > 0) sections.push(`User instructions:\n${instructions}`);

    try {
      const response = await this.deps.broker.request(
        {
          principal,
          actionId: 'project.getOverview' as ActionId,
          params: {},
          decision: 'auto',
          interlockEnabled: false,
          batchId: null,
        },
        { signal },
      );
      if (response.outcome === 'succeeded') {
        sections.push(`Current project:\n${serialiseToolResult(response.result)}`);
      }
    } catch (error) {
      console.warn('[AgentRuntime] Could not read the project overview for the system prompt:', error);
    }

    return sections.join('\n\n');
  }

  private emit(event: AgentThreadEvent): void {
    try {
      this.deps.emit(event);
    } catch (error) {
      console.warn('[AgentRuntime] Event listener threw:', error);
    }
  }
}

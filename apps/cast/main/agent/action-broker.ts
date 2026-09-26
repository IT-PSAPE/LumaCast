import type { BrowserWindow } from 'electron';
import { createId } from '@lumacast/kernel';
import { AGENT_ACTION_EVENTS, type AgentActionRequest, type AgentActionResponse, type AgentPrincipal } from '@lumacast/protocol';

/**
 * Default ceiling for an `auto` request. Generous, because a single action can
 * legitimately be slow (a bundle export, a large batch element write) — it
 * exists to stop a wedged renderer from pinning an agent run forever, not to
 * police normal latency.
 */
export const AGENT_ACTION_DEFAULT_TIMEOUT_MS = 120_000;

export interface AgentActionRequestOptions {
  /**
   * Overrides the default ceiling. An `ask` request has no timeout unless one
   * is passed here: it is waiting on a person, and a prompt left open over a
   * coffee break is not a failure.
   */
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface PendingRequest {
  settle: (response: AgentActionResponse) => void;
  dispose: () => void;
}

/**
 * The main-process half of the action-dispatch protocol: sends an
 * `AgentActionRequest` to the renderer and resolves when the matching
 * `AgentActionResponse` comes back through `agentRespondAction`.
 *
 * The returned promise always *resolves* with an `AgentActionResponse` — it
 * never rejects. A missing window or an expired timeout resolves as
 * `outcome: 'failed'` with a readable message; an aborted request resolves as
 * `outcome: 'cancelled'`. Agent runtimes fan this straight back to a model as
 * a tool result, so a uniform value is worth more than a thrown error at every
 * call site.
 *
 * The broker owns no permission logic. Main resolves the principal's matrix
 * before calling `request`; the renderer enforces the interlock and runs the
 * prompt. The broker only correlates requests with responses.
 */
export class AgentActionBroker {
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  /** Number of requests currently awaiting a renderer response. */
  get pendingCount(): number {
    return this.pending.size;
  }

  request(
    input: Omit<AgentActionRequest, 'requestId'>,
    options: AgentActionRequestOptions = {},
  ): Promise<AgentActionResponse> {
    const requestId = createId();
    const request: AgentActionRequest = { ...input, requestId };

    if (options.signal?.aborted) {
      return Promise.resolve({ requestId, outcome: 'cancelled' });
    }

    const target = this.liveWindow();
    if (!target) {
      return Promise.resolve({
        requestId,
        outcome: 'failed',
        error: `No application window is available to run ${input.actionId}.`,
      });
    }

    return new Promise<AgentActionResponse>((resolve) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const onAbort = () => {
        this.send(AGENT_ACTION_EVENTS.cancelled, { requestId });
        settle({ requestId, outcome: 'cancelled' });
      };

      const dispose = () => {
        if (timeoutId !== null) clearTimeout(timeoutId);
        options.signal?.removeEventListener('abort', onAbort);
        this.pending.delete(requestId);
      };

      const settle = (response: AgentActionResponse) => {
        if (settled) return;
        settled = true;
        dispose();
        resolve(response);
      };

      this.pending.set(requestId, { settle, dispose });
      options.signal?.addEventListener('abort', onAbort, { once: true });

      // An `ask` request is blocked on a human, so it only gets a deadline if
      // the caller explicitly sets one.
      const timeoutMs = options.timeoutMs ?? (input.decision === 'ask' ? null : AGENT_ACTION_DEFAULT_TIMEOUT_MS);
      if (timeoutMs !== null) {
        timeoutId = setTimeout(() => {
          settle({
            requestId,
            outcome: 'failed',
            error: `Timed out after ${timeoutMs}ms waiting for ${input.actionId}.`,
          });
        }, timeoutMs);
      }

      target.webContents.send(AGENT_ACTION_EVENTS.request, request);
    });
  }

  /** Opens an undo batch in the renderer and returns its id. */
  beginBatch(principal: AgentPrincipal): string {
    const batchId = createId();
    this.send(AGENT_ACTION_EVENTS.batch, { batchId, phase: 'begin', principal });
    return batchId;
  }

  /** Closes a batch opened by `beginBatch`. Safe to call when the window is gone. */
  endBatch(batchId: string, principal: AgentPrincipal): void {
    this.send(AGENT_ACTION_EVENTS.batch, { batchId, phase: 'end', principal });
  }

  /**
   * Settles the request a renderer response names. A response for an unknown
   * or already-settled `requestId` is dropped: it is a late answer to
   * something that already timed out or was cancelled, not an error.
   */
  handleResponse(response: AgentActionResponse): void {
    this.pending.get(response.requestId)?.settle(response);
  }

  /**
   * Fails every in-flight request. Called when the window the requests were
   * addressed to goes away, so nothing waits on a renderer that can no longer
   * answer.
   */
  abandonAll(reason: string): void {
    for (const [requestId, entry] of [...this.pending]) {
      entry.settle({ requestId, outcome: 'failed', error: reason });
    }
  }

  private liveWindow(): BrowserWindow | null {
    const target = this.getWindow();
    if (!target || target.isDestroyed()) return null;
    return target;
  }

  private send(channel: string, payload: unknown): void {
    this.liveWindow()?.webContents.send(channel, payload);
  }
}

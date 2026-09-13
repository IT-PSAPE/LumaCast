// The action dispatcher: the single gate every agent-originated change to this
// application passes through.
//
// Main (the in-app assistant runtime and the MCP server) never touches the
// repository. It sends an `AgentActionRequest`; this hook validates permission,
// executes, and answers with exactly one `AgentActionResponse`. Undo history,
// the live-show verbs, and the store's serialized mutation queue all live in
// the renderer, so this is where an agent's intent becomes an effect.
//
// Requests are processed strictly one at a time, in arrival order, because a
// model's next action routinely depends on the previous one's result. Batch
// begin/end events ride the same queue so a batch cannot close while the
// actions inside it are still pending.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Id } from '@lumacast/kernel';
import type { ActionId, ActionMetadata, ActionRiskClass } from '@lumacast/commands';
import { ACTION_METADATA } from '@lumacast/commands';
import type {
  AgentActionRequest,
  AgentActionResponse,
  AgentBatchEvent,
  AgentChangeSummary,
  ActionRpcBinding,
  MainActionId,
  RendererActionId,
  SnapshotPatch,
} from '@lumacast/protocol';
import { ACTION_RPC_BINDINGS, isSnapshotPatch } from '@lumacast/protocol';
import { useCast, useNdi } from '../../contexts/app-context';
import { useAssetEditor } from '../../contexts/asset-editor/asset-editor-context';
import { useElements } from '../../contexts/canvas/canvas-context';
import { useNavigation } from '../../contexts/navigation-context';
import { usePlayback } from '../../contexts/playback/playback-context';
import { usePlaybackSchedules } from '../../contexts/playback-schedules-context';
import { useSlides } from '../../contexts/slide-context';
import { useWorkbench } from '../../contexts/workbench-context';
import { usePanelRoute } from '../../components/layout/panel-split/split-panel';
import { useAutomation } from '../automation/automation-context';
import { useCommandPalette } from '../command-palette/command-palette-context';
import { useLyricEditor } from '../items/lyric-editor';
import { requestAgentPermission, denyAllAgentPermissionPrompts } from './agent-permission-dialog';
import { resolveAssetIdReferences } from './asset-id-resolution';
import {
  InvalidActionParamsError,
  executeRendererAction,
  type RendererActionContexts,
} from './renderer-action-executors';

type QueueItem =
  | { kind: 'action'; request: AgentActionRequest }
  | { kind: 'batch'; event: AgentBatchEvent };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function paramsRecord(params: unknown): Record<string, unknown> {
  if (params === undefined || params === null) return {};
  if (!isRecord(params)) throw new InvalidActionParamsError('params must be an object');
  return params;
}

// ─── Result normalization ───────────────────────────────────────────

/**
 * Replaces a `SnapshotPatch` with the ids it touched. A patch carries whole
 * rows for every table it wrote; handing that to a model burns context on data
 * it did not ask for and cannot act on. The ids are what a follow-up action
 * needs.
 */
function summarizePatch(patch: SnapshotPatch): AgentChangeSummary {
  const changed: AgentChangeSummary['changed'] = {};
  const entryFor = (table: string) => {
    const existing = changed[table];
    if (existing) return existing;
    const created = { upserted: [] as string[], deleted: [] as string[] };
    changed[table] = created;
    return created;
  };

  for (const [table, rows] of Object.entries(patch.upserts)) {
    if (!rows || rows.length === 0) continue;
    entryFor(table).upserted = rows.map((row) => row.id);
  }
  for (const [table, ids] of Object.entries(patch.deletes)) {
    if (!ids || ids.length === 0) continue;
    entryFor(table).deleted = [...ids];
  }
  return { ok: true, changed };
}

function asItemResult(value: unknown): { itemId: Id; patch: SnapshotPatch } | null {
  if (!isRecord(value) || typeof value.itemId !== 'string') return null;
  if (!isSnapshotPatch(value.patch)) return null;
  return { itemId: value.itemId as Id, patch: value.patch };
}

// ─── Main-site argument building ────────────────────────────────────

function buildArgs(binding: ActionRpcBinding, params: Record<string, unknown>): unknown[] {
  if (binding.args.length === 1 && binding.args[0] === 'input') return [params];
  const args = binding.args.map((field) => params[field]);
  // Trailing optionals (`position?`, `options?`) are dropped rather than sent
  // as explicit `undefined`, so the RPC sees the same shape a UI call makes.
  while (args.length > 0 && args[args.length - 1] === undefined) args.pop();
  return args;
}

type CastApiMethod = (...args: unknown[]) => Promise<unknown>;

async function invokeMainAction(actionId: MainActionId, params: Record<string, unknown>): Promise<unknown> {
  const binding = ACTION_RPC_BINDINGS[actionId];
  if (!binding.method) throw new Error('Not implemented');

  const resolved = binding.resolve ? binding.resolve(params) : null;
  const method = resolved ? resolved.method : binding.method;
  const args = resolved ? resolved.args : buildArgs(binding, params);

  const api = window.castApi as unknown as Record<string, CastApiMethod | undefined>;
  const call = api[method];
  if (typeof call !== 'function') throw new Error(`castApi.${method} is unavailable`);
  return call(...args);
}

// ─── Hook ───────────────────────────────────────────────────────────

/**
 * Mounted exactly once, by `<AgentActionDispatcher />` in `App.tsx`. Two
 * instances would each answer every request and race their responses.
 */
export function useAgentActionDispatcher(): void {
  const cast = useCast();
  const ndi = useNdi();
  const slides = useSlides();
  const navigation = useNavigation();
  const playback = usePlayback();
  const schedules = usePlaybackSchedules();
  const automation = useAutomation();
  const workbench = useWorkbench();
  const elements = useElements();
  const panelRoute = usePanelRoute();
  const commandPalette = useCommandPalette();
  const lyricEditor = useLyricEditor();
  const assetEditor = useAssetEditor();

  /**
   * Commits whatever the active editor has staged before an agent writes to
   * the same rows. Without this an agent's `element.update` lands underneath
   * an unpushed inspector edit, and the next `pushChanges` silently reverts
   * it. Each family is a no-op when it has nothing pending.
   */
  const flushStagedEdits = useCallback(async () => {
    for (const family of [assetEditor.theme, assetEditor.overlay, assetEditor.deck, assetEditor.stage]) {
      if (family.hasPendingChanges) await family.pushChanges();
    }
  }, [assetEditor]);

  const contexts = useMemo<RendererActionContexts>(() => ({
    cast,
    slides,
    navigation,
    playback,
    schedules,
    automation,
    workbench,
    elements,
    panelRoute,
    commandPalette,
    lyricEditor,
    flushStagedEdits,
  }), [
    automation, cast, commandPalette, elements, flushStagedEdits, lyricEditor,
    navigation, panelRoute, playback, schedules, slides, workbench,
  ]);

  // The processing loop is async and long-lived, so it reads contexts and
  // output state through refs rather than closing over one render's values.
  // `flushStagedEdits` gets its own ref for a second reason: `useAssetEditor`
  // composes four contexts into a fresh object on every render, so closing
  // over it would change `runAction`'s identity every render and tear the IPC
  // subscription down and up again — denying any permission prompt that was
  // open at the time.
  const contextsRef = useRef(contexts);
  contextsRef.current = contexts;
  const flushRef = useRef(flushStagedEdits);
  flushRef.current = flushStagedEdits;
  const outputEnabledRef = useRef(false);
  outputEnabledRef.current = ndi.state.outputState.audience || ndi.state.outputState.stage;

  const queueRef = useRef<QueueItem[]>([]);
  const cancelledRef = useRef(new Set<string>());
  const openBatchesRef = useRef(new Set<string>());
  const drainingRef = useRef(false);

  const respond = useCallback(async (response: AgentActionResponse) => {
    cancelledRef.current.delete(response.requestId);
    try {
      await window.castApi.agentRespondAction(response);
    } catch (error) {
      // A failed response is main's problem (its request times out); it must
      // never stop the queue from draining the rest.
      console.error('[AgentDispatcher] Failed to deliver response:', error);
    }
  }, []);

  const runAction = useCallback(async (request: AgentActionRequest): Promise<AgentActionResponse> => {
    const { requestId, actionId } = request;
    const metadata: ActionMetadata | undefined = ACTION_METADATA[actionId as ActionId];
    if (!metadata) return { requestId, outcome: 'denied', reason: 'unknown-action' };

    // Show-safety interlock: a broadcast action is what puts pixels in front
    // of an audience, so while an output is live it always asks — even when
    // the principal's matrix says `auto` — and the prompt withholds "Always
    // allow" so the grant cannot outlive the show.
    const interlock = metadata.risk === 'broadcast' && request.interlockEnabled && outputEnabledRef.current;
    const decision = interlock ? 'ask' : request.decision;

    let alwaysAllow: ActionRiskClass | undefined;
    if (decision === 'ask') {
      const answer = await requestAgentPermission({
        principal: request.principal,
        actionId: metadata.id,
        title: metadata.title,
        risk: metadata.risk,
        params: request.params,
        interlock,
      });
      if (answer === 'deny') {
        return { requestId, outcome: 'denied', reason: interlock ? 'interlock' : 'user' };
      }
      if (answer === 'always-allow') alwaysAllow = metadata.risk;
    }

    const isMutation = metadata.risk === 'write' || metadata.risk === 'destructive';

    try {
      const params = paramsRecord(request.params);

      if (metadata.site === 'main') {
        if (isMutation) await flushRef.current();
        // Agent-facing media references are asset ids; the RPC contract wants
        // the snapshot's masked `src`. Resolved for every main action, since
        // the shapes that nest a media reference (elements, backgrounds,
        // themes, overlays, stages) are not worth enumerating per action.
        const mediaAssets = contextsRef.current.cast.snapshot?.mediaAssets ?? [];
        const resolved = resolveAssetIdReferences(params, (assetId) => (
          mediaAssets.find((asset) => asset.id === assetId)?.src ?? null
        ));
        const raw = await invokeMainAction(actionId as MainActionId, resolved);

        // Route anything carrying a patch through the store so the agent's
        // change lands in undo history alongside the user's own edits.
        const itemResult = asItemResult(raw);
        if (itemResult) {
          await contextsRef.current.cast.mutatePatch(async () => itemResult.patch);
          const summary = summarizePatch(itemResult.patch);
          return { requestId, outcome: 'succeeded', result: { ...summary, itemId: itemResult.itemId }, ...(alwaysAllow ? { alwaysAllow } : {}) };
        }
        if (isSnapshotPatch(raw)) {
          await contextsRef.current.cast.mutatePatch(async () => raw);
          return { requestId, outcome: 'succeeded', result: summarizePatch(raw), ...(alwaysAllow ? { alwaysAllow } : {}) };
        }
        return { requestId, outcome: 'succeeded', result: raw ?? null, ...(alwaysAllow ? { alwaysAllow } : {}) };
      }

      const result = await executeRendererAction(actionId as RendererActionId, params, contextsRef.current);
      return { requestId, outcome: 'succeeded', result: result ?? null, ...(alwaysAllow ? { alwaysAllow } : {}) };
    } catch (error) {
      if (error instanceof InvalidActionParamsError) {
        return { requestId, outcome: 'denied', reason: 'invalid-params' };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { requestId, outcome: 'failed', error: message, ...(alwaysAllow ? { alwaysAllow } : {}) };
    }
  }, []);

  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const item = queueRef.current.shift();
        if (!item) break;

        if (item.kind === 'batch') {
          const { batchId, phase } = item.event;
          // Unbalanced events (a duplicate begin, an end for a batch that was
          // never opened) are dropped rather than allowed to unbalance the
          // store's nesting counter.
          if (phase === 'begin') {
            if (openBatchesRef.current.has(batchId)) continue;
            openBatchesRef.current.add(batchId);
            contextsRef.current.cast.beginHistoryBatch();
          } else {
            if (!openBatchesRef.current.delete(batchId)) continue;
            contextsRef.current.cast.endHistoryBatch();
          }
          continue;
        }

        const { request } = item;
        if (cancelledRef.current.has(request.requestId)) {
          await respond({ requestId: request.requestId, outcome: 'cancelled' });
          continue;
        }

        const response = await runAction(request);
        // Cancelled while it ran: report the cancellation, not the outcome —
        // main has already stopped waiting for this request.
        if (cancelledRef.current.has(request.requestId)) {
          await respond({ requestId: request.requestId, outcome: 'cancelled' });
          continue;
        }
        await respond(response);
      }
    } finally {
      drainingRef.current = false;
    }
  }, [respond, runAction]);

  useEffect(() => {
    const queue = queueRef.current;
    const cancelled = cancelledRef.current;
    const openBatches = openBatchesRef.current;

    const unsubscribeRequest = window.castApi.onAgentActionRequest((request) => {
      if (cancelled.has(request.requestId)) {
        cancelled.delete(request.requestId);
        void respond({ requestId: request.requestId, outcome: 'cancelled' });
        return;
      }
      queue.push({ kind: 'action', request });
      void drain();
    });

    const unsubscribeBatch = window.castApi.onAgentBatch((event) => {
      queue.push({ kind: 'batch', event });
      void drain();
    });

    const unsubscribeCancelled = window.castApi.onAgentActionCancelled(({ requestId }) => {
      cancelled.add(requestId);
      const index = queue.findIndex((item) => item.kind === 'action' && item.request.requestId === requestId);
      if (index === -1) return;
      queue.splice(index, 1);
      void respond({ requestId, outcome: 'cancelled' });
    });

    return () => {
      unsubscribeRequest();
      unsubscribeBatch();
      unsubscribeCancelled();
      queue.length = 0;
      cancelled.clear();
      // Close every batch this dispatcher opened, or the store's nesting
      // counter stays above zero and the user's own edits stop reaching undo.
      for (const batchId of [...openBatches]) {
        openBatches.delete(batchId);
        contextsRef.current.cast.endHistoryBatch();
      }
      denyAllAgentPermissionPrompts();
    };
  }, [drain, respond]);
}

// The deterministic Macro/Cue runtime core (issue #219, wave W8): Macro Run
// bookkeeping, per-Cue-step before/after delays, Cancel vs Revert semantics
// (including a Cue's static inverse), Scope exit sweeps, loop iteration, and
// trigger firing. Extracted from
// app/renderer/features/automation/automation-context.tsx, which now
// supplies real ports (playback commands, a clock, observability) and keeps
// only React state orchestration and persistence/CRUD I/O.
//
// See CONTEXT.md's "Automation (Macros & Cues)" glossary for the vocabulary
// used throughout: Macro, Cue, Cue step (MacroCue), Scope, Macro Run, Scope
// exit, Cancel, Revert.
import type { Id } from '@lumacast/kernel';
import type {
  Cue,
  CueClearLayer,
  LifecycleAction,
  LifecycleTarget,
  Macro,
  OnScopeExit,
  ScopeLevel,
  TriggerBinding,
  TriggerType,
} from './model';

// ─── Ports ──────────────────────────────────────────────────────────
//
// The runtime never reaches out to `window`, Electron, or any app/renderer
// feature directly. Every side-effectful dependency is an injected port with
// a narrow, locally-declared interface so this package stays structurally
// (not nominally) compatible with the app's real implementations — no
// `packages/automation -> app` import is ever needed.

/** Mirrors app's `PlaybackCommandPort` (`app/renderer/contexts/playback/playback-context.tsx`) structurally. */
export interface AutomationPlaybackPort {
  activateOverlay(overlayId: Id): void;
  clearOverlay(overlayId: Id): void;
  clearAllOverlays(): void;
  setMediaLayerAsset(assetId: Id): void;
  armVideo(assetId: Id): void;
  clearVideo(): void;
  armAudio(assetId: Id): void;
  clearAudio(): void;
  setCurrentStageId(id: Id | null): void;
  clearLayer(layer: CueClearLayer): void;
  clearAllLayers(): void;
}

/** Opaque handle returned by `AutomationClock.setTimeout`; passed back verbatim to `clearTimeout`. */
export type AutomationTimerHandle = unknown;

/** Injectable scheduler/clock so the runtime is deterministic under test (real impl: `window.setTimeout`/`Date.now`). */
export interface AutomationClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): AutomationTimerHandle;
  clearTimeout(handle: AutomationTimerHandle): void;
}

/** Categories the runtime records; a subset of app's `ObsEventCategory` so the port stays structurally assignable to `recordObsEvent`. */
export type AutomationObsCategory = 'playback' | 'error';
export type AutomationObsLevel = 'info' | 'warn' | 'error';

/** Mirrors `recordObsEvent` from `app/renderer/features/observability/metrics-store.ts`. Optional: a runtime with no observability port simply records nothing. */
export interface AutomationObservabilityPort {
  record(category: AutomationObsCategory, message: string, details?: Record<string, unknown>, level?: AutomationObsLevel): void;
}

export interface AutomationRuntimePorts {
  playback: AutomationPlaybackPort;
  clock: AutomationClock;
  observability?: AutomationObservabilityPort;
  /** Optional status-line text sink (macro aborted/ran messages); omit to run silently. */
  onStatusText?: (text: string) => void;
}

// ─── Macro Run bookkeeping ─────────────────────────────────────────
//
// One triggered execution of a Macro, bound to a concrete Scope context.
// Lives in the runtime's registry so Scope exit sweeps and `flow.lifecycle`
// Cues can target it. Triggers stack — each fire creates a new Run, never
// deduped.
export interface MacroRun {
  runId: string;
  macroId: Id;
  scope: ScopeLevel;
  boundContextId: Id | null;
  onScopeExit: OnScopeExit;
  appliedCues: Cue[];
  aborters: Set<() => void>;
  cancelled: boolean;
}

export type MacroRunRegistry = ReadonlyMap<string, MacroRun>;

/** The Scope a Macro Run is bound to, resolved from a trigger by `resolveMacroScope`. */
export interface MacroScopeContext {
  scope: ScopeLevel;
  boundContextId: Id | null;
  onScopeExit: OnScopeExit;
}

// A delay that can be aborted mid-flight. Aborting resolves the promise so the
// awaiting macro loop unwinds immediately instead of hanging. A 0ms delay with
// a run still schedules a task so a delay-less loop yields (and can be
// cancelled) rather than spinning synchronously.
function cancellableDelay(ms: number, run: MacroRun | null, clock: AutomationClock): Promise<void> {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (safeMs === 0 && !run) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = clock.setTimeout(() => {
      run?.aborters.delete(abort);
      resolve();
    }, safeMs);
    const abort = () => {
      clock.clearTimeout(timer);
      resolve();
    };
    run?.aborters.add(abort);
  });
}

// Cancel: stop a Run's pending delays and future loop iterations.
// Already-applied effects stay on screen.
function cancelRun(run: MacroRun): void {
  run.cancelled = true;
  for (const abort of run.aborters) abort();
  run.aborters.clear();
}

/**
 * Resolve the Scope a Macro Run should bind to for a given trigger. The
 * Scope *level* is authored on the Macro; the concrete bound context (which
 * slide / deck item) is captured from the trigger, falling back to global
 * when there is no slide context (manual run / app.startup).
 */
export function resolveMacroScope(
  macro: Macro,
  triggerType: TriggerType | null,
  sourceId: Id | null,
  resolveDeckItemId: (slideId: Id) => Id | null,
): MacroScopeContext {
  const isSlideTrigger = sourceId !== null && (triggerType === 'slide.take' || triggerType === 'slide.activate');
  let scope: ScopeLevel = macro.scopeLevel;
  let boundContextId: Id | null = null;
  if (scope === 'slide') {
    if (isSlideTrigger) boundContextId = sourceId;
    else scope = 'global';
  } else if (scope === 'deckItem') {
    const deckItemId = isSlideTrigger ? resolveDeckItemId(sourceId) : null;
    if (deckItemId) boundContextId = deckItemId;
    else scope = 'global';
  }
  return { scope, boundContextId, onScopeExit: macro.onScopeExit };
}

/** Data a caller supplies per `fireTrigger` call — plain lookups, not ports; the runtime never owns project data. */
export interface AutomationTriggerData {
  triggerBindings: TriggerBinding[];
  resolveCue: (cueId: Id) => Cue | undefined;
  resolveMacro: (macroId: Id) => Macro | undefined;
  resolveDeckItemId: (slideId: Id) => Id | null;
}

export interface AutomationRuntime {
  /** Active Macro Runs, keyed by run id. Read-only view for diagnostics/testing. */
  readonly runs: MacroRunRegistry;
  /** Bare-Cue execution: unscoped, global, no lifecycle tracking, no delay. */
  runCue(cue: Cue): Promise<void>;
  /** Start a tracked Macro Run bound to `scopeContext`; loops per `macro.loopEnabled`/`loopCount`, applying each Cue step's before/after delay. */
  startMacroRun(macro: Macro, resolveCue: (cueId: Id) => Cue | undefined, scopeContext: MacroScopeContext): Promise<void>;
  /** Scope exit sweep: expire Runs whose bound context no longer matches, applying each Run's authored on-exit behavior (Cancel, Revert, or none). Global Runs never exit. */
  handleScopeChange(newSlideId: Id | null, resolveDeckItemId: (slideId: Id) => Id | null): void;
  /** Cancel or Revert every Run matching `target` (a macro id, or `'*'` for all), excluding `selfRunId`. */
  applyLifecycle(action: LifecycleAction, target: LifecycleTarget, selfRunId: string | null): void;
  /** Resolve trigger bindings for `(triggerType, sourceId)` and fire each match (fire-and-forget; stacks Runs, never dedupes). */
  fireTrigger(triggerType: TriggerType, sourceId: Id | null, data: AutomationTriggerData): void;
}

/**
 * Build a fresh, isolated automation runtime: an empty Macro Run registry
 * plus the methods that operate on it. `getPorts` is read lazily on every
 * operation (not captured at construction) so a caller can keep one runtime
 * instance alive across renders while swapping in fresh port implementations
 * (e.g. a new `PlaybackCommandPort` identity) without losing in-flight Runs.
 */
export function createAutomationRuntime(getPorts: () => AutomationRuntimePorts): AutomationRuntime {
  const runs = new Map<string, MacroRun>();
  let runCounter = 0;

  function nextRunId(): string {
    runCounter += 1;
    return `run_${getPorts().clock.now()}_${runCounter}`;
  }

  // Apply a Cue's side-effect through the playback command port. `flow.lifecycle`
  // is handled by the caller since it acts on the run registry rather than a
  // presentation layer.
  function applyCueAction(cue: Cue): void {
    const { playback } = getPorts();
    switch (cue.kind) {
      case 'overlay.activate':
        playback.activateOverlay((cue.payload as { overlayId: Id }).overlayId);
        break;
      case 'overlay.clear':
        playback.clearOverlay((cue.payload as { overlayId: Id }).overlayId);
        break;
      case 'overlay.clearAll':
        playback.clearAllOverlays();
        break;
      case 'mediaLayer.set':
        playback.setMediaLayerAsset((cue.payload as { assetId: Id }).assetId);
        break;
      case 'video.arm':
        playback.armVideo((cue.payload as { assetId: Id }).assetId);
        break;
      case 'video.clear':
        playback.clearVideo();
        break;
      case 'audio.arm':
        playback.armAudio((cue.payload as { assetId: Id }).assetId);
        break;
      case 'audio.clear':
        playback.clearAudio();
        break;
      case 'stage.set':
        playback.setCurrentStageId((cue.payload as { stageId: Id }).stageId);
        break;
      case 'stage.clear':
        playback.setCurrentStageId(null);
        break;
      case 'layer.clear':
        playback.clearLayer((cue.payload as { layer: CueClearLayer }).layer);
        break;
      case 'layer.clearAll':
        playback.clearAllLayers();
        break;
      case 'flow.lifecycle':
        break;
    }
  }

  // Revert: Cancel plus undo the Run's applied effects, in reverse order, via
  // each Cue's static inverse. Cues with no inverse (clears, lifecycle) are
  // skipped.
  function revertRun(run: MacroRun): void {
    const { playback } = getPorts();
    cancelRun(run);
    for (let i = run.appliedCues.length - 1; i >= 0; i -= 1) {
      const cue = run.appliedCues[i];
      switch (cue.kind) {
        case 'overlay.activate':
          playback.clearOverlay((cue.payload as { overlayId: Id }).overlayId);
          break;
        case 'mediaLayer.set':
          playback.clearLayer('media');
          break;
        case 'video.arm':
          playback.clearVideo();
          break;
        case 'audio.arm':
          playback.clearAudio();
          break;
        case 'stage.set':
          playback.setCurrentStageId(null);
          break;
        default:
          break;
      }
    }
  }

  // Cancel or Revert targeted Runs. `'*'` hits every active Run; a macro id
  // hits every running instance of that Macro. The invoking Run is spared so
  // a "reset everything" Macro can clear others and keep executing.
  function applyLifecycle(action: LifecycleAction, target: LifecycleTarget, selfRunId: string | null): void {
    const targets: MacroRun[] = [];
    for (const run of runs.values()) {
      if (selfRunId && run.runId === selfRunId) continue;
      if (target === '*' || run.macroId === target) targets.push(run);
    }
    for (const run of targets) {
      if (action === 'revert') revertRun(run);
      else cancelRun(run);
      runs.delete(run.runId);
    }
  }

  // Delays are per-occurrence (a Cue step), passed in by the caller rather
  // than read off the shared Cue. Bare Cues run with no delay.
  async function executeCue(cue: Cue, delayBeforeMs: number, delayAfterMs: number, run: MacroRun | null): Promise<void> {
    const { observability, clock } = getPorts();
    if (run?.cancelled) return;
    if (delayBeforeMs > 0) {
      await cancellableDelay(delayBeforeMs, run, clock);
      if (run?.cancelled) return;
    }

    observability?.record('playback', 'Cue started', { cueId: cue.id, kind: cue.kind });
    try {
      if (cue.kind === 'flow.lifecycle') {
        const { action, target } = cue.payload as { action: LifecycleAction; target: LifecycleTarget };
        applyLifecycle(action, target, run?.runId ?? null);
      } else {
        applyCueAction(cue);
        if (run) run.appliedCues.push(cue);
      }
      observability?.record('playback', 'Cue completed', { cueId: cue.id, kind: cue.kind });
    } catch (error) {
      observability?.record('error', 'Cue failed', {
        cueId: cue.id,
        kind: cue.kind,
        error: error instanceof Error ? error.message : String(error),
      }, 'error');
      if (cue.failurePolicy === 'abort') throw error;
    }

    if (run?.cancelled) return;
    if (delayAfterMs > 0) {
      await cancellableDelay(delayAfterMs, run, clock);
    }
  }

  // Public single-cue runner (bare-Cue trigger bindings, command palette).
  // Runs unscoped/global with no lifecycle tracking and no delay.
  async function runCue(cue: Cue): Promise<void> {
    await executeCue(cue, 0, 0, null);
  }

  // Start a tracked Macro Run. `scopeContext` is resolved by the caller
  // (`resolveMacroScope`) — this function owns only run bookkeeping, loop
  // iteration, and per-step delays.
  async function startMacroRun(macro: Macro, resolveCue: (cueId: Id) => Cue | undefined, scopeContext: MacroScopeContext): Promise<void> {
    const run: MacroRun = {
      runId: nextRunId(),
      macroId: macro.id,
      scope: scopeContext.scope,
      boundContextId: scopeContext.boundContextId,
      onScopeExit: scopeContext.onScopeExit,
      appliedCues: [],
      aborters: new Set(),
      cancelled: false,
    };
    runs.set(run.runId, run);
    const { observability, clock, onStatusText } = getPorts();
    observability?.record('playback', 'Macro started', { macroId: macro.id, name: macro.name, runId: run.runId, scope: run.scope, boundContextId: run.boundContextId });

    const ordered = macro.cues.slice().sort((left, right) => left.orderIndex - right.orderIndex);
    const maxIterations = macro.loopEnabled ? (macro.loopCount ?? Number.POSITIVE_INFINITY) : 1;
    let aborted = false;

    try {
      let iteration = 0;
      while (iteration < maxIterations && !run.cancelled) {
        for (const link of ordered) {
          if (run.cancelled) break;
          const cue = resolveCue(link.cueId);
          if (!cue) continue;
          try {
            await executeCue(cue, link.delayBeforeMs, link.delayAfterMs, run);
          } catch (error) {
            onStatusText?.(`Macro aborted: ${macro.name}`);
            observability?.record('playback', 'Macro aborted', {
              macroId: macro.id,
              name: macro.name,
              error: error instanceof Error ? error.message : String(error),
            }, 'warn');
            aborted = true;
            break;
          }
        }
        if (aborted || run.cancelled) break;
        iteration += 1;
        if (macro.loopEnabled && iteration < maxIterations) {
          // Yield a task between iterations so a delay-less loop can't block
          // and remains interruptible by scope changes.
          await cancellableDelay(0, run, clock);
        }
      }

      if (!aborted && !run.cancelled) {
        onStatusText?.(`Macro ran: ${macro.name}`);
        observability?.record('playback', 'Macro completed', { macroId: macro.id, name: macro.name, runId: run.runId });
      }
    } finally {
      run.aborters.clear();
      runs.delete(run.runId);
    }
  }

  // Scope exit sweep: the live slide changed. Expire Runs whose bound scope
  // context no longer matches, applying each Run's authored on-exit
  // behavior. Global Runs and Runs whose context still matches are left
  // alone; 'none' Runs keep going.
  function handleScopeChange(newSlideId: Id | null, resolveDeckItemId: (slideId: Id) => Id | null): void {
    const newDeckItemId = newSlideId ? resolveDeckItemId(newSlideId) : null;
    for (const run of [...runs.values()]) {
      let exited = false;
      if (run.scope === 'slide') exited = run.boundContextId !== newSlideId;
      else if (run.scope === 'deckItem') exited = run.boundContextId !== newDeckItemId;
      if (!exited) continue;
      if (run.onScopeExit === 'cancel') {
        cancelRun(run);
        runs.delete(run.runId);
      } else if (run.onScopeExit === 'revert') {
        revertRun(run);
        runs.delete(run.runId);
      }
    }
  }

  function fireTrigger(triggerType: TriggerType, sourceId: Id | null, data: AutomationTriggerData): void {
    // Slide activation moves the live context. Sweep first so Runs bound to
    // the slide we're leaving are expired; Runs bound to the incoming slide
    // survive.
    if (triggerType === 'slide.activate') {
      handleScopeChange(sourceId, data.resolveDeckItemId);
    }

    const matches = data.triggerBindings.filter((binding) => binding.triggerType === triggerType && binding.sourceId === sourceId && binding.enabled);
    getPorts().observability?.record('playback', 'Automation trigger fired', {
      triggerType,
      sourceId,
      bindingCount: matches.length,
    });

    for (const binding of matches) {
      if (binding.targetType === 'cue') {
        const cue = data.resolveCue(binding.targetId);
        if (cue) void runCue(cue);
      } else {
        const macro = data.resolveMacro(binding.targetId);
        if (!macro) continue;
        const scopeContext = resolveMacroScope(macro, triggerType, sourceId, data.resolveDeckItemId);
        void startMacroRun(macro, data.resolveCue, scopeContext);
      }
    }
  }

  return {
    runs,
    runCue,
    startMacroRun,
    handleScopeChange,
    applyLifecycle,
    fireTrigger,
  };
}

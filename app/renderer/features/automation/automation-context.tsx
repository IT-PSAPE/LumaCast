import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  Cue,
  CueClearLayer,
  CueFailurePolicy,
  CueKind,
  CuePayload,
  Id,
  LifecycleAction,
  LifecycleTarget,
  Macro,
  OnScopeExit,
  ScopeLevel,
  TriggerBinding,
  TriggerBindingTargetType,
  TriggerType,
} from '@core/types';
import { getSlideDeckItemId } from '@core/deck-items';
import { useCast } from '@renderer/contexts/app-context';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { useAudio, usePresentationLayerActions, usePresentationMediaLayer, usePresentationOverlayLayer, useStagePlayback, useVideo } from '@renderer/contexts/playback/playback-context';
import { recordObsEvent } from '@renderer/features/observability/metrics-store';
import { AUTOMATION_TRIGGER_EVENT, type AutomationTriggerEventDetail } from './automation-events';

interface AutomationContextValue {
  state: {
    cues: Cue[];
    macros: Macro[];
    bindings: TriggerBinding[];
    isLoading: boolean;
    currentMacroId: Id | null;
  };
  actions: {
    setCurrentMacroId: (id: Id | null) => void;
    createMacro: () => Promise<Macro>;
    updateMacroFields: (id: Id, fields: {
      name?: string;
      description?: string;
      scopeLevel?: ScopeLevel;
      onScopeExit?: OnScopeExit;
      loopEnabled?: boolean;
      loopCount?: number | null;
    }) => Promise<void>;
    deleteMacro: (id: Id) => Promise<void>;
    duplicateMacro: (id: Id) => Promise<Macro | null>;
    setMacroCues: (macroId: Id, cues: Array<{ id?: Id; cueId: Id; orderIndex: number; delayBeforeMs?: number; delayAfterMs?: number }>) => Promise<void>;
    runCue: (cueId: Id) => Promise<void>;
    runMacro: (macroId: Id) => Promise<void>;
    ensureCue: (input: { kind: CueKind; payload: CuePayload; failurePolicy?: CueFailurePolicy }) => Promise<Cue>;
    createBinding: (input: { triggerType: TriggerType; sourceId: Id | null; targetType: TriggerBindingTargetType; targetId: Id }) => Promise<void>;
    deleteBinding: (bindingId: Id) => Promise<void>;
    getBindingsForSource: (triggerType: TriggerType, sourceId: Id | null) => TriggerBinding[];
    getBindingsForMacro: (macroId: Id) => TriggerBinding[];
  };
}

// One triggered execution of a macro, bound to a concrete scope context.
// Lives in an in-memory registry so scope-exit sweeps and lifecycle cues can
// target it. Triggers stack — each fire creates a new run.
interface MacroRun {
  runId: string;
  macroId: Id;
  scope: ScopeLevel;
  boundContextId: Id | null;
  onScopeExit: OnScopeExit;
  appliedCues: Cue[];
  aborters: Set<() => void>;
  cancelled: boolean;
}

let runCounter = 0;
const nextRunId = (): string => {
  runCounter += 1;
  return `run_${Date.now()}_${runCounter}`;
};

// A delay that can be aborted mid-flight. Aborting resolves the promise so the
// awaiting macro loop unwinds immediately instead of hanging. A 0ms delay with
// a run still schedules a macrotask so a delay-less loop yields to the event
// loop (and can be cancelled) rather than spinning the thread.
function cancellableDelay(ms: number, run: MacroRun | null): Promise<void> {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (safeMs === 0 && !run) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(() => {
      run?.aborters.delete(abort);
      resolve();
    }, safeMs);
    const abort = () => {
      window.clearTimeout(timer);
      resolve();
    };
    run?.aborters.add(abort);
  });
}

function cancelRun(run: MacroRun): void {
  run.cancelled = true;
  for (const abort of run.aborters) abort();
  run.aborters.clear();
}

const AutomationContext = createContext<AutomationContextValue | null>(null);

export function AutomationProvider({ children }: { children: ReactNode }) {
  const { snapshot, mutatePatch, runOperation, setStatusText } = useCast();
  const { cues, macros, triggerBindings, cuesById, macrosById, slides } = useProjectContent();
  const overlayLayer = usePresentationOverlayLayer();
  const mediaLayer = usePresentationMediaLayer();
  const layerActions = usePresentationLayerActions();
  const audio = useAudio();
  const video = useVideo();
  const stage = useStagePlayback();
  const [currentMacroId, setCurrentMacroId] = useState<Id | null>(null);
  const cuesRef = useRef<Cue[]>(cues);
  cuesRef.current = cues;
  const isLoading = snapshot === null;
  // Dedup concurrent ensureCue calls: without this, two simultaneous
  // ensureCue() invocations with the same kind+payload+policy each see a
  // stale `cues` snapshot (mutatePatch hasn't flushed yet) and both POST a
  // fresh cue — leaving an orphan duplicate.
  const inFlightCuesRef = useRef<Map<string, Promise<Cue>>>(new Map());

  // Active macro runs, keyed by run id. Mutable across renders so scope-exit
  // sweeps and lifecycle cues can reach in-flight runs.
  const runsRef = useRef<Map<string, MacroRun>>(new Map());
  // slideId -> owning deck item id, refreshed each render for use inside handlers.
  const slideDeckItemByIdRef = useRef<Map<Id, Id | null>>(new Map());
  slideDeckItemByIdRef.current = useMemo(() => {
    const map = new Map<Id, Id | null>();
    for (const slide of slides) map.set(slide.id, getSlideDeckItemId(slide));
    return map;
  }, [slides]);

  // Apply a cue's side-effect. `flow.lifecycle` is handled by the caller since
  // it acts on the run registry rather than a presentation layer.
  const applyCueAction = useCallback((cue: Cue) => {
    switch (cue.kind) {
      case 'overlay.activate':
        overlayLayer.activateOverlay((cue.payload as { overlayId: Id }).overlayId);
        break;
      case 'overlay.clear':
        overlayLayer.clearOverlay((cue.payload as { overlayId: Id }).overlayId);
        break;
      case 'overlay.clearAll':
        overlayLayer.clearAllOverlays();
        break;
      case 'mediaLayer.set':
        mediaLayer.setMediaLayerAsset((cue.payload as { assetId: Id }).assetId);
        break;
      case 'video.arm':
        video.armVideo((cue.payload as { assetId: Id }).assetId);
        break;
      case 'video.clear':
        video.clearVideo();
        break;
      case 'audio.arm':
        audio.armAudio((cue.payload as { assetId: Id }).assetId);
        break;
      case 'audio.clear':
        audio.clearAudio();
        break;
      case 'stage.set':
        stage.setCurrentStageId((cue.payload as { stageId: Id }).stageId);
        break;
      case 'stage.clear':
        stage.setCurrentStageId(null);
        break;
      case 'layer.clear':
        layerActions.clearLayer((cue.payload as { layer: CueClearLayer }).layer);
        break;
      case 'layer.clearAll':
        layerActions.clearAllLayers();
        break;
      case 'flow.lifecycle':
        break;
    }
  }, [audio, layerActions, mediaLayer, overlayLayer, stage, video]);

  // Stop a run and undo the effects it applied, in reverse order, via each
  // cue's static inverse. Cues with no inverse (clears, lifecycle) are skipped.
  const revertRun = useCallback((run: MacroRun) => {
    cancelRun(run);
    for (let i = run.appliedCues.length - 1; i >= 0; i -= 1) {
      const cue = run.appliedCues[i];
      switch (cue.kind) {
        case 'overlay.activate':
          overlayLayer.clearOverlay((cue.payload as { overlayId: Id }).overlayId);
          break;
        case 'mediaLayer.set':
          layerActions.clearLayer('media');
          break;
        case 'video.arm':
          video.clearVideo();
          break;
        case 'audio.arm':
          audio.clearAudio();
          break;
        case 'stage.set':
          stage.setCurrentStageId(null);
          break;
        default:
          break;
      }
    }
  }, [audio, layerActions, overlayLayer, stage, video]);

  // Cancel or revert targeted runs. `'*'` hits every active run; an id hits
  // every running instance of that macro. The invoking run is spared so a
  // "reset everything" macro can clear others and keep executing.
  const applyLifecycle = useCallback((action: LifecycleAction, target: LifecycleTarget, selfRunId: string | null) => {
    const targets: MacroRun[] = [];
    for (const run of runsRef.current.values()) {
      if (selfRunId && run.runId === selfRunId) continue;
      if (target === '*' || run.macroId === target) targets.push(run);
    }
    for (const run of targets) {
      if (action === 'revert') revertRun(run);
      else cancelRun(run);
      runsRef.current.delete(run.runId);
    }
  }, [revertRun]);

  // Delays are per-occurrence (a macro step), passed in by the caller rather
  // than read off the shared cue. Bare cues run with no delay.
  const executeCue = useCallback(async (cue: Cue, delayBeforeMs: number, delayAfterMs: number, run: MacroRun | null) => {
    if (run?.cancelled) return;
    if (delayBeforeMs > 0) {
      await cancellableDelay(delayBeforeMs, run);
      if (run?.cancelled) return;
    }

    recordObsEvent('playback', 'Cue started', { cueId: cue.id, kind: cue.kind });
    try {
      if (cue.kind === 'flow.lifecycle') {
        const { action, target } = cue.payload as { action: LifecycleAction; target: LifecycleTarget };
        applyLifecycle(action, target, run?.runId ?? null);
      } else {
        applyCueAction(cue);
        if (run) run.appliedCues.push(cue);
      }
      recordObsEvent('playback', 'Cue completed', { cueId: cue.id, kind: cue.kind });
    } catch (error) {
      recordObsEvent('error', 'Cue failed', {
        cueId: cue.id,
        kind: cue.kind,
        error: error instanceof Error ? error.message : String(error),
      }, 'error');
      if (cue.failurePolicy === 'abort') throw error;
    }

    if (run?.cancelled) return;
    if (delayAfterMs > 0) {
      await cancellableDelay(delayAfterMs, run);
    }
  }, [applyCueAction, applyLifecycle]);

  // Public single-cue runner (bare-cue trigger bindings, command palette).
  // Runs unscoped/global with no lifecycle tracking and no delay.
  const runCue = useCallback(async (cueId: Id) => {
    const cue = cuesById.get(cueId);
    if (!cue) return;
    await executeCue(cue, 0, 0, null);
  }, [cuesById, executeCue]);

  // Start a tracked macro run. The scope level is authored on the macro; the
  // concrete bound context is resolved from the trigger source, falling back to
  // global when there is no slide context (manual run / app.startup).
  const startMacroRun = useCallback(async (macroId: Id, triggerType: TriggerType | null, sourceId: Id | null) => {
    const macro = macrosById.get(macroId);
    if (!macro) return;

    const isSlideTrigger = sourceId !== null && (triggerType === 'slide.take' || triggerType === 'slide.activate');
    let scope: ScopeLevel = macro.scopeLevel;
    let boundContextId: Id | null = null;
    if (scope === 'slide') {
      if (isSlideTrigger) boundContextId = sourceId;
      else scope = 'global';
    } else if (scope === 'deckItem') {
      const deckItemId = isSlideTrigger ? slideDeckItemByIdRef.current.get(sourceId) ?? null : null;
      if (deckItemId) boundContextId = deckItemId;
      else scope = 'global';
    }

    const run: MacroRun = {
      runId: nextRunId(),
      macroId,
      scope,
      boundContextId,
      onScopeExit: macro.onScopeExit,
      appliedCues: [],
      aborters: new Set(),
      cancelled: false,
    };
    runsRef.current.set(run.runId, run);
    recordObsEvent('playback', 'Macro started', { macroId, name: macro.name, runId: run.runId, scope, boundContextId });

    const ordered = macro.cues.slice().sort((left, right) => left.orderIndex - right.orderIndex);
    const maxIterations = macro.loopEnabled ? (macro.loopCount ?? Number.POSITIVE_INFINITY) : 1;
    let aborted = false;

    try {
      let iteration = 0;
      while (iteration < maxIterations && !run.cancelled) {
        for (const link of ordered) {
          if (run.cancelled) break;
          const cue = cuesById.get(link.cueId);
          if (!cue) continue;
          try {
            await executeCue(cue, link.delayBeforeMs, link.delayAfterMs, run);
          } catch (error) {
            setStatusText(`Macro aborted: ${macro.name}`);
            recordObsEvent('playback', 'Macro aborted', {
              macroId,
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
          // Yield a macrotask between iterations so a delay-less loop can't
          // block the thread and remains interruptible by scope changes.
          await cancellableDelay(0, run);
        }
      }

      if (!aborted && !run.cancelled) {
        setStatusText(`Macro ran: ${macro.name}`);
        recordObsEvent('playback', 'Macro completed', { macroId, name: macro.name, runId: run.runId });
      }
    } finally {
      run.aborters.clear();
      runsRef.current.delete(run.runId);
    }
  }, [macrosById, cuesById, executeCue, setStatusText]);

  const runMacro = useCallback(async (macroId: Id) => {
    await startMacroRun(macroId, null, null);
  }, [startMacroRun]);

  // The live slide changed: expire runs whose bound scope context no longer
  // matches, applying each run's authored on-exit behavior. Global runs and
  // runs whose context still matches are left alone; 'none' runs keep going.
  const handleScopeChange = useCallback((newSlideId: Id | null) => {
    const newDeckItemId = newSlideId ? slideDeckItemByIdRef.current.get(newSlideId) ?? null : null;
    for (const run of [...runsRef.current.values()]) {
      let exited = false;
      if (run.scope === 'slide') exited = run.boundContextId !== newSlideId;
      else if (run.scope === 'deckItem') exited = run.boundContextId !== newDeckItemId;
      if (!exited) continue;
      if (run.onScopeExit === 'cancel') {
        cancelRun(run);
        runsRef.current.delete(run.runId);
      } else if (run.onScopeExit === 'revert') {
        revertRun(run);
        runsRef.current.delete(run.runId);
      }
    }
  }, [revertRun]);

  const ensureCue = useCallback(async (input: { kind: CueKind; payload: CuePayload; failurePolicy?: CueFailurePolicy }) => {
    const payloadKey = JSON.stringify(input.payload);
    const failurePolicy = input.failurePolicy ?? 'continue';
    const existing = cuesRef.current.find((cue) => (
      cue.kind === input.kind
      && JSON.stringify(cue.payload) === payloadKey
      && cue.failurePolicy === failurePolicy
    ));
    if (existing) return existing;

    const dedupKey = `${input.kind}|${payloadKey}|${failurePolicy}`;
    const inFlight = inFlightCuesRef.current.get(dedupKey);
    if (inFlight) return inFlight;

    const promise = (async () => {
      try {
        const previousIds = new Set(cuesRef.current.map((cue) => cue.id));
        const nextSnapshot = await mutatePatch(() => window.castApi.createCue({ kind: input.kind, payload: input.payload, failurePolicy }));
        const created = nextSnapshot.cues.find((cue) => !previousIds.has(cue.id));
        if (!created) throw new Error('Cue creation succeeded but no new cue appeared in the snapshot');
        return created;
      } finally {
        inFlightCuesRef.current.delete(dedupKey);
      }
    })();
    inFlightCuesRef.current.set(dedupKey, promise);
    return promise;
  }, [mutatePatch]);

  const createMacro = useCallback(async () => {
    const previousIds = new Set(macros.map((macro) => macro.id));
    const nextSnapshot = await runOperation('Creating macro...', () => mutatePatch(() => window.castApi.createMacro({
      name: 'Untitled macro',
      description: '',
      cues: [],
    })));
    const created = nextSnapshot.macros.find((macro) => !previousIds.has(macro.id));
    if (!created) throw new Error('Macro creation succeeded but no new macro appeared in the snapshot');
    setCurrentMacroId(created.id);
    setStatusText(`Created macro: ${created.name}`);
    return created;
  }, [macros, mutatePatch, runOperation, setStatusText]);

  const updateMacroFields = useCallback(async (id: Id, fields: {
    name?: string;
    description?: string;
    scopeLevel?: ScopeLevel;
    onScopeExit?: OnScopeExit;
    loopEnabled?: boolean;
    loopCount?: number | null;
  }) => {
    await mutatePatch(() => window.castApi.updateMacro({ id, ...fields }));
  }, [mutatePatch]);

  const deleteMacro = useCallback(async (id: Id) => {
    await mutatePatch(() => window.castApi.deleteMacro(id));
    setCurrentMacroId((current) => (current === id ? null : current));
  }, [mutatePatch]);

  const duplicateMacro = useCallback(async (id: Id) => {
    const source = macrosById.get(id);
    if (!source) return null;
    const previousIds = new Set(macros.map((macro) => macro.id));
    const nextSnapshot = await mutatePatch(() => window.castApi.createMacro({
      name: `${source.name} copy`,
      description: source.description,
      scopeLevel: source.scopeLevel,
      onScopeExit: source.onScopeExit,
      loopEnabled: source.loopEnabled,
      loopCount: source.loopCount,
      cues: source.cues.map((link) => ({ cueId: link.cueId, orderIndex: link.orderIndex })),
    }));
    const created = nextSnapshot.macros.find((macro) => !previousIds.has(macro.id));
    if (!created) return null;
    setStatusText(`Duplicated macro: ${created.name}`);
    return created;
  }, [macros, macrosById, mutatePatch, setStatusText]);

  const setMacroCues = useCallback(async (macroId: Id, nextCues: Array<{ id?: Id; cueId: Id; orderIndex: number; delayBeforeMs?: number; delayAfterMs?: number }>) => {
    await mutatePatch(() => window.castApi.updateMacro({ id: macroId, cues: nextCues }));
  }, [mutatePatch]);

  const createBinding = useCallback(async (input: { triggerType: TriggerType; sourceId: Id | null; targetType: TriggerBindingTargetType; targetId: Id }) => {
    const duplicate = triggerBindings.some((binding) => (
      binding.triggerType === input.triggerType
      && binding.sourceId === input.sourceId
      && binding.targetType === input.targetType
      && binding.targetId === input.targetId
    ));
    if (duplicate) return;
    await mutatePatch(() => window.castApi.createTriggerBinding(input));
    const label = input.targetType === 'macro' ? macrosById.get(input.targetId)?.name : 'Cue';
    setStatusText(`Attached ${input.targetType}: ${label ?? 'Item'}`);
  }, [triggerBindings, macrosById, mutatePatch, setStatusText]);

  const deleteBinding = useCallback(async (bindingId: Id) => {
    const binding = triggerBindings.find((entry) => entry.id === bindingId);
    await mutatePatch(() => window.castApi.deleteTriggerBinding(bindingId));
    if (binding) {
      const label = binding.targetType === 'macro' ? macrosById.get(binding.targetId)?.name : 'Cue';
      setStatusText(`Removed ${binding.targetType}: ${label ?? 'Item'}`);
    }
  }, [triggerBindings, macrosById, mutatePatch, setStatusText]);

  const getBindingsForSource = useCallback((triggerType: TriggerType, sourceId: Id | null) => {
    return triggerBindings.filter((binding) => binding.triggerType === triggerType && binding.sourceId === sourceId);
  }, [triggerBindings]);

  const getBindingsForMacro = useCallback((macroId: Id) => {
    return triggerBindings.filter((binding) => binding.targetType === 'macro' && binding.targetId === macroId);
  }, [triggerBindings]);

  const fireTrigger = useCallback((triggerType: TriggerType, sourceId: Id | null) => {
    // Slide activation moves the live context. Sweep first so runs bound to the
    // slide we're leaving are expired; runs bound to the incoming slide survive.
    if (triggerType === 'slide.activate') {
      handleScopeChange(sourceId);
    }

    const matches = triggerBindings.filter((binding) => binding.triggerType === triggerType && binding.sourceId === sourceId && binding.enabled);
    recordObsEvent('playback', 'Automation trigger fired', {
      triggerType,
      sourceId,
      bindingCount: matches.length,
    });

    for (const binding of matches) {
      if (binding.targetType === 'cue') void runCue(binding.targetId);
      else void startMacroRun(binding.targetId, triggerType, sourceId);
    }
  }, [triggerBindings, runCue, startMacroRun, handleScopeChange]);

  useEffect(() => {
    function handleTrigger(event: Event) {
      const customEvent = event as CustomEvent<AutomationTriggerEventDetail>;
      fireTrigger(customEvent.detail.triggerType, customEvent.detail.sourceId);
    }
    window.addEventListener(AUTOMATION_TRIGGER_EVENT, handleTrigger);
    return () => window.removeEventListener(AUTOMATION_TRIGGER_EVENT, handleTrigger);
  }, [fireTrigger]);

  // Fire startup triggers once after the snapshot has loaded. The ref guard
  // makes this a one-shot per app session even if bindings change later.
  const startupFiredRef = useRef(false);
  useEffect(() => {
    if (startupFiredRef.current) return;
    if (isLoading) return;
    startupFiredRef.current = true;
    fireTrigger('app.startup', null);
  }, [isLoading, fireTrigger]);

  const value = useMemo<AutomationContextValue>(() => ({
    state: { cues, macros, bindings: triggerBindings, isLoading, currentMacroId },
    actions: {
      setCurrentMacroId,
      createMacro,
      updateMacroFields,
      deleteMacro,
      duplicateMacro,
      setMacroCues,
      runCue,
      runMacro,
      ensureCue,
      createBinding,
      deleteBinding,
      getBindingsForSource,
      getBindingsForMacro,
    },
  }), [triggerBindings, createBinding, createMacro, cues, currentMacroId, deleteBinding, deleteMacro, duplicateMacro, ensureCue, getBindingsForMacro, getBindingsForSource, isLoading, macros, runCue, runMacro, setMacroCues, updateMacroFields]);

  return (
    <AutomationContext.Provider value={value}>
      {children}
    </AutomationContext.Provider>
  );
}

export function useAutomation() {
  const context = useContext(AutomationContext);
  if (!context) throw new Error('useAutomation must be used within AutomationProvider');
  return context;
}

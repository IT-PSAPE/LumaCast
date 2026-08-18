import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Id } from '@lumacast/kernel';
import {
  createAutomationRuntime,
  resolveMacroScope,
  type AutomationClock,
  type AutomationObservabilityPort,
  type AutomationRuntime,
  type AutomationRuntimePorts,
  type Cue,
  type CueFailurePolicy,
  type CueKind,
  type CuePayload,
  type Macro,
  type OnScopeExit,
  type ScopeLevel,
  type TriggerBinding,
  type TriggerBindingTargetType,
  type TriggerType,
} from '@lumacast/automation';
import { getSlideItemRef } from '@lumacast/composition';
import type { ItemRef } from '@lumacast/composition';
import { useCast } from '@renderer/contexts/app-context';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { usePlaybackCommands } from '@renderer/contexts/playback/playback-context';
import { recordObsEvent } from '@renderer/features/observability/metrics-store';
import { AUTOMATION_TRIGGER_EVENT, type AutomationTriggerEventDetail } from './automation-events';

// The runtime's ports are structurally-typed (issue #219 W8): the runtime
// declares its own minimal port interfaces so the package never imports
// app code, and these real implementations satisfy them by shape alone.
// `AutomationPlaybackPort` (package) and `PlaybackCommandPort` (app) are the
// same shape; assigning the latter where the former is expected needs no cast.
const AUTOMATION_OBSERVABILITY_PORT: AutomationObservabilityPort = { record: recordObsEvent };

const AUTOMATION_REAL_CLOCK: AutomationClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
};

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
    /** Absolute-position reorder of the macro list (v28 `order_index`). */
    reorderMacro: (id: Id, newOrder: number) => Promise<void>;
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

const AutomationContext = createContext<AutomationContextValue | null>(null);

export function AutomationProvider({ children }: { children: ReactNode }) {
  const { snapshot, mutatePatch, runOperation, setStatusText } = useCast();
  const { cues, macros, triggerBindings, cuesById, macrosById, slides } = useProjectContent();
  const playback = usePlaybackCommands();
  const [currentMacroId, setCurrentMacroId] = useState<Id | null>(null);
  const cuesRef = useRef<Cue[]>(cues);
  cuesRef.current = cues;
  const isLoading = snapshot === null;
  // Dedup concurrent ensureCue calls: without this, two simultaneous
  // ensureCue() invocations with the same kind+payload+policy each see a
  // stale `cues` snapshot (mutatePatch hasn't flushed yet) and both POST a
  // fresh cue — leaving an orphan duplicate.
  const inFlightCuesRef = useRef<Map<string, Promise<Cue>>>(new Map());

  // slideId -> owning item ref, refreshed each render for use inside handlers.
  const slideItemRefByIdRef = useRef<Map<Id, ItemRef | null>>(new Map());
  slideItemRefByIdRef.current = useMemo(() => {
    const map = new Map<Id, ItemRef | null>();
    for (const slide of slides) map.set(slide.id, getSlideItemRef(slide));
    return map;
  }, [slides]);
  const resolveItemRef = useCallback((slideId: Id) => slideItemRefByIdRef.current.get(slideId) ?? null, []);

  // The deterministic macro/cue runtime core (issue #219 W8, @lumacast/automation):
  // run bookkeeping, delays, Cancel/Revert, scope-exit sweeps, loop iteration,
  // and trigger firing. `getPorts` is read lazily by the runtime on every
  // operation, so the ports ref below can be refreshed every render (a new
  // `playback` identity, say) without ever recreating the runtime itself and
  // losing in-flight macro runs.
  const portsRef = useRef<AutomationRuntimePorts>({
    playback,
    clock: AUTOMATION_REAL_CLOCK,
    observability: AUTOMATION_OBSERVABILITY_PORT,
    onStatusText: setStatusText,
  });
  portsRef.current = {
    playback,
    clock: AUTOMATION_REAL_CLOCK,
    observability: AUTOMATION_OBSERVABILITY_PORT,
    onStatusText: setStatusText,
  };
  const runtimeRef = useRef<AutomationRuntime | null>(null);
  if (!runtimeRef.current) {
    runtimeRef.current = createAutomationRuntime(() => portsRef.current);
  }
  const runtime = runtimeRef.current;

  // Public single-cue runner (bare-cue trigger bindings, command palette).
  // Runs unscoped/global with no lifecycle tracking and no delay.
  const runCue = useCallback(async (cueId: Id) => {
    const cue = cuesById.get(cueId);
    if (!cue) return;
    await runtime.runCue(cue);
  }, [cuesById, runtime]);

  // Manual run: no trigger context, so scope resolution falls back to global
  // for any macro scoped narrower than that (see resolveMacroScope).
  const runMacro = useCallback(async (macroId: Id) => {
    const macro = macrosById.get(macroId);
    if (!macro) return;
    const scopeContext = resolveMacroScope(macro, null, null, resolveItemRef);
    await runtime.startMacroRun(macro, (cueId) => cuesById.get(cueId), scopeContext);
  }, [macrosById, cuesById, resolveItemRef, runtime]);

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

  const reorderMacro = useCallback(async (id: Id, newOrder: number) => {
    await mutatePatch(() => window.castApi.setMacroOrder(id, newOrder));
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
    runtime.fireTrigger(triggerType, sourceId, {
      triggerBindings,
      resolveCue: (cueId) => cuesById.get(cueId),
      resolveMacro: (macroId) => macrosById.get(macroId),
      resolveItemRef,
    });
  }, [triggerBindings, cuesById, macrosById, resolveItemRef, runtime]);

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
      reorderMacro,
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
  }), [triggerBindings, createBinding, createMacro, cues, currentMacroId, deleteBinding, deleteMacro, duplicateMacro, ensureCue, getBindingsForMacro, getBindingsForSource, isLoading, macros, reorderMacro, runCue, runMacro, setMacroCues, updateMacroFields]);

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

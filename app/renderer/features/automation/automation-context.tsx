import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  Cue,
  CueClearLayer,
  CueFailurePolicy,
  CueKind,
  CuePayload,
  Id,
  Macro,
  TriggerBinding,
  TriggerBindingTargetType,
  TriggerType,
} from '@core/types';
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
    updateMacroFields: (id: Id, fields: { name?: string; description?: string }) => Promise<void>;
    deleteMacro: (id: Id) => Promise<void>;
    duplicateMacro: (id: Id) => Promise<Macro | null>;
    setMacroCues: (macroId: Id, cues: Array<{ id?: Id; cueId: Id; orderIndex: number }>) => Promise<void>;
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
  const { cues, macros, triggerBindings, cuesById, macrosById } = useProjectContent();
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

  const runCue = useCallback(async (cueId: Id) => {
    const cue = cuesById.get(cueId);
    if (!cue) return;

    recordObsEvent('playback', 'Cue started', { cueId, kind: cue.kind });

    try {
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
        case 'flow.wait': {
          const rawMs = Number((cue.payload as { ms: number }).ms);
          const ms = Number.isFinite(rawMs) ? Math.max(0, rawMs) : 0;
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, ms);
          });
          break;
        }
      }
      recordObsEvent('playback', 'Cue completed', { cueId, kind: cue.kind });
    } catch (error) {
      recordObsEvent('error', 'Cue failed', {
        cueId,
        kind: cue.kind,
        error: error instanceof Error ? error.message : String(error),
      }, 'error');
      if (cue.failurePolicy === 'abort') throw error;
    }
  }, [audio, cuesById, layerActions, mediaLayer, overlayLayer, stage, video]);

  const runMacro = useCallback(async (macroId: Id) => {
    const macro = macrosById.get(macroId);
    if (!macro) return;

    recordObsEvent('playback', 'Macro started', { macroId, name: macro.name });

    const ordered = macro.cues.slice().sort((left, right) => left.orderIndex - right.orderIndex);
    for (const link of ordered) {
      try {
        await runCue(link.cueId);
      } catch (error) {
        // runCue rethrows only when the cue's failurePolicy is 'abort'.
        setStatusText(`Macro aborted: ${macro.name}`);
        recordObsEvent('playback', 'Macro aborted', {
          macroId,
          name: macro.name,
          error: error instanceof Error ? error.message : String(error),
        }, 'warn');
        return;
      }
    }

    setStatusText(`Macro ran: ${macro.name}`);
    recordObsEvent('playback', 'Macro completed', { macroId, name: macro.name });
  }, [macrosById, runCue, setStatusText]);

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

  const updateMacroFields = useCallback(async (id: Id, fields: { name?: string; description?: string }) => {
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
      cues: source.cues.map((link) => ({ cueId: link.cueId, orderIndex: link.orderIndex })),
    }));
    const created = nextSnapshot.macros.find((macro) => !previousIds.has(macro.id));
    if (!created) return null;
    setStatusText(`Duplicated macro: ${created.name}`);
    return created;
  }, [macros, macrosById, mutatePatch, setStatusText]);

  const setMacroCues = useCallback(async (macroId: Id, nextCues: Array<{ id?: Id; cueId: Id; orderIndex: number }>) => {
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
    const matches = triggerBindings.filter((binding) => binding.triggerType === triggerType && binding.sourceId === sourceId && binding.enabled);
    recordObsEvent('playback', 'Automation trigger fired', {
      triggerType,
      sourceId,
      bindingCount: matches.length,
    });

    for (const binding of matches) {
      if (binding.targetType === 'cue') void runCue(binding.targetId);
      else void runMacro(binding.targetId);
    }
  }, [triggerBindings, runCue, runMacro]);

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

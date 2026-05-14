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
    refresh: () => Promise<void>;
  };
}

const AutomationContext = createContext<AutomationContextValue | null>(null);

export function AutomationProvider({ children }: { children: ReactNode }) {
  const { runOperation, setStatusText } = useCast();
  const overlayLayer = usePresentationOverlayLayer();
  const mediaLayer = usePresentationMediaLayer();
  const layerActions = usePresentationLayerActions();
  const audio = useAudio();
  const video = useVideo();
  const stage = useStagePlayback();
  const [cues, setCues] = useState<Cue[]>([]);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [bindings, setBindings] = useState<TriggerBinding[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentMacroId, setCurrentMacroId] = useState<Id | null>(null);
  const cuesRef = useRef<Cue[]>([]);
  cuesRef.current = cues;
  // Dedup concurrent ensureCue calls: without this, two simultaneous
  // ensureCue() invocations with the same kind+payload+policy each see a
  // stale `cues` closure (loadDefinitions hasn't flushed yet) and both
  // POST a fresh cue — leaving an orphan duplicate.
  const inFlightCuesRef = useRef<Map<string, Promise<Cue>>>(new Map());

  const loadDefinitions = useCallback(async () => {
    setIsLoading(true);
    try {
      const [nextCues, nextMacros, nextBindings] = await Promise.all([
        window.castApi.listCues(),
        window.castApi.listMacros(),
        window.castApi.listTriggerBindings(),
      ]);
      setCues(nextCues);
      setMacros(nextMacros);
      setBindings(nextBindings);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDefinitions();
  }, [loadDefinitions]);

  const cueMap = useMemo(() => new Map(cues.map((cue) => [cue.id, cue])), [cues]);
  const macroMap = useMemo(() => new Map(macros.map((macro) => [macro.id, macro])), [macros]);

  const runCue = useCallback(async (cueId: Id) => {
    const cue = cueMap.get(cueId);
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
  }, [audio, cueMap, layerActions, mediaLayer, overlayLayer, stage, video]);

  const runMacro = useCallback(async (macroId: Id) => {
    const macro = macroMap.get(macroId);
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
  }, [macroMap, runCue, setStatusText]);

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
        const created = await window.castApi.createCue({ kind: input.kind, payload: input.payload, failurePolicy });
        await loadDefinitions();
        return created;
      } finally {
        inFlightCuesRef.current.delete(dedupKey);
      }
    })();
    inFlightCuesRef.current.set(dedupKey, promise);
    return promise;
  }, [loadDefinitions]);

  const createMacro = useCallback(async () => {
    const created = await runOperation('Creating macro...', () => window.castApi.createMacro({
      name: 'Untitled macro',
      description: '',
      cues: [],
    }));
    await loadDefinitions();
    setCurrentMacroId(created.id);
    setStatusText(`Created macro: ${created.name}`);
    return created;
  }, [loadDefinitions, runOperation, setStatusText]);

  const updateMacroFields = useCallback(async (id: Id, fields: { name?: string; description?: string }) => {
    await window.castApi.updateMacro({ id, ...fields });
    await loadDefinitions();
  }, [loadDefinitions]);

  const deleteMacro = useCallback(async (id: Id) => {
    await window.castApi.deleteMacro(id);
    await loadDefinitions();
    setCurrentMacroId((current) => (current === id ? null : current));
  }, [loadDefinitions]);

  const duplicateMacro = useCallback(async (id: Id) => {
    const source = macroMap.get(id);
    if (!source) return null;
    const created = await window.castApi.createMacro({
      name: `${source.name} copy`,
      description: source.description,
      cues: source.cues.map((link) => ({ cueId: link.cueId, orderIndex: link.orderIndex })),
    });
    await loadDefinitions();
    setStatusText(`Duplicated macro: ${created.name}`);
    return created;
  }, [loadDefinitions, macroMap, setStatusText]);

  const setMacroCues = useCallback(async (macroId: Id, nextCues: Array<{ id?: Id; cueId: Id; orderIndex: number }>) => {
    await window.castApi.updateMacro({ id: macroId, cues: nextCues });
    await loadDefinitions();
  }, [loadDefinitions]);

  const createBinding = useCallback(async (input: { triggerType: TriggerType; sourceId: Id | null; targetType: TriggerBindingTargetType; targetId: Id }) => {
    const duplicate = bindings.some((binding) => (
      binding.triggerType === input.triggerType
      && binding.sourceId === input.sourceId
      && binding.targetType === input.targetType
      && binding.targetId === input.targetId
    ));
    if (duplicate) return;
    await window.castApi.createTriggerBinding(input);
    await loadDefinitions();
    const label = input.targetType === 'macro' ? macroMap.get(input.targetId)?.name : 'Cue';
    setStatusText(`Attached ${input.targetType}: ${label ?? 'Item'}`);
  }, [bindings, loadDefinitions, macroMap, setStatusText]);

  const deleteBinding = useCallback(async (bindingId: Id) => {
    const binding = bindings.find((entry) => entry.id === bindingId);
    await window.castApi.deleteTriggerBinding(bindingId);
    await loadDefinitions();
    if (binding) {
      const label = binding.targetType === 'macro' ? macroMap.get(binding.targetId)?.name : 'Cue';
      setStatusText(`Removed ${binding.targetType}: ${label ?? 'Item'}`);
    }
  }, [bindings, loadDefinitions, macroMap, setStatusText]);

  const getBindingsForSource = useCallback((triggerType: TriggerType, sourceId: Id | null) => {
    return bindings.filter((binding) => binding.triggerType === triggerType && binding.sourceId === sourceId);
  }, [bindings]);

  const getBindingsForMacro = useCallback((macroId: Id) => {
    return bindings.filter((binding) => binding.targetType === 'macro' && binding.targetId === macroId);
  }, [bindings]);

  const fireTrigger = useCallback((triggerType: TriggerType, sourceId: Id | null) => {
    const matches = bindings.filter((binding) => binding.triggerType === triggerType && binding.sourceId === sourceId && binding.enabled);
    recordObsEvent('playback', 'Automation trigger fired', {
      triggerType,
      sourceId,
      bindingCount: matches.length,
    });

    for (const binding of matches) {
      if (binding.targetType === 'cue') void runCue(binding.targetId);
      else void runMacro(binding.targetId);
    }
  }, [bindings, runCue, runMacro]);

  useEffect(() => {
    function handleTrigger(event: Event) {
      const customEvent = event as CustomEvent<AutomationTriggerEventDetail>;
      fireTrigger(customEvent.detail.triggerType, customEvent.detail.sourceId);
    }
    window.addEventListener(AUTOMATION_TRIGGER_EVENT, handleTrigger);
    return () => window.removeEventListener(AUTOMATION_TRIGGER_EVENT, handleTrigger);
  }, [fireTrigger]);

  const value = useMemo<AutomationContextValue>(() => ({
    state: { cues, macros, bindings, isLoading, currentMacroId },
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
      refresh: loadDefinitions,
    },
  }), [bindings, createBinding, createMacro, cues, currentMacroId, deleteBinding, deleteMacro, duplicateMacro, ensureCue, getBindingsForMacro, getBindingsForSource, isLoading, loadDefinitions, macros, runCue, runMacro, setMacroCues, updateMacroFields]);

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

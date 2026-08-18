import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createDefaultThemeElements } from '@lumacast/composition';
import type { Id, Overlay, OverlayCreateInput, OverlayUpdateInput, SlideBackground, SlideElement, Stage, Theme, ThemeKind, GroupElementPayload } from '@core/types';
import { cloneElements, slideElementsSignature } from '../../utils/staged-editor-utils';
import { getOverlayDefaults } from '../../utils/slides';
import { createId } from '../../utils/create-id';
import { useStagedCollection } from '../../hooks/use-staged-collection';
import { buildSnapshotDiff } from '../element/element-history-utils';
import { useCast } from '../app-context';
import { useProjectContent } from '../use-project-content';
import { useWorkbench } from '../workbench-context';

function generateDeterministicCopyName(baseName: string, existingNames: Set<string>): string {
  let candidate = `${baseName} Copy`;
  if (!existingNames.has(candidate.toLowerCase())) return candidate;
  let counter = 2;
  while (existingNames.has(`${baseName} Copy ${counter}`.toLowerCase())) {
    counter += 1;
  }
  return `${baseName} Copy ${counter}`;
}

// ─── Types ──────────────────────────────────────────────────────────

export type ThemeApplyTarget =
  | { type: 'deck-item'; itemId: Id }
  | { type: 'overlay'; overlayId: Id };

interface OverlayEditorValue {
  overlays: Overlay[];
  currentOverlayId: Id | null;
  currentOverlay: Overlay | null;
  hasPendingChanges: boolean;
  isPushingChanges: boolean;
  nameFocusRequest: number;
  setCurrentOverlayId: (overlayId: Id | null) => void;
  updateOverlayDraft: (input: OverlayUpdateInput) => void;
  createOverlay: () => Promise<void>;
  duplicateOverlay: (overlayId: Id) => void;
  deleteCurrentOverlay: () => Promise<void>;
  deleteOverlay: (overlayId: Id) => Promise<void>;
  requestNameFocus: (overlayId: Id) => void;
  pushChanges: () => Promise<void>;
}

export interface ThemeEditorValue {
  themes: Theme[];
  currentThemeId: Id | null;
  currentTheme: Theme | null;
  hasPendingChanges: boolean;
  isPushingChanges: boolean;
  nameFocusRequest: number;
  setCurrentThemeId: (themeId: Id | null) => void;
  openThemeEditor: (themeId: Id) => void;
  updateThemeDraft: (input: { id: Id; name?: string; kind?: ThemeKind; background?: SlideBackground | null; elements?: SlideElement[] }) => void;
  replaceThemeElements: (elements: SlideElement[]) => void;
  createTheme: (kind: ThemeKind) => void;
  applyThemeToTarget: (themeId: Id, target: ThemeApplyTarget) => Promise<void>;
  resolveThemeIdForMutation: (themeId: Id) => Promise<Id>;
  detachThemeFromDeckItem: (itemId: Id) => Promise<void>;
  syncLinkedDeckItems: (themeId: Id) => Promise<void>;
  deleteTheme: (themeId: Id) => void;
  duplicateTheme: (themeId: Id) => void;
  renameTheme: (themeId: Id, name: string) => void;
  requestNameFocus: (themeId: Id) => void;
  pushChanges: () => Promise<Id | null>;
}

interface DeckEditorValue {
  hasPendingChanges: boolean;
  isPushingChanges: boolean;
  getSlideElements: (slideId: Id) => SlideElement[];
  replaceSlideElements: (slideId: Id, elements: SlideElement[]) => void;
  pushChanges: () => Promise<void>;
}

interface StageEditorValue {
  stages: Stage[];
  currentStageId: Id | null;
  currentStage: Stage | null;
  hasPendingChanges: boolean;
  isPushingChanges: boolean;
  nameFocusRequest: number;
  setCurrentStageId: (stageId: Id | null) => void;
  updateStageDraft: (input: { id: Id; name?: string; elements?: SlideElement[] }) => void;
  replaceStageElements: (elements: SlideElement[]) => void;
  createStage: () => Promise<Id | null>;
  duplicateStage: (stageId: Id) => void;
  deleteCurrentStage: () => Promise<void>;
  deleteStage: (stageId: Id) => Promise<void>;
  requestNameFocus: (stageId: Id) => void;
  pushChanges: () => Promise<void>;
}

interface AssetEditorContextValue {
  overlay: OverlayEditorValue;
  theme: ThemeEditorValue;
  deck: DeckEditorValue;
  stage: StageEditorValue;
}

// ─── Context ────────────────────────────────────────────────────────

const OverlayEditorContext = createContext<OverlayEditorValue | null>(null);
const ThemeEditorContext = createContext<ThemeEditorValue | null>(null);
const DeckEditorContext = createContext<DeckEditorValue | null>(null);
const StageEditorContext = createContext<StageEditorValue | null>(null);

// ─── Provider ───────────────────────────────────────────────────────

export function AssetEditorProvider({ children }: { children: ReactNode }) {
  const { mutatePatch, setStatusText } = useCast();
  const { state: { workbenchMode, overlayDefaults } } = useWorkbench();
  const {
    overlays: persistedOverlays,
    themes: persistedThemes,
    stages: persistedStages,
    slideElementsBySlideId,
  } = useProjectContent();

  // ── Overlay editor ──

  const overlayStaged = useStagedCollection<Overlay>({
    persistedItems: persistedOverlays,
    signatureOf: overlaySignature,
    workbenchModeKey: 'overlay-editor',
    currentWorkbenchMode: workbenchMode,
  });

  const overlays = overlayStaged.items;
  const [overlayNameFocusRequest, setOverlayNameFocusRequest] = useState(0);

  const updateOverlayDraft = useCallback((input: OverlayUpdateInput) => {
    overlayStaged.setStagedItems((current) => {
      const source = current ?? persistedOverlays;
      return source.map((overlay) => {
        if (overlay.id !== input.id) return overlay;
        const nextElements = typeof input.elements === 'undefined' ? overlay.elements : cloneElements(input.elements);
        return {
          ...overlay,
          name: input.name ?? overlay.name,
          elements: nextElements,
          animation: input.animation ?? overlay.animation,
          updatedAt: new Date().toISOString(),
        };
      });
    });
  }, [persistedOverlays, overlayStaged]);

  const createOverlayAction = useCallback(async () => {
    const now = new Date().toISOString();
    const overlayId = createId();
    const draft: Overlay = {
      id: overlayId,
      slideId: `${overlayId}:slide`,
      enabled: true,
      collectionId: '',
      createdAt: now, updatedAt: now,
      ...getOverlayDefaults({
        animationKind: overlayDefaults.animationKind,
        durationMs: overlayDefaults.durationMs,
        autoClearDurationMs: overlayDefaults.autoClearDurationMs,
      }),
    };
    overlayStaged.setStagedItems((current) => [...(current ?? persistedOverlays), draft]);
    overlayStaged.setCurrentItemId(draft.id);
    setStatusText('Created overlay');
  }, [overlayDefaults.autoClearDurationMs, overlayDefaults.animationKind, overlayDefaults.durationMs, persistedOverlays, setStatusText, overlayStaged]);

  const deleteCurrentOverlay = useCallback(async () => {
    if (!overlayStaged.currentItemId) return;
    overlayStaged.setStagedItems((current) => {
      const source = current ?? persistedOverlays;
      return source.filter((overlay) => overlay.id !== overlayStaged.currentItemId);
    });
    setStatusText('Deleted overlay');
  }, [overlayStaged, persistedOverlays, setStatusText]);

  const deleteOverlayAction = useCallback(async (overlayId: Id) => {
    overlayStaged.setStagedItems((current) => {
      const source = current ?? persistedOverlays;
      return source.filter((overlay) => overlay.id !== overlayId);
    });
    if (overlayStaged.currentItemId === overlayId) {
      overlayStaged.setCurrentItemId(null);
    }
    setStatusText('Deleted overlay');
  }, [overlayStaged, persistedOverlays, setStatusText]);

  const duplicateOverlayAction = useCallback((overlayId: Id) => {
    const source = overlays.find((overlay) => overlay.id === overlayId);
    if (!source) return;
    const now = new Date().toISOString();
    const duplicate: Overlay = {
      ...cloneOverlay(source),
      id: createId(),
      name: `${source.name} Copy`,
      createdAt: now,
      updatedAt: now,
    };
    overlayStaged.setStagedItems((current) => [...(current ?? persistedOverlays), duplicate]);
    overlayStaged.setCurrentItemId(duplicate.id);
    setStatusText('Duplicated overlay');
  }, [overlays, overlayStaged, persistedOverlays, setStatusText]);

  const requestOverlayNameFocus = useCallback((overlayId: Id) => {
    overlayStaged.setCurrentItemId(overlayId);
    setOverlayNameFocusRequest((v) => v + 1);
  }, [overlayStaged]);

  const pushOverlayChanges = useCallback(async () => {
    if (!overlayStaged.stagedItems || overlayStaged.isPushingChanges) return;
    const stagedOverlays = overlayStaged.stagedItems;
    const stagedSig = stagedOverlays.map(overlaySignature).join();
    const persistedSig = persistedOverlays.map(overlaySignature).join();
    if (stagedSig === persistedSig) {
      overlayStaged.setStagedItems(null);
      return;
    }

    overlayStaged.setIsPushingChanges(true);
    try {
      let resolvedCurrentOverlayId = overlayStaged.currentItemId;
      let knownOverlays = persistedOverlays;
        const persistedById = new Map(persistedOverlays.map((o) => [o.id, o]));
        const stagedById = new Map(stagedOverlays.map((o) => [o.id, o]));

        for (const overlay of persistedOverlays) {
          if (stagedById.has(overlay.id)) continue;
          const next = await mutatePatch(() => window.castApi.deleteOverlay(overlay.id));
          knownOverlays = next.overlays;
        }
        for (const overlay of stagedOverlays) {
          if (persistedById.has(overlay.id)) continue;
          const previousIds = new Set(knownOverlays.map((item) => item.id));
          const next = await mutatePatch(() => window.castApi.createOverlay(toOverlayCreateInput(overlay)));
          knownOverlays = next.overlays;
          const createdOverlay = knownOverlays.find((item) => !previousIds.has(item.id)) ?? null;
          if (createdOverlay && resolvedCurrentOverlayId === overlay.id) resolvedCurrentOverlayId = createdOverlay.id;
        }
        for (const overlay of stagedOverlays) {
          if (!persistedById.has(overlay.id)) continue;
          const persisted = persistedById.get(overlay.id);
          if (!persisted || overlaySignature(overlay) === overlaySignature(persisted)) continue;
          const next = await mutatePatch(() => window.castApi.updateOverlay({
            id: overlay.id,
            name: overlay.name,
            elements: cloneElements(overlay.elements),
            animation: overlay.animation,
          }));
          knownOverlays = next.overlays;
        }

      overlayStaged.setStagedItems(null);
      const nextOverlays = knownOverlays;
      const stillExists = resolvedCurrentOverlayId ? nextOverlays.some((o) => o.id === resolvedCurrentOverlayId) : false;
      if (!resolvedCurrentOverlayId || !stillExists) resolvedCurrentOverlayId = nextOverlays[0]?.id ?? null;
      overlayStaged.setCurrentItemId(resolvedCurrentOverlayId);
      setStatusText('Overlay changes pushed');
    } finally {
      overlayStaged.setIsPushingChanges(false);
    }
  }, [overlayStaged, mutatePatch, persistedOverlays, setStatusText]);

  useEffect(() => {
    // Auto-push runs when leaving the editor; mutatePatch already sets
    // 'Operation failed' on rejection (#221), so absorb the rethrow here.
    overlayStaged.registerAutoPush(() => { void pushOverlayChanges().catch(() => undefined); });
  }, [overlayStaged, pushOverlayChanges]);

  const overlayValue = useMemo<OverlayEditorValue>(() => ({
    overlays,
    currentOverlayId: overlayStaged.currentItemId,
    currentOverlay: overlayStaged.currentItem,
    hasPendingChanges: overlayStaged.hasPendingChanges,
    isPushingChanges: overlayStaged.isPushingChanges,
    nameFocusRequest: overlayNameFocusRequest,
    setCurrentOverlayId: overlayStaged.setCurrentItemId,
    updateOverlayDraft,
    createOverlay: createOverlayAction,
    duplicateOverlay: duplicateOverlayAction,
    deleteCurrentOverlay,
    deleteOverlay: deleteOverlayAction,
    requestNameFocus: requestOverlayNameFocus,
    pushChanges: pushOverlayChanges,
  }), [createOverlayAction, duplicateOverlayAction, overlayStaged.currentItem, overlayStaged.currentItemId, deleteCurrentOverlay, deleteOverlayAction, overlayStaged.hasPendingChanges, overlayStaged.isPushingChanges, overlayNameFocusRequest, overlays, pushOverlayChanges, overlayStaged.setCurrentItemId, requestOverlayNameFocus, updateOverlayDraft]);

  // ── Theme editor ──

  const themeStaged = useStagedCollection<Theme>({
    persistedItems: persistedThemes,
    signatureOf: themeSignature,
    workbenchModeKey: 'theme-editor',
    currentWorkbenchMode: workbenchMode,
  });

  const themes = themeStaged.items;
  const [themeNameFocusRequest, setThemeNameFocusRequest] = useState(0);

  // Maps temporary (client-generated) theme IDs to their persisted IDs after push.
  const tempToPersistedIdMapRef = useRef(new Map<Id, Id>());
  // Holds the current in-flight push promise so concurrent callers await the same one.
  const pushPromiseRef = useRef<Promise<Id | null> | null>(null);
  // Holds in-flight apply operations keyed by target+theme so a duplicate
  // invocation awaits the same promise instead of starting a second mutation.
  const applyPromiseRef = useRef(new Map<string, Promise<void>>());

  const requestThemeNameFocus = useCallback((themeId: Id) => {
    themeStaged.setCurrentItemId(themeId);
    setThemeNameFocusRequest((v) => v + 1);
  }, [themeStaged]);

  const updateThemeDraft = useCallback((input: { id: Id; name?: string; kind?: ThemeKind; background?: SlideBackground | null; elements?: SlideElement[] }) => {
    themeStaged.setStagedItems((current) => {
      const source = current ?? persistedThemes;
      return source.map((theme) => (
        theme.id === input.id
          ? {
            ...theme,
            name: input.name ?? theme.name,
            kind: input.kind ?? theme.kind,
            background: 'background' in input ? input.background : theme.background,
            elements: input.elements ? cloneElements(input.elements) : theme.elements,
            updatedAt: new Date().toISOString(),
          }
          : theme
      ));
    });
  }, [persistedThemes, themeStaged]);

  const replaceThemeElements = useCallback((elements: SlideElement[]) => {
    if (!themeStaged.currentItemId) return;
    updateThemeDraft({ id: themeStaged.currentItemId, elements });
  }, [themeStaged.currentItemId, updateThemeDraft]);

  const createTheme = useCallback((kind: ThemeKind) => {
    const now = new Date().toISOString();
    const id = createId();
    const slideId = `${id}:slide`;
    const draft: Theme = {
      id,
      slideId,
      name: kind === 'lyrics' ? 'New Lyric Theme' : kind === 'overlays' ? 'New Overlay Theme' : 'New Slide Theme',
      kind, width: 1920, height: 1080,
      order: (themes.at(-1)?.order ?? -1) + 1,
      elements: createDefaultThemeElements(kind, slideId, now),
      collectionId: '',
      createdAt: now, updatedAt: now,
    };
    themeStaged.setStagedItems((current) => [...(current ?? persistedThemes), draft]);
    themeStaged.setCurrentItemId(draft.id);
    setStatusText('Created theme');
  }, [persistedThemes, setStatusText, themeStaged, themes]);

  const duplicateTheme = useCallback((themeId: Id) => {
    const sourceTheme = themes.find((t) => t.id === themeId) ?? null;
    if (!sourceTheme) return;
    const now = new Date().toISOString();
    const newId = createId();
    const newSlideId = `${newId}:slide`;
    const clonedTheme = cloneTheme(sourceTheme);
    const existingNames = new Set(themes.map((t) => t.name.toLowerCase()));

    // Recursively clone elements with new collision-free IDs
    const cloneElementsRecursive = (elements: SlideElement[], parentSlideId: string): SlideElement[] => {
      return elements.map((el) => {
        const newElementId = createId();
        const cloned: SlideElement = {
          ...el,
          id: newElementId,
          slideId: parentSlideId,
          // Note: we preserve sourceThemeElementId as it should point to the original theme element
          // The original theme element IDs are the stable source IDs
        };
        if (cloned.type === 'group') {
          const groupPayload = cloned.payload as GroupElementPayload;
          cloned.payload = {
            ...groupPayload,
            children: cloneElementsRecursive(groupPayload.children ?? [], parentSlideId),
          };
        }
        return cloned;
      });
    };

    const duplicate: Theme = {
      ...clonedTheme,
      id: newId,
      slideId: newSlideId,
      name: generateDeterministicCopyName(sourceTheme.name, existingNames),
      collectionId: sourceTheme.collectionId,
      order: (themes.at(-1)?.order ?? -1) + 1,
      background: sourceTheme.background ? JSON.parse(JSON.stringify(sourceTheme.background)) : undefined,
      elements: cloneElementsRecursive(clonedTheme.elements, newSlideId),
      createdAt: now, updatedAt: now,
    };
    themeStaged.setStagedItems((current) => [...(current ?? persistedThemes), duplicate]);
    themeStaged.setCurrentItemId(duplicate.id);
    setStatusText('Duplicated theme');
  }, [persistedThemes, setStatusText, themeStaged, themes]);

  const renameTheme = useCallback((themeId: Id, name: string) => {
    updateThemeDraft({ id: themeId, name });
  }, [updateThemeDraft]);

  const deleteTheme = useCallback((themeId: Id) => {
    themeStaged.setStagedItems((current) => (current ?? persistedThemes).filter((t) => t.id !== themeId));
    themeStaged.setCurrentItemId((current) => (current === themeId ? null : current));
    setStatusText('Deleted theme');
  }, [persistedThemes, setStatusText, themeStaged]);

  const openThemeEditor = useCallback((themeId: Id) => {
    themeStaged.setCurrentItemId(themeId);
  }, [themeStaged]);

  const pushThemeChanges = useCallback(async (): Promise<Id | null> => {
    if (pushPromiseRef.current) return pushPromiseRef.current;
    if (!themeStaged.stagedItems || themeStaged.isPushingChanges) return themeStaged.currentItemId;

    const doPush = async (): Promise<Id | null> => {
      const stagedThemes = themeStaged.stagedItems;
      if (!stagedThemes) return themeStaged.currentItemId;
      const stagedSig = stagedThemes.map(themeSignature).join();
      const persistedSig = persistedThemes.map(themeSignature).join();
      if (stagedSig === persistedSig) {
        themeStaged.setStagedItems(null);
        return themeStaged.currentItemId;
      }

      themeStaged.setIsPushingChanges(true);
      try {
        let resolvedCurrentThemeId = themeStaged.currentItemId;
        let knownThemes = persistedThemes;
          const persistedById = new Map(persistedThemes.map((t) => [t.id, t]));
          const stagedById = new Map(stagedThemes.map((t) => [t.id, t]));

          for (const theme of persistedThemes) {
            if (stagedById.has(theme.id)) continue;
            const next = await mutatePatch(() => window.castApi.deleteTheme(theme.id));
            knownThemes = next.themes;
          }
          for (const theme of stagedThemes) {
            if (persistedById.has(theme.id)) continue;
            const previousIds = new Set(knownThemes.map((item) => item.id));
            const next = await mutatePatch(() => window.castApi.createTheme({
              name: theme.name, kind: theme.kind, width: theme.width, height: theme.height,
              background: theme.background,
              collectionId: theme.collectionId || undefined,
              elements: cloneElements(theme.elements),
            }));
            knownThemes = next.themes;
            const createdTheme = knownThemes.find((item) => !previousIds.has(item.id)) ?? null;
            if (createdTheme) {
              tempToPersistedIdMapRef.current.set(theme.id, createdTheme.id);
              if (resolvedCurrentThemeId === theme.id) resolvedCurrentThemeId = createdTheme.id;
            }
          }
          for (const theme of stagedThemes) {
            if (!persistedById.has(theme.id)) continue;
            const persisted = persistedById.get(theme.id);
            if (!persisted || themeSignature(theme) === themeSignature(persisted)) continue;
            const next = await mutatePatch(() => window.castApi.updateTheme({
              id: theme.id, name: theme.name, kind: theme.kind, width: theme.width, height: theme.height,
              background: theme.background,
              elements: cloneElements(theme.elements),
            }));
            knownThemes = next.themes;
          }

        themeStaged.setStagedItems(null);
        const currentStillExists = resolvedCurrentThemeId ? knownThemes.some((t) => t.id === resolvedCurrentThemeId) : false;
        if (!resolvedCurrentThemeId || !currentStillExists) resolvedCurrentThemeId = knownThemes[0]?.id ?? null;
        themeStaged.setCurrentItemId(resolvedCurrentThemeId);
        setStatusText('Theme changes pushed');
        return resolvedCurrentThemeId;
      } finally {
        themeStaged.setIsPushingChanges(false);
        pushPromiseRef.current = null;
      }
    };

    pushPromiseRef.current = doPush();
    return pushPromiseRef.current;
  }, [themeStaged, mutatePatch, persistedThemes, setStatusText]);

  const resolveThemeIdForMutation = useCallback(async (themeId: Id): Promise<Id> => {
    const mapped = tempToPersistedIdMapRef.current.get(themeId);
    if (mapped) return mapped;
    const isStaged = themeStaged.stagedItems?.some((t) => t.id === themeId) ?? false;
    if (isStaged || themeStaged.currentItemId === themeId || themeStaged.hasPendingChanges) {
      await pushThemeChanges();
      // Newly created staged themes were recorded in the temp->persisted map;
      // every other theme keeps its own id as the persisted id.
      return tempToPersistedIdMapRef.current.get(themeId) ?? themeId;
    }
    return themeId;
  }, [themeStaged.stagedItems, themeStaged.currentItemId, themeStaged.hasPendingChanges, pushThemeChanges]);

  const applyThemeToTarget = useCallback(async (themeId: Id, target: ThemeApplyTarget) => {
    const applyKey = target.type === 'deck-item'
      ? `deck-item:${target.itemId}:${themeId}`
      : `overlay:${target.overlayId}:${themeId}`;
    const inFlight = applyPromiseRef.current.get(applyKey);
    if (inFlight) return inFlight;
    const run = (async () => {
      const resolvedThemeId = await resolveThemeIdForMutation(themeId);
      if (target.type === 'deck-item') {
        await mutatePatch(() => window.castApi.applyThemeToDeckItem(resolvedThemeId, target.itemId));
        setStatusText('Applied theme to item');
        return;
      }
      await mutatePatch(() => window.castApi.applyThemeToOverlay(resolvedThemeId, target.overlayId));
      setStatusText('Applied theme to overlay');
    })();
    applyPromiseRef.current.set(applyKey, run);
    try {
      return await run;
    } finally {
      applyPromiseRef.current.delete(applyKey);
    }
  }, [mutatePatch, resolveThemeIdForMutation, setStatusText]);

  const detachThemeFromDeckItem = useCallback(async (itemId: Id) => {
    await mutatePatch(() => window.castApi.detachThemeFromDeckItem(itemId));
    setStatusText('Detached theme from item');
  }, [mutatePatch, setStatusText]);

  const syncLinkedDeckItems = useCallback(async (themeId: Id) => {
    const resolvedId = await resolveThemeIdForMutation(themeId);
    if (!resolvedId) {
      throw new Error('Failed to resolve theme before sync. Theme persistence may have failed.');
    }
    await mutatePatch(() => window.castApi.syncThemeToLinkedDeckItems(resolvedId));
    setStatusText('Synced linked items to theme');
  }, [resolveThemeIdForMutation, mutatePatch, setStatusText]);

  useEffect(() => {
    // Auto-push runs when leaving the editor; mutatePatch already sets
    // 'Operation failed' on rejection (#221), so absorb the rethrow here.
    themeStaged.registerAutoPush(() => { void pushThemeChanges().catch(() => undefined); });
  }, [themeStaged, pushThemeChanges]);

  const themeValue = useMemo<ThemeEditorValue>(() => ({
    themes,
    currentThemeId: themeStaged.currentItemId,
    currentTheme: themeStaged.currentItem,
    hasPendingChanges: themeStaged.hasPendingChanges,
    isPushingChanges: themeStaged.isPushingChanges,
    nameFocusRequest: themeNameFocusRequest,
    setCurrentThemeId: themeStaged.setCurrentItemId,
    openThemeEditor,
    updateThemeDraft,
    replaceThemeElements,
    createTheme,
    applyThemeToTarget,
    resolveThemeIdForMutation,
    detachThemeFromDeckItem,
    syncLinkedDeckItems,
    deleteTheme,
    duplicateTheme,
    renameTheme,
    requestNameFocus: requestThemeNameFocus,
    pushChanges: pushThemeChanges,
  }), [
    applyThemeToTarget, resolveThemeIdForMutation, createTheme, themeStaged.currentItem, themeStaged.currentItemId,
    deleteTheme, detachThemeFromDeckItem, syncLinkedDeckItems, duplicateTheme, themeStaged.hasPendingChanges, themeStaged.isPushingChanges,
    openThemeEditor, pushThemeChanges, renameTheme, replaceThemeElements, requestThemeNameFocus,
    themeStaged.setCurrentItemId, themeNameFocusRequest, themes, updateThemeDraft,
  ]);

  // ── Stage editor ──

  const stageStaged = useStagedCollection<Stage>({
    persistedItems: persistedStages,
    signatureOf: stageSignature,
    workbenchModeKey: 'stage-editor',
    currentWorkbenchMode: workbenchMode,
  });

  const stages = stageStaged.items;
  const [stageNameFocusRequest, setStageNameFocusRequest] = useState(0);

  const updateStageDraft = useCallback((input: { id: Id; name?: string; elements?: SlideElement[] }) => {
    stageStaged.setStagedItems((current) => {
      const source = current ?? persistedStages;
      return source.map((stage) => (
        stage.id === input.id
          ? {
            ...stage,
            name: input.name ?? stage.name,
            elements: input.elements ? cloneElements(input.elements) : stage.elements,
            updatedAt: new Date().toISOString(),
          }
          : stage
      ));
    });
  }, [persistedStages, stageStaged]);

  const replaceStageElements = useCallback((elements: SlideElement[]) => {
    if (!stageStaged.currentItemId) return;
    updateStageDraft({ id: stageStaged.currentItemId, elements });
  }, [stageStaged.currentItemId, updateStageDraft]);

  const createStageAction = useCallback(async () => {
    const now = new Date().toISOString();
    const stageId = createId();
    const draft: Stage = {
      id: stageId,
      slideId: `${stageId}:slide`,
      name: 'New Stage',
      width: 1920,
      height: 1080,
      order: (stages.at(-1)?.order ?? -1) + 1,
      elements: [],
      collectionId: '',
      createdAt: now,
      updatedAt: now,
    };
    stageStaged.setStagedItems((current) => [...(current ?? persistedStages), draft]);
    stageStaged.setCurrentItemId(draft.id);
    setStatusText('Created stage');
    return draft.id;
  }, [persistedStages, setStatusText, stageStaged, stages]);

  const duplicateStageAction = useCallback((stageId: Id) => {
    const source = stages.find((stage) => stage.id === stageId);
    if (!source) return;
    const now = new Date().toISOString();
    const duplicate: Stage = {
      ...cloneStage(source),
      id: createId(),
      name: `${source.name} Copy`,
      order: (stages.at(-1)?.order ?? -1) + 1,
      createdAt: now,
      updatedAt: now,
    };
    stageStaged.setStagedItems((current) => [...(current ?? persistedStages), duplicate]);
    stageStaged.setCurrentItemId(duplicate.id);
    setStatusText('Duplicated stage');
  }, [persistedStages, setStatusText, stageStaged, stages]);

  const deleteCurrentStage = useCallback(async () => {
    if (!stageStaged.currentItemId) return;
    stageStaged.setStagedItems((current) => {
      const source = current ?? persistedStages;
      return source.filter((stage) => stage.id !== stageStaged.currentItemId);
    });
    setStatusText('Deleted stage');
  }, [persistedStages, setStatusText, stageStaged]);

  const deleteStageAction = useCallback(async (stageId: Id) => {
    stageStaged.setStagedItems((current) => {
      const source = current ?? persistedStages;
      return source.filter((stage) => stage.id !== stageId);
    });
    if (stageStaged.currentItemId === stageId) {
      stageStaged.setCurrentItemId(null);
    }
    setStatusText('Deleted stage');
  }, [persistedStages, setStatusText, stageStaged]);

  const requestStageNameFocus = useCallback((stageId: Id) => {
    stageStaged.setCurrentItemId(stageId);
    setStageNameFocusRequest((v) => v + 1);
  }, [stageStaged]);

  const pushStageChanges = useCallback(async () => {
    if (!stageStaged.stagedItems || stageStaged.isPushingChanges) return;
    const stagedStages = stageStaged.stagedItems;
    const stagedSig = stagedStages.map(stageSignature).join();
    const persistedSig = persistedStages.map(stageSignature).join();
    if (stagedSig === persistedSig) {
      stageStaged.setStagedItems(null);
      return;
    }

    stageStaged.setIsPushingChanges(true);
    try {
      let resolvedCurrentStageId = stageStaged.currentItemId;
      let knownStages = persistedStages;
      const persistedById = new Map(persistedStages.map((s) => [s.id, s]));
      const stagedById = new Map(stagedStages.map((s) => [s.id, s]));

      for (const stage of persistedStages) {
        if (stagedById.has(stage.id)) continue;
        const next = await mutatePatch(() => window.castApi.deleteStage(stage.id));
        knownStages = next.stages;
      }
      for (const stage of stagedStages) {
        if (persistedById.has(stage.id)) continue;
        const previousIds = new Set(knownStages.map((item) => item.id));
        const next = await mutatePatch(() => window.castApi.createStage({
          name: stage.name,
          width: stage.width,
          height: stage.height,
          elements: cloneElements(stage.elements),
        }));
        knownStages = next.stages;
        const createdStage = knownStages.find((item) => !previousIds.has(item.id)) ?? null;
        if (createdStage && resolvedCurrentStageId === stage.id) resolvedCurrentStageId = createdStage.id;
      }
      for (const stage of stagedStages) {
        if (!persistedById.has(stage.id)) continue;
        const persisted = persistedById.get(stage.id);
        if (!persisted || stageSignature(stage) === stageSignature(persisted)) continue;
        const next = await mutatePatch(() => window.castApi.updateStage({
          id: stage.id,
          name: stage.name,
          width: stage.width,
          height: stage.height,
          elements: cloneElements(stage.elements),
        }));
        knownStages = next.stages;
      }

      stageStaged.setStagedItems(null);
      const stillExists = resolvedCurrentStageId ? knownStages.some((s) => s.id === resolvedCurrentStageId) : false;
      if (!resolvedCurrentStageId || !stillExists) resolvedCurrentStageId = knownStages[0]?.id ?? null;
      stageStaged.setCurrentItemId(resolvedCurrentStageId);
      setStatusText('Stage changes pushed');
    } finally {
      stageStaged.setIsPushingChanges(false);
    }
  }, [stageStaged, mutatePatch, persistedStages, setStatusText]);

  useEffect(() => {
    // Auto-push runs when leaving the editor; mutatePatch already sets
    // 'Operation failed' on rejection (#221), so absorb the rethrow here.
    stageStaged.registerAutoPush(() => { void pushStageChanges().catch(() => undefined); });
  }, [stageStaged, pushStageChanges]);

  const stageValue = useMemo<StageEditorValue>(() => ({
    stages,
    currentStageId: stageStaged.currentItemId,
    currentStage: stageStaged.currentItem,
    hasPendingChanges: stageStaged.hasPendingChanges,
    isPushingChanges: stageStaged.isPushingChanges,
    nameFocusRequest: stageNameFocusRequest,
    setCurrentStageId: stageStaged.setCurrentItemId,
    updateStageDraft,
    replaceStageElements,
    createStage: createStageAction,
    duplicateStage: duplicateStageAction,
    deleteCurrentStage,
    deleteStage: deleteStageAction,
    requestNameFocus: requestStageNameFocus,
    pushChanges: pushStageChanges,
  }), [
    createStageAction, duplicateStageAction, stageStaged.currentItem, stageStaged.currentItemId,
    deleteCurrentStage, deleteStageAction, stageStaged.hasPendingChanges, stageStaged.isPushingChanges, stageNameFocusRequest,
    stages, pushStageChanges, replaceStageElements, stageStaged.setCurrentItemId, requestStageNameFocus, updateStageDraft,
  ]);

  // ── Deck editor ──

  const [stagedSlides, setStagedSlides] = useState<Record<Id, SlideElement[]>>({});
  const [isDeckPushingChanges, setIsDeckPushingChanges] = useState(false);
  const previousDeckModeRef = useRef(workbenchMode);

  const persistedElementsBySlideId = useMemo(() => {
    const map = new Map<Id, SlideElement[]>();
    for (const [slideId, elements] of slideElementsBySlideId.entries()) {
      map.set(slideId, elements);
    }
    return map;
  }, [slideElementsBySlideId]);

  const deckHasPendingChanges = useMemo(() => {
    for (const slideId of Object.keys(stagedSlides)) {
      if (!persistedElementsBySlideId.has(slideId)) continue;
      const persisted = persistedElementsBySlideId.get(slideId) ?? [];
      const staged = stagedSlides[slideId] ?? [];
      if (slideElementsSignature(persisted) !== slideElementsSignature(staged)) return true;
    }
    return false;
  }, [persistedElementsBySlideId, stagedSlides]);

  const getSlideElements = useCallback((slideId: Id) => {
    return stagedSlides[slideId] ?? persistedElementsBySlideId.get(slideId) ?? [];
  }, [persistedElementsBySlideId, stagedSlides]);

  const replaceSlideElements = useCallback((slideId: Id, elements: SlideElement[]) => {
    setStagedSlides((current) => ({ ...current, [slideId]: cloneElements(elements) }));
  }, []);

  useEffect(() => {
    setStagedSlides((current) => {
      const stale = Object.keys(current).filter((slideId) => !persistedElementsBySlideId.has(slideId));
      if (stale.length === 0) return current;
      const next = { ...current };
      for (const slideId of stale) delete next[slideId];
      return next;
    });
  }, [persistedElementsBySlideId]);

  const pushDeckChanges = useCallback(async () => {
    if (isDeckPushingChanges) return;
    const pendingSlideIds = Object.keys(stagedSlides).filter((slideId) => {
      if (!persistedElementsBySlideId.has(slideId)) return false;
      const persisted = persistedElementsBySlideId.get(slideId) ?? [];
      const staged = stagedSlides[slideId] ?? [];
      return slideElementsSignature(persisted) !== slideElementsSignature(staged);
    });
    if (pendingSlideIds.length === 0) { setStagedSlides({}); return; }

    setIsDeckPushingChanges(true);
    try {
      // Each mutatePatch call applies its patch before the next runs,
      // keeping the renderer snapshot in sync across the sequence.
      for (const slideId of pendingSlideIds) {
        const persisted = persistedElementsBySlideId.get(slideId) ?? [];
        const staged = stagedSlides[slideId] ?? [];
        const diff = buildSnapshotDiff(persisted, staged);
        if (diff.deletes.length > 0) {
          await mutatePatch(() => window.castApi.deleteElementsBatch(diff.deletes));
        }
        if (diff.updates.length > 0) {
          await mutatePatch(() =>
            diff.updates.length === 1
              ? window.castApi.updateElement(diff.updates[0])
              : window.castApi.updateElementsBatch(diff.updates),
          );
        }
        if (diff.creates.length > 0) {
          await mutatePatch(() =>
            diff.creates.length === 1
              ? window.castApi.createElement(diff.creates[0])
              : window.castApi.createElementsBatch(diff.creates),
          );
        }
      }
      setStagedSlides({});
      setStatusText('Slide changes pushed');
    } finally {
      setIsDeckPushingChanges(false);
    }
  }, [isDeckPushingChanges, mutatePatch, persistedElementsBySlideId, setStatusText, stagedSlides]);

  useEffect(() => {
    const previousMode = previousDeckModeRef.current;
    previousDeckModeRef.current = workbenchMode;
    if (previousMode !== 'deck-editor' || workbenchMode === 'deck-editor') return;
    if (!deckHasPendingChanges || isDeckPushingChanges) return;
    // Mode-exit auto-push; mutatePatch already sets 'Operation failed' on rejection (#221).
    void pushDeckChanges().catch(() => undefined);
  }, [deckHasPendingChanges, isDeckPushingChanges, pushDeckChanges, workbenchMode]);

  const deckValue = useMemo<DeckEditorValue>(() => ({
    hasPendingChanges: deckHasPendingChanges,
    isPushingChanges: isDeckPushingChanges,
    getSlideElements,
    replaceSlideElements,
    pushChanges: pushDeckChanges,
  }), [getSlideElements, deckHasPendingChanges, isDeckPushingChanges, pushDeckChanges, replaceSlideElements]);

  // ── Combined value ──

  return (
    <OverlayEditorContext.Provider value={overlayValue}>
      <ThemeEditorContext.Provider value={themeValue}>
        <DeckEditorContext.Provider value={deckValue}>
          <StageEditorContext.Provider value={stageValue}>
            {children}
          </StageEditorContext.Provider>
        </DeckEditorContext.Provider>
      </ThemeEditorContext.Provider>
    </OverlayEditorContext.Provider>
  );
}

// ─── Hooks ──────────────────────────────────────────────────────────

export function useAssetEditor(): AssetEditorContextValue {
  const overlay = useOverlayEditor();
  const theme = useThemeEditor();
  const deck = useDeckEditor();
  const stage = useStageEditor();
  return { overlay, theme, deck, stage };
}

export function useOverlayEditor(): OverlayEditorValue {
  const ctx = useContext(OverlayEditorContext);
  if (!ctx) throw new Error('useOverlayEditor must be used within AssetEditorProvider');
  return ctx;
}

export function useThemeEditor(): ThemeEditorValue {
  const ctx = useContext(ThemeEditorContext);
  if (!ctx) throw new Error('useThemeEditor must be used within AssetEditorProvider');
  return ctx;
}

export function useDeckEditor(): DeckEditorValue {
  const ctx = useContext(DeckEditorContext);
  if (!ctx) throw new Error('useDeckEditor must be used within AssetEditorProvider');
  return ctx;
}

export function useStageEditor(): StageEditorValue {
  const ctx = useContext(StageEditorContext);
  if (!ctx) throw new Error('useStageEditor must be used within AssetEditorProvider');
  return ctx;
}

// ─── Utils ──────────────────────────────────────────────────────────

function toOverlayCreateInput(overlay: Overlay): OverlayCreateInput {
  return { name: overlay.name, elements: cloneElements(overlay.elements), animation: overlay.animation };
}

function cloneOverlay(overlay: Overlay): Overlay {
  return JSON.parse(JSON.stringify(overlay)) as Overlay;
}

function overlaySignature(overlay: Overlay): string {
  return JSON.stringify({ id: overlay.id, name: overlay.name, animation: overlay.animation, elements: overlay.elements });
}

function themeSignature(theme: Theme): string {
  return JSON.stringify({ id: theme.id, name: theme.name, kind: theme.kind, width: theme.width, height: theme.height, background: theme.background, elements: theme.elements });
}

function cloneTheme(theme: Theme): Theme {
  return JSON.parse(JSON.stringify(theme)) as Theme;
}

function stageSignature(stage: Stage): string {
  return JSON.stringify({ id: stage.id, name: stage.name, width: stage.width, height: stage.height, elements: stage.elements });
}

function cloneStage(stage: Stage): Stage {
  return JSON.parse(JSON.stringify(stage)) as Stage;
}

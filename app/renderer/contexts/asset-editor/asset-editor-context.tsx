import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createDefaultThemeElements } from '@lumacast/composition';
import type { Id } from '@lumacast/kernel';
import type { ItemRef, ItemType, Overlay, SlideBackground, SlideElement, Stage, ThemeOwnerType, GroupElementPayload } from '@lumacast/composition';
import type { EditorThemeSource } from '@lumacast/canvas';
import type { AppSnapshot, OverlayCreateInput, OverlayUpdateInput } from '@lumacast/protocol';
import type { WorkbenchMode } from '../../types/ui';
import { cloneElements, moveStagedItem, slideElementsSignature } from '../../utils/staged-editor-utils';
import { getOverlayDefaults } from '../../utils/slides';
import { createId } from '../../utils/create-id';
import { useStagedCollection } from '../../hooks/use-staged-collection';
import { buildSnapshotDiff } from '../element/element-history-utils';
import { useCast } from '../app-context';
import { useProjectContent } from '../use-project-content';
import { useWorkbench } from '../workbench-context';

const THEME_OWNER_TYPES: readonly ThemeOwnerType[] = ['presentation', 'lyric', 'talk', 'overlay'];

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

// #219 item-model refactor decision D2: `applyThemeToItem` takes an `ItemRef`
// (the item's own type already says which of the three item theme tables is
// legal — no separate `themeType` field needed on the target itself).
export type ThemeApplyTarget =
  | { type: 'item'; itemRef: ItemRef }
  | { type: 'overlay'; overlayId: Id };

interface ThemeDraftInput {
  id: Id;
  name?: string;
  background?: SlideBackground | null;
  elements?: SlideElement[];
}

export interface ThemeEditorValue {
  themeType: ThemeOwnerType;
  setThemeType: (themeType: ThemeOwnerType) => void;
  themes: EditorThemeSource[];
  currentThemeId: Id | null;
  currentTheme: EditorThemeSource | null;
  hasPendingChanges: boolean;
  isPushingChanges: boolean;
  nameFocusRequest: number;
  setCurrentThemeId: (themeId: Id | null) => void;
  openThemeEditor: (themeType: ThemeOwnerType, themeId: Id) => void;
  updateThemeDraft: (input: ThemeDraftInput) => void;
  replaceThemeElements: (elements: SlideElement[]) => void;
  createTheme: (themeType: ThemeOwnerType) => void;
  applyThemeToTarget: (themeId: Id, target: ThemeApplyTarget) => Promise<void>;
  resolveThemeIdForMutation: (themeId: Id) => Promise<Id>;
  detachThemeFromItem: (itemRef: ItemRef) => Promise<void>;
  syncLinkedItems: (themeId: Id, itemType: ItemType) => Promise<void>;
  deleteTheme: (themeId: Id) => void;
  duplicateTheme: (themeId: Id) => void;
  renameTheme: (themeId: Id, name: string) => void;
  /**
   * Persists a drag-reorder of the theme list for the active family. Unlike the
   * staged create/rename/delete actions this writes through immediately —
   * `pushChanges` has no vocabulary for position, so a staged-only reorder
   * would be discarded the moment the buffer cleared.
   */
  reorderTheme: (themeId: Id, newOrder: number) => Promise<void>;
  requestNameFocus: (themeId: Id) => void;
  pushChanges: () => Promise<Id | null>;
}

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
  /** Persists a drag-reorder of the overlay list (writes through — see reorderTheme). */
  reorderOverlay: (overlayId: Id, newOrder: number) => Promise<void>;
  requestNameFocus: (overlayId: Id) => void;
  pushChanges: () => Promise<void>;
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
  /** Persists a drag-reorder of the stage list (writes through — see reorderTheme). */
  reorderStage: (stageId: Id, newOrder: number) => Promise<void>;
  requestNameFocus: (stageId: Id) => void;
  pushChanges: () => Promise<void>;
}

interface AssetEditorContextValue {
  overlay: OverlayEditorValue;
  theme: ThemeEditorValue;
  deck: DeckEditorValue;
  stage: StageEditorValue;
}

// Internal per-family theme state (#219 decision D2: four independent theme
// tables, no merged `Theme` union or `kind` discriminant). One instance of
// this is built per `ThemeOwnerType` below via `useThemeFamily` — all four
// theme entities share the same structural shape (`EditorThemeSource`), so a
// single generic hook covers every family instead of four hand-copied
// implementations.
interface ThemeFamilyState {
  themeType: ThemeOwnerType;
  themes: EditorThemeSource[];
  persistedThemes: EditorThemeSource[];
  stagedThemes: EditorThemeSource[] | null;
  currentThemeId: Id | null;
  currentTheme: EditorThemeSource | null;
  hasPendingChanges: boolean;
  isPushingChanges: boolean;
  setCurrentThemeId: (themeId: Id | null) => void;
  updateThemeDraft: (input: ThemeDraftInput) => void;
  replaceThemeElements: (elements: SlideElement[]) => void;
  createTheme: () => void;
  duplicateTheme: (themeId: Id) => void;
  deleteTheme: (themeId: Id) => void;
  renameTheme: (themeId: Id, name: string) => void;
  reorderTheme: (themeId: Id, newOrder: number) => Promise<void>;
  pushChanges: () => Promise<Id | null>;
}

// ─── Context ────────────────────────────────────────────────────────

const OverlayEditorContext = createContext<OverlayEditorValue | null>(null);
const ThemeEditorContext = createContext<ThemeEditorValue | null>(null);
const DeckEditorContext = createContext<DeckEditorValue | null>(null);
const StageEditorContext = createContext<StageEditorValue | null>(null);

// ─── Per-family theme hook ──────────────────────────────────────────

function pickThemeArray(snapshot: AppSnapshot, themeType: ThemeOwnerType): EditorThemeSource[] {
  if (themeType === 'presentation') return snapshot.presentationThemes;
  if (themeType === 'lyric') return snapshot.lyricThemes;
  if (themeType === 'talk') return snapshot.talkThemes;
  return snapshot.overlayThemes;
}

function defaultThemeName(themeType: ThemeOwnerType): string {
  if (themeType === 'lyric') return 'New Lyric Theme';
  if (themeType === 'talk') return 'New Talk Theme';
  if (themeType === 'overlay') return 'New Overlay Theme';
  return 'New Presentation Theme';
}

function useThemeFamily(
  themeType: ThemeOwnerType,
  persistedThemes: EditorThemeSource[],
  workbenchMode: WorkbenchMode,
  mutatePatch: (action: () => Promise<import('@lumacast/protocol').SnapshotPatch>) => Promise<AppSnapshot>,
  setStatusText: (text: string) => void,
  tempToPersistedIdMapRef: React.MutableRefObject<Map<Id, Id>>,
): ThemeFamilyState {
  const staged = useStagedCollection<EditorThemeSource>({
    persistedItems: persistedThemes,
    signatureOf: themeSignature,
    workbenchModeKey: 'theme-editor',
    currentWorkbenchMode: workbenchMode,
  });

  const themes = staged.items;

  const updateThemeDraft = useCallback((input: ThemeDraftInput) => {
    staged.setStagedItems((current) => {
      const source = current ?? persistedThemes;
      return source.map((theme) => (
        theme.id === input.id
          ? {
            ...theme,
            name: input.name ?? theme.name,
            background: 'background' in input ? input.background : theme.background,
            elements: input.elements ? cloneElements(input.elements) : theme.elements,
            updatedAt: new Date().toISOString(),
          }
          : theme
      ));
    });
  }, [persistedThemes, staged]);

  const replaceThemeElements = useCallback((elements: SlideElement[]) => {
    if (!staged.currentItemId) return;
    updateThemeDraft({ id: staged.currentItemId, elements });
  }, [staged.currentItemId, updateThemeDraft]);

  const createTheme = useCallback(() => {
    const now = new Date().toISOString();
    const id = createId();
    const slideId = `${id}:slide`;
    const draft: EditorThemeSource = {
      id,
      slideId,
      name: defaultThemeName(themeType),
      width: 1920,
      height: 1080,
      order: (themes.at(-1)?.order ?? -1) + 1,
      elements: createDefaultThemeElements(themeType, slideId, now),
      createdAt: now,
      updatedAt: now,
    };
    staged.setStagedItems((current) => [...(current ?? persistedThemes), draft]);
    staged.setCurrentItemId(draft.id);
    setStatusText('Created theme');
  }, [persistedThemes, setStatusText, staged, themeType, themes]);

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

    const duplicate: EditorThemeSource = {
      ...clonedTheme,
      id: newId,
      slideId: newSlideId,
      name: generateDeterministicCopyName(sourceTheme.name, existingNames),
      order: (themes.at(-1)?.order ?? -1) + 1,
      background: sourceTheme.background ? JSON.parse(JSON.stringify(sourceTheme.background)) : undefined,
      elements: cloneElementsRecursive(clonedTheme.elements, newSlideId),
      createdAt: now, updatedAt: now,
    };
    staged.setStagedItems((current) => [...(current ?? persistedThemes), duplicate]);
    staged.setCurrentItemId(duplicate.id);
    setStatusText('Duplicated theme');
  }, [persistedThemes, setStatusText, staged, themes]);

  const renameTheme = useCallback((themeId: Id, name: string) => {
    updateThemeDraft({ id: themeId, name });
  }, [updateThemeDraft]);

  const deleteTheme = useCallback((themeId: Id) => {
    staged.setStagedItems((current) => (current ?? persistedThemes).filter((t) => t.id !== themeId));
    staged.setCurrentItemId((current) => (current === themeId ? null : current));
    setStatusText('Deleted theme');
  }, [persistedThemes, setStatusText, staged]);

  const reorderTheme = useCallback(async (themeId: Id, newOrder: number) => {
    // Keep an open staged buffer in step with the write so the visible list
    // (staged ?? persisted) does not flip back when the patch lands.
    staged.setStagedItems((current) => (current ? moveStagedItem(current, themeId, newOrder) : current));
    await mutatePatch(() => window.castApi.setThemeOrder(themeId, themeType, newOrder));
    setStatusText('Reordered theme');
  }, [mutatePatch, setStatusText, staged, themeType]);

  // Holds the current in-flight push promise so concurrent callers await the same one.
  const pushPromiseRef = useRef<Promise<Id | null> | null>(null);

  const pushChanges = useCallback(async (): Promise<Id | null> => {
    if (pushPromiseRef.current) return pushPromiseRef.current;
    if (!staged.stagedItems || staged.isPushingChanges) return staged.currentItemId;

    const doPush = async (): Promise<Id | null> => {
      const stagedThemes = staged.stagedItems;
      if (!stagedThemes) return staged.currentItemId;
      const stagedSig = stagedThemes.map(themeSignature).join();
      const persistedSig = persistedThemes.map(themeSignature).join();
      if (stagedSig === persistedSig) {
        staged.setStagedItems(null);
        return staged.currentItemId;
      }

      staged.setIsPushingChanges(true);
      try {
        let resolvedCurrentThemeId = staged.currentItemId;
        let knownThemes = persistedThemes;
        const persistedById = new Map(persistedThemes.map((t) => [t.id, t]));
        const stagedById = new Map(stagedThemes.map((t) => [t.id, t]));

        for (const theme of persistedThemes) {
          if (stagedById.has(theme.id)) continue;
          const next = await mutatePatch(() => window.castApi.deleteTheme(theme.id, themeType));
          knownThemes = pickThemeArray(next, themeType);
        }
        for (const theme of stagedThemes) {
          if (persistedById.has(theme.id)) continue;
          const previousIds = new Set(knownThemes.map((item) => item.id));
          const next = await mutatePatch(() => window.castApi.createTheme({
            name: theme.name, themeType, width: theme.width, height: theme.height,
            background: theme.background,
            elements: cloneElements(theme.elements),
          }));
          knownThemes = pickThemeArray(next, themeType);
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
            id: theme.id, themeType, name: theme.name, width: theme.width, height: theme.height,
            background: theme.background,
            elements: cloneElements(theme.elements),
          }));
          knownThemes = pickThemeArray(next, themeType);
        }

        staged.setStagedItems(null);
        const currentStillExists = resolvedCurrentThemeId ? knownThemes.some((t) => t.id === resolvedCurrentThemeId) : false;
        if (!resolvedCurrentThemeId || !currentStillExists) resolvedCurrentThemeId = knownThemes[0]?.id ?? null;
        staged.setCurrentItemId(resolvedCurrentThemeId);
        setStatusText('Theme changes pushed');
        return resolvedCurrentThemeId;
      } finally {
        staged.setIsPushingChanges(false);
        pushPromiseRef.current = null;
      }
    };

    pushPromiseRef.current = doPush();
    return pushPromiseRef.current;
  }, [staged, mutatePatch, persistedThemes, setStatusText, themeType, tempToPersistedIdMapRef]);

  useEffect(() => {
    // Auto-push runs when leaving the editor; mutatePatch already sets
    // 'Operation failed' on rejection (#221), so absorb the rethrow here.
    staged.registerAutoPush(() => { void pushChanges().catch(() => undefined); });
  }, [staged, pushChanges]);

  return {
    themeType,
    themes,
    persistedThemes,
    stagedThemes: staged.stagedItems,
    currentThemeId: staged.currentItemId,
    currentTheme: staged.currentItem,
    hasPendingChanges: staged.hasPendingChanges,
    isPushingChanges: staged.isPushingChanges,
    setCurrentThemeId: staged.setCurrentItemId,
    updateThemeDraft,
    replaceThemeElements,
    createTheme,
    duplicateTheme,
    deleteTheme,
    renameTheme,
    reorderTheme,
    pushChanges,
  };
}

// ─── Provider ───────────────────────────────────────────────────────

export function AssetEditorProvider({ children }: { children: ReactNode }) {
  const { mutatePatch, setStatusText } = useCast();
  const { state: { workbenchMode, overlayDefaults } } = useWorkbench();
  const {
    overlays: persistedOverlays,
    presentationThemes: persistedPresentationThemes,
    lyricThemes: persistedLyricThemes,
    talkThemes: persistedTalkThemes,
    overlayThemes: persistedOverlayThemes,
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
      order: (overlays.at(-1)?.order ?? -1) + 1,
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

  const reorderOverlayAction = useCallback(async (overlayId: Id, newOrder: number) => {
    overlayStaged.setStagedItems((current) => (current ? moveStagedItem(current, overlayId, newOrder) : current));
    await mutatePatch(() => window.castApi.setOverlayOrder(overlayId, newOrder));
    setStatusText('Reordered overlay');
  }, [mutatePatch, overlayStaged, setStatusText]);

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
    reorderOverlay: reorderOverlayAction,
    requestNameFocus: requestOverlayNameFocus,
    pushChanges: pushOverlayChanges,
  }), [createOverlayAction, duplicateOverlayAction, overlayStaged.currentItem, overlayStaged.currentItemId, deleteCurrentOverlay, deleteOverlayAction, overlayStaged.hasPendingChanges, overlayStaged.isPushingChanges, overlayNameFocusRequest, overlays, pushOverlayChanges, reorderOverlayAction, overlayStaged.setCurrentItemId, requestOverlayNameFocus, updateOverlayDraft]);

  // ── Theme editor (per-family, #219 decision D2) ──

  const [themeType, setThemeType] = useState<ThemeOwnerType>('presentation');
  const [themeNameFocusRequest, setThemeNameFocusRequest] = useState(0);
  // Maps temporary (client-generated) theme IDs to their persisted IDs after push,
  // shared across all four families since ids are unique across them in practice.
  const tempToPersistedIdMapRef = useRef(new Map<Id, Id>());
  // Holds in-flight apply operations keyed by target+theme so a duplicate
  // invocation awaits the same promise instead of starting a second mutation.
  const applyPromiseRef = useRef(new Map<string, Promise<void>>());

  const presentationThemeFamily = useThemeFamily('presentation', persistedPresentationThemes, workbenchMode, mutatePatch, setStatusText, tempToPersistedIdMapRef);
  const lyricThemeFamily = useThemeFamily('lyric', persistedLyricThemes, workbenchMode, mutatePatch, setStatusText, tempToPersistedIdMapRef);
  const talkThemeFamily = useThemeFamily('talk', persistedTalkThemes, workbenchMode, mutatePatch, setStatusText, tempToPersistedIdMapRef);
  const overlayThemeFamily = useThemeFamily('overlay', persistedOverlayThemes, workbenchMode, mutatePatch, setStatusText, tempToPersistedIdMapRef);

  const pickFamily = useCallback((type: ThemeOwnerType): ThemeFamilyState => {
    if (type === 'presentation') return presentationThemeFamily;
    if (type === 'lyric') return lyricThemeFamily;
    if (type === 'talk') return talkThemeFamily;
    return overlayThemeFamily;
  }, [lyricThemeFamily, overlayThemeFamily, presentationThemeFamily, talkThemeFamily]);

  const activeFamily = pickFamily(themeType);

  const requestThemeNameFocus = useCallback((themeId: Id) => {
    activeFamily.setCurrentThemeId(themeId);
    setThemeNameFocusRequest((v) => v + 1);
  }, [activeFamily]);

  const openThemeEditor = useCallback((nextThemeType: ThemeOwnerType, themeId: Id) => {
    setThemeType(nextThemeType);
    pickFamily(nextThemeType).setCurrentThemeId(themeId);
  }, [pickFamily]);

  const createThemeAction = useCallback((nextThemeType: ThemeOwnerType) => {
    setThemeType(nextThemeType);
    pickFamily(nextThemeType).createTheme();
  }, [pickFamily]);

  // Finds which family currently knows about `themeId` — either as an
  // already-persisted row or as a staged (unsaved) draft — without requiring
  // the caller to say which of the four independent theme tables it lives
  // in. Callers outside the theme editor (navigation's create-item flow, the
  // per-item inspector) only ever hold a bare theme id.
  const findFamilyForThemeId = useCallback((themeId: Id): ThemeFamilyState | null => {
    for (const type of THEME_OWNER_TYPES) {
      const family = pickFamily(type);
      const isStaged = family.stagedThemes?.some((t) => t.id === themeId) ?? false;
      const isPersisted = family.persistedThemes.some((t) => t.id === themeId);
      if (isStaged || isPersisted) return family;
    }
    return null;
  }, [pickFamily]);

  const resolveThemeIdForMutation = useCallback(async (themeId: Id): Promise<Id> => {
    const mapped = tempToPersistedIdMapRef.current.get(themeId);
    if (mapped) return mapped;
    const family = findFamilyForThemeId(themeId);
    if (!family) return themeId;
    if (family.hasPendingChanges) {
      await family.pushChanges();
    }
    // Newly created staged themes were recorded in the temp->persisted map;
    // every other theme keeps its own id as the persisted id.
    return tempToPersistedIdMapRef.current.get(themeId) ?? themeId;
  }, [findFamilyForThemeId]);

  const applyThemeToTarget = useCallback(async (themeId: Id, target: ThemeApplyTarget) => {
    const applyKey = target.type === 'item'
      ? `item:${target.itemRef.type}:${target.itemRef.id}:${themeId}`
      : `overlay:${target.overlayId}:${themeId}`;
    const inFlight = applyPromiseRef.current.get(applyKey);
    if (inFlight) return inFlight;
    const run = (async () => {
      const resolvedThemeId = await resolveThemeIdForMutation(themeId);
      if (target.type === 'item') {
        await mutatePatch(() => window.castApi.applyThemeToItem(resolvedThemeId, target.itemRef));
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

  const detachThemeFromItem = useCallback(async (itemRef: ItemRef) => {
    await mutatePatch(() => window.castApi.detachThemeFromItem(itemRef));
    setStatusText('Detached theme from item');
  }, [mutatePatch, setStatusText]);

  const syncLinkedItems = useCallback(async (themeId: Id, itemType: ItemType) => {
    const resolvedId = await resolveThemeIdForMutation(themeId);
    if (!resolvedId) {
      throw new Error('Failed to resolve theme before sync. Theme persistence may have failed.');
    }
    await mutatePatch(() => window.castApi.syncThemeToLinkedItems(resolvedId, itemType));
    setStatusText('Synced linked items to theme');
  }, [resolveThemeIdForMutation, mutatePatch, setStatusText]);

  const deleteThemeAction = useCallback((themeIdToDelete: Id) => {
    activeFamily.deleteTheme(themeIdToDelete);
  }, [activeFamily]);

  const duplicateThemeAction = useCallback((themeIdToDuplicate: Id) => {
    activeFamily.duplicateTheme(themeIdToDuplicate);
  }, [activeFamily]);

  const renameThemeAction = useCallback((themeIdToRename: Id, name: string) => {
    activeFamily.renameTheme(themeIdToRename, name);
  }, [activeFamily]);

  const themeValue = useMemo<ThemeEditorValue>(() => ({
    themeType,
    setThemeType,
    themes: activeFamily.themes,
    currentThemeId: activeFamily.currentThemeId,
    currentTheme: activeFamily.currentTheme,
    hasPendingChanges: activeFamily.hasPendingChanges,
    isPushingChanges: activeFamily.isPushingChanges,
    nameFocusRequest: themeNameFocusRequest,
    setCurrentThemeId: activeFamily.setCurrentThemeId,
    openThemeEditor,
    updateThemeDraft: activeFamily.updateThemeDraft,
    replaceThemeElements: activeFamily.replaceThemeElements,
    createTheme: createThemeAction,
    applyThemeToTarget,
    resolveThemeIdForMutation,
    detachThemeFromItem,
    syncLinkedItems,
    deleteTheme: deleteThemeAction,
    duplicateTheme: duplicateThemeAction,
    renameTheme: renameThemeAction,
    reorderTheme: activeFamily.reorderTheme,
    requestNameFocus: requestThemeNameFocus,
    pushChanges: activeFamily.pushChanges,
  }), [
    activeFamily, applyThemeToTarget, createThemeAction, deleteThemeAction, detachThemeFromItem,
    duplicateThemeAction, openThemeEditor, renameThemeAction, requestThemeNameFocus,
    resolveThemeIdForMutation, syncLinkedItems, themeNameFocusRequest, themeType,
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
      createdAt: now,
      updatedAt: now,
    };
    stageStaged.setStagedItems((current) => [...(current ?? persistedStages), draft]);
    stageStaged.setCurrentItemId(draft.id);
    setStatusText('Created stage');
    return draft.id;
  }, [persistedStages, setStatusText, stageStaged, stages]);

  const reorderStageAction = useCallback(async (stageId: Id, newOrder: number) => {
    stageStaged.setStagedItems((current) => (current ? moveStagedItem(current, stageId, newOrder) : current));
    await mutatePatch(() => window.castApi.setStageOrder(stageId, newOrder));
    setStatusText('Reordered stage');
  }, [mutatePatch, setStatusText, stageStaged]);

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
    reorderStage: reorderStageAction,
    requestNameFocus: requestStageNameFocus,
    pushChanges: pushStageChanges,
  }), [
    createStageAction, duplicateStageAction, stageStaged.currentItem, stageStaged.currentItemId,
    deleteCurrentStage, deleteStageAction, stageStaged.hasPendingChanges, stageStaged.isPushingChanges, stageNameFocusRequest,
    stages, pushStageChanges, replaceStageElements, reorderStageAction, stageStaged.setCurrentItemId, requestStageNameFocus, updateStageDraft,
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
    if (previousMode !== 'item-editor' || workbenchMode === 'item-editor') return;
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

function themeSignature(theme: EditorThemeSource): string {
  return JSON.stringify({ id: theme.id, name: theme.name, width: theme.width, height: theme.height, background: theme.background, elements: theme.elements });
}

function cloneTheme(theme: EditorThemeSource): EditorThemeSource {
  return JSON.parse(JSON.stringify(theme)) as EditorThemeSource;
}

function stageSignature(stage: Stage): string {
  return JSON.stringify({ id: stage.id, name: stage.name, width: stage.width, height: stage.height, elements: stage.elements });
}

function cloneStage(stage: Stage): Stage {
  return JSON.parse(JSON.stringify(stage)) as Stage;
}

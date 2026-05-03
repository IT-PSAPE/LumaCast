import { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { isLyricDeckItem } from '@core/deck-items';
import type { ElementUpdateInput, Id, MediaAsset, Overlay, Slide, SlideElement } from '@core/types';
import { applyVisualPayload, readVisualPayload } from '@core/element-payload';
import { sortElements } from '../../utils/slides';
import { useCast } from '../app-context';
import { useNavigation } from '../navigation-context';
import { useDeckEditor } from '../asset-editor/asset-editor-context';
import { usePresentationRenderLayer } from '../playback/playback-context';
import { useSlides } from '../slide-context';
import { useProjectContent } from '../use-project-content';
import { useWorkbench } from '../workbench-context';
import { useElementCommands } from '../element/use-element-commands';
import { useElementHistory } from '../element/use-element-history';
import { useElementInspectorSync } from '../element/use-element-inspector-sync';
import { useElementSelection } from '../element/use-element-selection';
import type { ElementContextValue } from '../../types/element-context.types';
import { cloneElements } from '../../utils/element-context-utils';
import { buildLayeredRenderScene, buildRenderScene, buildThumbnailScene } from '../../features/canvas/build-render-scene';
import type { RenderScene, SceneSourcePolicy, SceneSurface } from '../../features/canvas/scene-types';
import { useActiveEditorSource } from './use-active-editor-source';

// ─── Types ──────────────────────────────────────────────────────────

interface RenderSceneValue {
  editScene: RenderScene;
  showScene: RenderScene;
  liveScene: RenderScene;
  programScene: RenderScene;
  getThumbnailScene: (slideId: Id, surface: SceneSurface) => RenderScene | null;
  commitProgramScene: () => void;
}

interface CanvasContextValue {
  elements: ElementContextValue;
  scenes: RenderSceneValue;
}

// ─── Context ────────────────────────────────────────────────────────

const CanvasElementsContext = createContext<ElementContextValue | null>(null);
const CanvasScenesContext = createContext<RenderSceneValue | null>(null);

// ─── Exports for scene utilities ────────────────────────────────────

export function thumbnailSourcePolicy(surface: SceneSurface, isCurrentSlide: boolean): SceneSourcePolicy {
  if (surface === 'deck-editor') return 'draft';
  if (surface === 'show' || surface === 'list') return 'persisted';
  if (isCurrentSlide) return 'draft';
  return 'persisted';
}

export function selectThumbnailElements(policy: SceneSourcePolicy, effectiveElements: SlideElement[], persistedElements: SlideElement[]): SlideElement[] {
  if (policy === 'draft') return effectiveElements;
  return persistedElements;
}

// ─── Provider ───────────────────────────────────────────────────────

export function CanvasProvider({ children }: { children: ReactNode }) {
  const { mutatePatch, setStatusText } = useCast();
  const { currentDeckItem } = useNavigation();
  const { currentSlide, liveSlide, liveElements, slideElementsById } = useSlides();
  const { slides: projectSlides, slideElementsBySlideId: projectSlideElementsBySlideId } = useProjectContent();
  const { getSlideElements, replaceSlideElements } = useDeckEditor();
  const { mediaLayerAsset, videoLayerAsset, videoLayerPlayback, activeOverlays, contentLayerVisible } = usePresentationRenderLayer();
  const { state: { workbenchMode } } = useWorkbench();
  const activeEditorSource = useActiveEditorSource();
  const isDeckEdit = activeEditorSource.mode === 'deck-editor';
  const isOverlayEdit = activeEditorSource.mode === 'overlay-editor';
  const isThemeEdit = activeEditorSource.mode === 'theme-editor';

  // ════════════════════════════════════════════════════════════════════
  // Element editing
  // ════════════════════════════════════════════════════════════════════

  const [draftElements, setDraftElements] = useState<Record<Id, Partial<SlideElement>>>({});
  const [isCanvasInteracting, setCanvasInteracting] = useState(false);
  const previousSlideIdRef = useRef<Id | null>(null);
  const previousSlideElementsRef = useRef<SlideElement[]>([]);

  const baseElements = useMemo(() => sortElements(activeEditorSource.elements), [activeEditorSource.elements]);

  const effectiveElements = useMemo(
    () => sortElements(baseElements.map((element) => ({ ...element, ...(draftElements[element.id] ?? {}) }))),
    [baseElements, draftElements],
  );

  useEffect(() => {
    const previousSlideId = previousSlideIdRef.current;
    const previousSlideElements = previousSlideElementsRef.current;

    const currentDeckSlideId = activeEditorSource.mode === 'deck-editor' ? activeEditorSource.meta.slideId : null;

    if (previousSlideId && (!isDeckEdit || previousSlideId !== currentDeckSlideId)) {
      replaceSlideElements(previousSlideId, previousSlideElements);
      setDraftElements((current) => removeDraftPatchesForElements(current, previousSlideElements));
    }

    if (!isDeckEdit) {
      previousSlideIdRef.current = null;
      previousSlideElementsRef.current = [];
      return;
    }

    previousSlideIdRef.current = currentDeckSlideId;
    previousSlideElementsRef.current = cloneElements(effectiveElements);
  }, [activeEditorSource, effectiveElements, isDeckEdit, replaceSlideElements]);

  const selection = useElementSelection({ effectiveElements });

  useEffect(() => {
    if (!isOverlayEdit) return;
    const currentOverlay = activeEditorSource.meta.overlay;
    if (!currentOverlay) {
      selection.clearSelection();
      return;
    }
    if (isOverlaySelectionValid(currentOverlay, selection.primarySelectedElementId)) return;
    selection.clearSelection();
  }, [activeEditorSource, isOverlayEdit, selection.clearSelection, selection.primarySelectedElementId]);

  const saveElementUpdate = useCallback(async (input: ElementUpdateInput) => {
    if (activeEditorSource.editable && activeEditorSource.hasSource) {
      activeEditorSource.replaceElements(applyElementUpdates(activeEditorSource.elements, [input]));
      return;
    }
    await mutatePatch(() => window.castApi.updateElement(input));
  }, [activeEditorSource, mutatePatch]);

  const saveElementUpdates = useCallback(async (updates: ElementUpdateInput[]) => {
    if (updates.length === 0) return;
    if (activeEditorSource.editable && activeEditorSource.hasSource) {
      activeEditorSource.replaceElements(applyElementUpdates(activeEditorSource.elements, updates));
      return;
    }
    await mutatePatch(() => {
      if (updates.length === 1) return window.castApi.updateElement(updates[0]);
      return window.castApi.updateElementsBatch(updates);
    });
  }, [activeEditorSource, mutatePatch]);

  const inspector = useElementInspectorSync({
    selectedElementId: selection.primarySelectedElementId,
    baseElements,
    isCanvasInteracting,
    draftElements,
    setDraftElements,
    saveElementUpdate,
  });

  const history = useElementHistory({
    baseElements,
    effectiveElements,
    activeEditorEntityId: activeEditorSource.entityId,
    hasActiveEditorSource: activeEditorSource.editable && activeEditorSource.hasSource,
    historyKey: activeEditorSource.historyKey,
    selectedElementIds: selection.selectedElementIds,
    mutatePatch,
    setStatusText,
    selectElements: selection.selectElements,
    setDraftElements,
    setCanvasInteracting,
    saveElementUpdates,
    replaceElements: activeEditorSource.editable && activeEditorSource.hasSource
      ? async (elements) => { activeEditorSource.replaceElements(elements); }
      : undefined,
  });

  const deleteSelected = useCallback(async () => {
    const protectedLyricTextIds = new Set(getProtectedLyricTextSelectionIds(
      effectiveElements, selection.selectedElementIds,
      isThemeEdit ? activeEditorSource.meta.themeKind === 'lyrics' : isDeckEdit && isLyricDeckItem(currentDeckItem),
    ));
    const targetIds = getUnlockedSelectedElementIds(effectiveElements, selection.selectedElementIds)
      .filter((id) => !protectedLyricTextIds.has(id));
    if (targetIds.length === 0 && protectedLyricTextIds.size > 0) {
      setStatusText('Lyrics always keep one text layer. Hide it instead of deleting it.');
      return;
    }
    if (targetIds.length === 0) return;
    history.pushHistorySnapshot();
    if (activeEditorSource.editable && activeEditorSource.hasSource) {
      activeEditorSource.replaceElements(activeEditorSource.elements.filter((el) => !targetIds.includes(el.id)));
    } else {
      await mutatePatch(() => targetIds.length === 1 ? window.castApi.deleteElement(targetIds[0]) : window.castApi.deleteElementsBatch(targetIds));
    }
    setStatusText('Deleted selected object(s)');
    selection.selectElements(selection.selectedElementIds.filter((id) => protectedLyricTextIds.has(id)));
    setDraftElements({});
  }, [activeEditorSource, currentDeckItem, effectiveElements, history, isDeckEdit, isThemeEdit, mutatePatch, selection, setStatusText]);

  const toggleElementVisibility = useCallback(async (id: Id, visible: boolean) => {
    const target = effectiveElements.find((el) => el.id === id);
    if (!target) return;
    const nextVisualState = { ...readVisualPayload(target.type, target.payload), visible };
    const nextPayload = applyVisualPayload(target.type, target.payload, nextVisualState);
    await saveElementUpdate({ id, payload: nextPayload });
    if (selection.primarySelectedElementId === id) inspector.setElementPayloadDraft(nextPayload);
    setStatusText(visible ? 'Object shown' : 'Object hidden');
  }, [effectiveElements, inspector, saveElementUpdate, selection.primarySelectedElementId, setStatusText]);

  const toggleElementLock = useCallback(async (id: Id, locked: boolean) => {
    const target = effectiveElements.find((el) => el.id === id);
    if (!target) return;
    const nextVisualState = { ...readVisualPayload(target.type, target.payload), locked };
    const nextPayload = applyVisualPayload(target.type, target.payload, nextVisualState);
    await saveElementUpdate({ id, payload: nextPayload });
    if (selection.primarySelectedElementId === id) inspector.setElementPayloadDraft(nextPayload);
  }, [effectiveElements, inspector, saveElementUpdate, selection.primarySelectedElementId]);

  const { createText, createShape, createFromMedia, createOverlay, toggleOverlay, importMedia, deleteMedia, changeMediaSrc } = useElementCommands({
    activeEditorSource, currentDeckItem, mutatePatch, setStatusText, pushHistorySnapshot: history.pushHistorySnapshot,
  });

  const cutSelection = useCallback(async () => {
    history.copySelection();
    await deleteSelected();
  }, [deleteSelected, history]);

  const elementsValue = useMemo<ElementContextValue>(() => ({
    selectedElementId: selection.primarySelectedElementId,
    selectedElementIds: selection.selectedElementIds,
    primarySelectedElementId: selection.primarySelectedElementId,
    selectedElement: selection.selectedElement,
    effectiveElements, baseElements, draftElements,
    elementDraft: inspector.elementDraft,
    elementPayloadDraft: inspector.elementPayloadDraft,
    lockAspectRatio: inspector.lockAspectRatio,
    isCanvasInteracting,
    selectElement: selection.selectElement,
    selectElements: selection.selectElements,
    toggleElementSelection: selection.toggleElementSelection,
    clearSelection: selection.clearSelection,
    setDraftElements, setElementDraft: inspector.setElementDraft,
    setElementPayloadDraft: inspector.setElementPayloadDraft,
    setLockAspectRatio: inspector.setLockAspectRatio,
    setCanvasInteracting,
    commitElementUpdates: history.commitElementUpdates,
    deleteSelected, toggleElementVisibility, toggleElementLock,
    nudgeSelection: history.nudgeSelection,
    copySelection: history.copySelection,
    cutSelection,
    pasteSelection: history.pasteSelection,
    duplicateSelection: history.duplicateSelection,
    undo: history.undo,
    redo: history.redo,
    createText, createShape,
    createFromMedia: (asset: MediaAsset, x: number, y: number) => createFromMedia(asset, x, y),
    createOverlay, toggleOverlay, importMedia, deleteMedia, changeMediaSrc,
  }), [
    baseElements, createFromMedia, createOverlay, createShape, createText, cutSelection, deleteMedia,
    deleteSelected, draftElements, effectiveElements, history, importMedia, inspector,
    isCanvasInteracting, selection,
    setDraftElements, toggleElementLock, toggleElementVisibility, toggleOverlay, changeMediaSrc,
  ]);

  // ════════════════════════════════════════════════════════════════════
  // Scene rendering
  // ════════════════════════════════════════════════════════════════════

  const editScene = useMemo(() => {
    return buildRenderScene(activeEditorSource.frame, effectiveElements);
  }, [activeEditorSource.frame, effectiveElements]);

  const showScene = useMemo(() => {
    const currentElements = currentSlide ? (slideElementsById.get(currentSlide.id) ?? []) : [];
    return buildRenderScene(currentSlide, currentElements);
  }, [currentSlide, slideElementsById]);

  const liveScene = useMemo(() => {
    return buildLayeredRenderScene({
      slide: liveSlide,
      contentElements: liveElements,
      videoAsset: videoLayerAsset,
      videoPlayback: videoLayerPlayback,
      mediaAsset: mediaLayerAsset,
      overlays: activeOverlays.map((overlay) => ({
        overlay: overlay.overlay,
        opacityMultiplier: overlay.opacityMultiplier,
        stackOrder: overlay.stackOrder,
        startedAt: overlay.startedAt,
      })),
      includeContent: contentLayerVisible,
    });
  }, [activeOverlays, contentLayerVisible, liveElements, liveSlide, mediaLayerAsset, videoLayerAsset, videoLayerPlayback]);

  const isEditing = workbenchMode !== 'show';
  const [frozenProgramScene, setFrozenProgramScene] = useState<RenderScene | null>(null);
  const pendingCommitRef = useRef(false);

  useEffect(() => {
    if (isEditing) {
      setFrozenProgramScene(liveScene);
    } else {
      setFrozenProgramScene(null);
      pendingCommitRef.current = false;
    }
  }, [isEditing]);

  useEffect(() => {
    if (pendingCommitRef.current && isEditing) {
      setFrozenProgramScene(liveScene);
      pendingCommitRef.current = false;
    }
  }, [isEditing, liveScene]);

  const commitProgramScene = useCallback(() => {
    pendingCommitRef.current = true;
  }, []);

  const hasLiveProgram = liveSlide !== null;
  const programScene = !hasLiveProgram ? liveScene : isEditing && frozenProgramScene ? frozenProgramScene : liveScene;

  const projectSlidesById = useMemo(() => {
    const map = new Map<Id, (typeof projectSlides)[number]>();
    for (const slide of projectSlides) map.set(slide.id, slide);
    return map;
  }, [projectSlides]);

  // Thumbnail scene cache keyed by slide id. Each entry remembers the slide
  // and elements references it was built from; returns the cached scene when
  // both references match. `stableArray` in useProjectContent keeps refs
  // stable when content is unchanged, so this avoids rebuilding the Konva
  // scene tree on every render of the slide grid.
  const thumbnailCacheRef = useRef<Map<Id, { slide: Slide; elements: SlideElement[]; scene: RenderScene }>>(new Map());

  useEffect(() => {
    const cache = thumbnailCacheRef.current;
    for (const id of cache.keys()) {
      if (!projectSlidesById.has(id)) cache.delete(id);
    }
  }, [projectSlidesById]);

  const getThumbnailScene = useCallback((slideId: Id, surface: SceneSurface): RenderScene | null => {
    const slide = projectSlidesById.get(slideId);
    if (!slide) return null;
    const policy = thumbnailSourcePolicy(surface, currentSlide?.id === slideId);
    const elements = policy === 'draft'
      ? (currentSlide?.id === slideId ? effectiveElements : getSlideElements(slideId))
      : (projectSlideElementsBySlideId.get(slideId) ?? []);
    const cache = thumbnailCacheRef.current;
    const cached = cache.get(slideId);
    if (cached && cached.slide === slide && cached.elements === elements) {
      return cached.scene;
    }
    const scene = buildThumbnailScene(slide, elements);
    cache.set(slideId, { slide, elements, scene });
    return scene;
  }, [currentSlide?.id, effectiveElements, getSlideElements, projectSlideElementsBySlideId, projectSlidesById]);

  const scenesValue = useMemo<RenderSceneValue>(() => ({
    editScene, showScene, liveScene, programScene, getThumbnailScene, commitProgramScene,
  }), [commitProgramScene, editScene, getThumbnailScene, liveScene, programScene, showScene]);

  // ════════════════════════════════════════════════════════════════════
  // Combined value
  // ════════════════════════════════════════════════════════════════════

  return (
    <CanvasElementsContext.Provider value={elementsValue}>
      <CanvasScenesContext.Provider value={scenesValue}>
        {children}
      </CanvasScenesContext.Provider>
    </CanvasElementsContext.Provider>
  );
}

// ─── Hooks ──────────────────────────────────────────────────────────

export function useCanvas(): CanvasContextValue {
  const elements = useElements();
  const scenes = useRenderScenes();
  return { elements, scenes };
}

export function useElements(): ElementContextValue {
  const ctx = useContext(CanvasElementsContext);
  if (!ctx) throw new Error('useElements must be used within CanvasProvider');
  return ctx;
}

export function useRenderScenes(): RenderSceneValue {
  const ctx = useContext(CanvasScenesContext);
  if (!ctx) throw new Error('useRenderScenes must be used within CanvasProvider');
  return ctx;
}

// ─── Element helpers ────────────────────────────────────────────────

function applyElementUpdates(elements: SlideElement[], updates: ElementUpdateInput[]): SlideElement[] {
  if (updates.length === 0) return elements;
  const updatesById = new Map(updates.map((update) => [update.id, update]));
  return elements.map((element) => {
    const update = updatesById.get(element.id);
    if (!update) return element;
    return {
      ...element,
      x: update.x ?? element.x, y: update.y ?? element.y,
      width: update.width ?? element.width, height: update.height ?? element.height,
      rotation: update.rotation ?? element.rotation, opacity: update.opacity ?? element.opacity,
      zIndex: update.zIndex ?? element.zIndex, layer: update.layer ?? element.layer,
      payload: update.payload ?? element.payload,
    };
  });
}

export function isOverlaySelectionValid(overlay: Overlay, selectedElementId: Id | null): boolean {
  if (!selectedElementId) return false;
  if (overlay.elements.length === 0) return overlay.id === selectedElementId;
  return overlay.elements.some((el) => el.id === selectedElementId);
}

export function getProtectedLyricTextSelectionIds(effectiveElements: SlideElement[], selectedElementIds: Id[], isLyricsPresentation: boolean): Id[] {
  if (!isLyricsPresentation) return [];
  return effectiveElements.filter((el) => selectedElementIds.includes(el.id)).filter((el) => el.type === 'text').map((el) => el.id);
}

function getUnlockedSelectedElementIds(effectiveElements: SlideElement[], selectedElementIds: Id[]): Id[] {
  return effectiveElements.filter((el) => selectedElementIds.includes(el.id)).filter((el) => !el.payload.locked).map((el) => el.id);
}

function removeDraftPatchesForElements(draftElements: Record<Id, Partial<SlideElement>>, elements: SlideElement[]): Record<Id, Partial<SlideElement>> {
  const nextDrafts = { ...draftElements };
  let changed = false;
  for (const element of elements) {
    if (!(element.id in nextDrafts)) continue;
    delete nextDrafts[element.id];
    changed = true;
  }
  return changed ? nextDrafts : draftElements;
}

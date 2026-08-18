import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { getSlideItemRef } from '@lumacast/composition';
import type { Id } from '@lumacast/kernel';
import type { ItemRef, Slide, SlideBackground, SlideElement, TalkScriptBlock } from '@lumacast/composition';
import type { AppSnapshot } from '@lumacast/protocol';
import { clamp, sortSlides } from '../utils/slides';
import { itemRefsEqual } from '../utils/navigation-context-utils';
import { useIndexedSelection } from '../hooks/use-indexed-selection';
import { useCast } from './app-context';
import { useNavigation } from './navigation-context';
import { itemRefKey, useProjectContent } from './use-project-content';
import { dispatchAutomationTriggerEvent } from '../features/automation/automation-events';

// #219 item-model refactor decision D9: selection stays keyed on playlist
// entry ids (preserved across the migration) for the playlist/live cases;
// the detached-browser case, which previously keyed on the bare merged
// deck-item id, now keys on `itemRefKey(currentItemRef)` — there is no
// merged id space to rely on any more. "Is this a talk" gating reads
// `ItemRef.type` directly: Presentation/Lyric/Talk carry no `type` field of
// their own (wave A decision), so the discriminant only ever lives on the
// reference, never on the resolved entity.

interface SlideContextValue {
  slides: Slide[];
  currentSlideIndex: number;
  liveSlideIndex: number;
  currentSlide: Slide | null;
  liveSlide: Slide | null;
  liveElements: SlideElement[];
  nextLiveSlide: Slide | null;
  nextLiveElements: SlideElement[];
  liveTalkScriptBlock: TalkScriptBlock | null;
  liveTalkScriptProgress: string | null;
  slideElementsById: Map<Id, SlideElement[]>;
  isOutputArmedOnCurrent: boolean;
  setCurrentSlideIndex: (idx: number) => void;
  clearCurrentSlideSelection: () => void;
  activateSlide: (idx: number) => void;
  armCurrentPlaylistSelection: () => void;
  takeSlide: () => void;
  goNext: () => void;
  goPrev: () => void;
  selectPlaylistEntry: (entryId: Id) => void;
  selectPlaylistItem: (itemRef: ItemRef) => void;
  focusPlaylistEntrySlide: (entryId: Id, itemRef: ItemRef, index: number) => void;
  activatePlaylistEntrySlide: (entryId: Id, itemRef: ItemRef, index: number) => void;
  createSlide: () => Promise<void>;
  duplicateSlide: (slideId: Id) => Promise<void>;
  deleteSlide: (slideId: Id) => Promise<void>;
  moveSlide: (slideId: Id, direction: 'up' | 'down') => Promise<void>;
  reorderSlide: (slideId: Id, newOrder: number) => Promise<void>;
  updateCurrentSlideNotes: (notes: string) => Promise<void>;
  updateCurrentSlideBackground: (background: SlideBackground | null) => Promise<void>;
}

const SlideContext = createContext<SlideContextValue | null>(null);
const NO_SLIDE_SELECTED = -1;

export function SlideProvider({ children }: { children: ReactNode }) {
  const { mutatePatch, runOperation, setStatusText } = useCast();
  const {
    currentItemRef,
    currentPlaylistEntryId,
    currentPlaylistItemRef,
    currentOutputPlaylistEntryId,
    currentOutputItemRef,
    isDetachedDeckBrowser,
    armOutputPlaylistEntry,
    selectPlaylistEntry: selectPlaylistEntryInNavigation,
    selectPlaylistItem: selectPlaylistItemInNavigation,
  } = useNavigation();
  const { slidesForItemRef, slideElementsBySlideId, talkScriptBlocksBySlideId } = useProjectContent();

  const playlistSelection = useIndexedSelection();
  const drawerSelection = useIndexedSelection();
  const liveSelection = useIndexedSelection();
  const talkScriptSelection = useIndexedSelection();

  const slides = useMemo(() => slidesForItemRef(currentItemRef), [currentItemRef, slidesForItemRef]);
  const outputSlides = useMemo(() => slidesForItemRef(currentOutputItemRef), [currentOutputItemRef, slidesForItemRef]);

  const currentSlideIndex = useMemo(() => {
    const indicesByKey = isDetachedDeckBrowser ? drawerSelection.indices : playlistSelection.indices;
    const selectionKey = isDetachedDeckBrowser
      ? (currentItemRef ? itemRefKey(currentItemRef) : null)
      : currentPlaylistEntryId;
    return resolveSlideIndex(selectionKey, indicesByKey, slides.length);
  }, [
    currentItemRef,
    currentPlaylistEntryId,
    drawerSelection.indices,
    isDetachedDeckBrowser,
    playlistSelection.indices,
    slides.length,
  ]);

  const liveSlideIndex = useMemo(
    () => resolveSlideIndex(
      currentOutputPlaylistEntryId ?? (currentOutputItemRef ? itemRefKey(currentOutputItemRef) : null),
      liveSelection.indices,
      outputSlides.length,
    ),
    [currentOutputItemRef, currentOutputPlaylistEntryId, liveSelection.indices, outputSlides.length],
  );

  const currentSlide = slides[currentSlideIndex] ?? null;
  const liveSlide = outputSlides[liveSlideIndex] ?? null;
  const nextLiveSlide = liveSlideIndex >= 0 ? outputSlides[liveSlideIndex + 1] ?? null : null;

  const liveElements = useMemo(() => {
    if (!liveSlide) return [];
    return slideElementsBySlideId.get(liveSlide.id) ?? [];
  }, [liveSlide, slideElementsBySlideId]);

  const nextLiveElements = useMemo(() => {
    if (!nextLiveSlide) return [];
    return slideElementsBySlideId.get(nextLiveSlide.id) ?? [];
  }, [nextLiveSlide, slideElementsBySlideId]);

  const liveTalkScriptBlocks = useMemo(() => (
    liveSlide ? talkScriptBlocksBySlideId.get(liveSlide.id) ?? [] : []
  ), [liveSlide, talkScriptBlocksBySlideId]);

  const liveTalkScriptBlockIndex = useMemo(() => {
    if (!liveSlide || liveTalkScriptBlocks.length === 0) return NO_SLIDE_SELECTED;
    return resolveSlideIndex(liveSlide.id, talkScriptSelection.indices, liveTalkScriptBlocks.length);
  }, [liveSlide, liveTalkScriptBlocks.length, talkScriptSelection.indices]);

  const liveTalkScriptBlock = currentOutputItemRef?.type === 'talk' && liveTalkScriptBlockIndex >= 0
    ? liveTalkScriptBlocks[liveTalkScriptBlockIndex] ?? null
    : null;
  const liveTalkScriptProgress = liveTalkScriptBlock
    ? `${liveTalkScriptBlockIndex + 1} / ${liveTalkScriptBlocks.length}`
    : null;

  const setLiveTalkScriptIndexForSlide = useCallback((slide: Slide | null, mode: 'first' | 'last' = 'first') => {
    if (!slide) return;
    const blocks = talkScriptBlocksBySlideId.get(slide.id) ?? [];
    if (blocks.length === 0) {
      talkScriptSelection.update(slide.id, NO_SLIDE_SELECTED);
      return;
    }
    talkScriptSelection.update(slide.id, mode === 'last' ? blocks.length - 1 : 0);
  }, [talkScriptBlocksBySlideId, talkScriptSelection]);

  const slideElementsById = useMemo(() => {
    const bySlide = new Map<Id, SlideElement[]>();
    for (const slide of slides) {
      bySlide.set(slide.id, slideElementsBySlideId.get(slide.id) ?? []);
    }
    return bySlide;
  }, [slideElementsBySlideId, slides]);

  const updateVisibleSelectedSlideIndex = useCallback((selectionKey: Id, nextIndex: number) => {
    if (isDetachedDeckBrowser) {
      drawerSelection.update(selectionKey, nextIndex);
      return;
    }
    playlistSelection.update(selectionKey, nextIndex);
  }, [isDetachedDeckBrowser, drawerSelection, playlistSelection]);

  const activatePlaylistEntry = useCallback((entryId: Id, nextIndex: number | null) => {
    selectPlaylistEntryInNavigation(entryId);
    if (nextIndex !== null) {
      liveSelection.update(entryId, nextIndex);
    }
    armOutputPlaylistEntry(entryId);
  }, [armOutputPlaylistEntry, selectPlaylistEntryInNavigation, liveSelection.update]);

  // Focus only — Program state is independent of which entry the operator is
  // currently inspecting. Arming happens through explicit actions (activate,
  // take, activatePlaylistEntrySlide, armCurrentPlaylistSelection).
  const selectPlaylistEntry = useCallback((entryId: Id) => {
    selectPlaylistEntryInNavigation(entryId);
  }, [selectPlaylistEntryInNavigation]);

  const selectPlaylistItem = useCallback((itemRef: ItemRef) => {
    selectPlaylistItemInNavigation(itemRef);
  }, [selectPlaylistItemInNavigation]);

  const setCurrentSlideIndex = useCallback((index: number) => {
    const selectionKey = isDetachedDeckBrowser
      ? (currentItemRef ? itemRefKey(currentItemRef) : null)
      : currentPlaylistEntryId;
    if (!selectionKey || slides.length === 0) return;
    updateVisibleSelectedSlideIndex(selectionKey, clamp(index, 0, slides.length - 1));
  }, [currentItemRef, currentPlaylistEntryId, isDetachedDeckBrowser, slides.length, updateVisibleSelectedSlideIndex]);

  const clearCurrentSlideSelection = useCallback(() => {
    const selectionKey = isDetachedDeckBrowser
      ? (currentItemRef ? itemRefKey(currentItemRef) : null)
      : currentPlaylistEntryId;
    if (!selectionKey) return;
    updateVisibleSelectedSlideIndex(selectionKey, NO_SLIDE_SELECTED);
  }, [currentItemRef, currentPlaylistEntryId, isDetachedDeckBrowser, updateVisibleSelectedSlideIndex]);

  const canDriveOutput = Boolean(
    !isDetachedDeckBrowser
    && currentItemRef
    && currentPlaylistItemRef
    && currentPlaylistEntryId
    && itemRefsEqual(currentItemRef, currentPlaylistItemRef),
  );

  const isOutputArmedOnCurrent = Boolean(
    canDriveOutput
    && currentPlaylistEntryId === currentOutputPlaylistEntryId
    && itemRefsEqual(currentItemRef, currentOutputItemRef),
  );

  const activateSlide = useCallback((index: number) => {
    const selectionKey = isDetachedDeckBrowser
      ? (currentItemRef ? itemRefKey(currentItemRef) : null)
      : currentPlaylistEntryId;
    if (!selectionKey || !currentItemRef || slides.length === 0) return;
    const nextIndex = clamp(index, 0, slides.length - 1);
    updateVisibleSelectedSlideIndex(selectionKey, nextIndex);
    if (!canDriveOutput || !currentPlaylistEntryId) return;
    liveSelection.update(currentPlaylistEntryId, nextIndex);
    setLiveTalkScriptIndexForSlide(slides[nextIndex] ?? null, 'first');
    armOutputPlaylistEntry(currentPlaylistEntryId);
    const activatedSlideId = slides[nextIndex]?.id;
    if (activatedSlideId) {
      dispatchAutomationTriggerEvent({ triggerType: 'slide.activate', sourceId: activatedSlideId });
    }
    setStatusText(`Live slide ${nextIndex + 1}`);
  }, [
    armOutputPlaylistEntry,
    canDriveOutput,
    currentPlaylistEntryId,
    currentItemRef,
    isDetachedDeckBrowser,
    setStatusText,
    setLiveTalkScriptIndexForSlide,
    slides.length,
    slides,
    liveSelection.update,
    updateVisibleSelectedSlideIndex,
  ]);

  const takeSlide = useCallback(() => {
    if (!canDriveOutput || !currentPlaylistEntryId || slides.length === 0 || currentSlideIndex < 0) return;
    liveSelection.update(currentPlaylistEntryId, currentSlideIndex);
    setLiveTalkScriptIndexForSlide(slides[currentSlideIndex] ?? null, 'first');
    armOutputPlaylistEntry(currentPlaylistEntryId);
    const takenSlideId = slides[currentSlideIndex]?.id;
    if (takenSlideId) {
      dispatchAutomationTriggerEvent({ triggerType: 'slide.activate', sourceId: takenSlideId });
      dispatchAutomationTriggerEvent({ triggerType: 'slide.take', sourceId: takenSlideId });
    }
    setStatusText(`Taken slide ${currentSlideIndex + 1}`);
  }, [
    armOutputPlaylistEntry,
    canDriveOutput,
    currentPlaylistEntryId,
    currentSlideIndex,
    setStatusText,
    setLiveTalkScriptIndexForSlide,
    slides.length,
    slides,
    liveSelection.update,
  ]);

  const armCurrentPlaylistSelection = useCallback(() => {
    if (!currentPlaylistItemRef || !currentPlaylistEntryId) return;
    const contentSlides = slidesForItemRef(currentPlaylistItemRef);
    const nextIndex = resolveSlideIndex(currentPlaylistEntryId, playlistSelection.indices, contentSlides.length);
    if (contentSlides.length > 0) {
      liveSelection.update(currentPlaylistEntryId, nextIndex);
      setLiveTalkScriptIndexForSlide(contentSlides[nextIndex] ?? null, 'first');
      const activatedSlideId = contentSlides[nextIndex]?.id;
      if (activatedSlideId) {
        dispatchAutomationTriggerEvent({ triggerType: 'slide.activate', sourceId: activatedSlideId });
      }
    }
    armOutputPlaylistEntry(currentPlaylistEntryId);
  }, [armOutputPlaylistEntry, currentPlaylistItemRef, currentPlaylistEntryId, playlistSelection.indices, setLiveTalkScriptIndexForSlide, slidesForItemRef, liveSelection.update]);

  const goNext = useCallback(() => {
    if (slides.length === 0) return;
    if (
      canDriveOutput
      && currentItemRef?.type === 'talk'
      && currentSlideIndex === liveSlideIndex
      && currentSlide
    ) {
      const blocks = talkScriptBlocksBySlideId.get(currentSlide.id) ?? [];
      const currentBlockIndex = resolveSlideIndex(currentSlide.id, talkScriptSelection.indices, blocks.length);
      if (blocks.length > 0 && currentBlockIndex >= 0 && currentBlockIndex < blocks.length - 1) {
        talkScriptSelection.update(currentSlide.id, currentBlockIndex + 1);
        setStatusText(`Script block ${currentBlockIndex + 2}/${blocks.length}`);
        return;
      }
      // End of the last block on the last slide — stop. Without this,
      // activateSlide clamps back to this slide and resets the script
      // index to 0, which looks like the script blocks are cycling.
      if (currentSlideIndex >= slides.length - 1) return;
    }
    activateSlide(currentSlideIndex + 1);
  }, [activateSlide, canDriveOutput, currentItemRef, currentSlide, currentSlideIndex, liveSlideIndex, setStatusText, slides.length, talkScriptBlocksBySlideId, talkScriptSelection]);

  const goPrev = useCallback(() => {
    if (slides.length === 0) return;
    if (
      canDriveOutput
      && currentItemRef?.type === 'talk'
      && currentSlideIndex === liveSlideIndex
      && currentSlide
    ) {
      const blocks = talkScriptBlocksBySlideId.get(currentSlide.id) ?? [];
      const currentBlockIndex = resolveSlideIndex(currentSlide.id, talkScriptSelection.indices, blocks.length);
      if (blocks.length > 0) {
        if (currentBlockIndex > 0) {
          talkScriptSelection.update(currentSlide.id, currentBlockIndex - 1);
          setStatusText(`Script block ${currentBlockIndex}/${blocks.length}`);
          return;
        }
        if (currentSlideIndex === 0) return;
        const previousSlide = slides[currentSlideIndex - 1] ?? null;
        activateSlide(currentSlideIndex - 1);
        setLiveTalkScriptIndexForSlide(previousSlide, 'last');
        return;
      }
    }
    activateSlide(currentSlideIndex - 1);
  }, [activateSlide, canDriveOutput, currentItemRef, currentSlide, currentSlideIndex, liveSlideIndex, setLiveTalkScriptIndexForSlide, setStatusText, slides, talkScriptBlocksBySlideId, talkScriptSelection]);

  const createSlideAction = useCallback(async () => {
    if (!currentItemRef) return;
    await runOperation('Creating slide...', async () => {
      const previousSlideIds = new Set(slides.map((slide) => slide.id));
      const nextSnapshot = await mutatePatch(() => window.castApi.createSlide({
        presentationId: currentItemRef.type === 'presentation' ? currentItemRef.id : null,
        lyricId: currentItemRef.type === 'lyric' ? currentItemRef.id : null,
        talkId: currentItemRef.type === 'talk' ? currentItemRef.id : null,
      }));
      const createdSlideIndex = findCreatedSlideIndex(nextSnapshot, currentItemRef, previousSlideIds);
      const selectionKey = isDetachedDeckBrowser ? itemRefKey(currentItemRef) : currentPlaylistEntryId;
      if (selectionKey && createdSlideIndex !== null) updateVisibleSelectedSlideIndex(selectionKey, createdSlideIndex);
      setStatusText('Created slide');
    });
  }, [currentItemRef, currentPlaylistEntryId, isDetachedDeckBrowser, mutatePatch, runOperation, setStatusText, slides, updateVisibleSelectedSlideIndex]);

  const deleteSlideAction = useCallback(async (slideId: Id) => {
    const selectionKey = isDetachedDeckBrowser
      ? (currentItemRef ? itemRefKey(currentItemRef) : null)
      : currentPlaylistEntryId;
    if (!selectionKey) return;
    const deletedIndex = slides.findIndex((slide) => slide.id === slideId);
    await mutatePatch(() => window.castApi.deleteSlide(slideId));
    if (deletedIndex >= 0 && slides.length > 1) {
      const nextIndex = clamp(deletedIndex >= slides.length - 1 ? deletedIndex - 1 : deletedIndex, 0, slides.length - 2);
      updateVisibleSelectedSlideIndex(selectionKey, nextIndex);
    }
    setStatusText('Deleted slide');
  }, [currentItemRef, currentPlaylistEntryId, isDetachedDeckBrowser, mutatePatch, setStatusText, slides, updateVisibleSelectedSlideIndex]);

  const duplicateSlideAction = useCallback(async (slideId: Id) => {
    const selectionKey = isDetachedDeckBrowser
      ? (currentItemRef ? itemRefKey(currentItemRef) : null)
      : currentPlaylistEntryId;
    const sourceIndex = slides.findIndex((slide) => slide.id === slideId);
    if (sourceIndex < 0) return;
    await mutatePatch(() => window.castApi.duplicateSlide(slideId));
    if (selectionKey) updateVisibleSelectedSlideIndex(selectionKey, sourceIndex + 1);
    setStatusText('Duplicated slide');
  }, [currentItemRef, currentPlaylistEntryId, isDetachedDeckBrowser, mutatePatch, setStatusText, slides, updateVisibleSelectedSlideIndex]);

  const moveSlideAction = useCallback(async (slideId: Id, direction: 'up' | 'down') => {
    const sourceIndex = slides.findIndex((slide) => slide.id === slideId);
    if (sourceIndex < 0) return;
    const newOrder = direction === 'up' ? sourceIndex - 1 : sourceIndex + 1;
    if (newOrder < 0 || newOrder >= slides.length) return;
    const selectionKey = isDetachedDeckBrowser
      ? (currentItemRef ? itemRefKey(currentItemRef) : null)
      : currentPlaylistEntryId;
    await mutatePatch(() => window.castApi.setSlideOrder({ slideId, newOrder }));
    if (selectionKey) updateVisibleSelectedSlideIndex(selectionKey, newOrder);
    setStatusText(direction === 'up' ? 'Moved slide up' : 'Moved slide down');
  }, [currentItemRef, currentPlaylistEntryId, isDetachedDeckBrowser, mutatePatch, setStatusText, slides, updateVisibleSelectedSlideIndex]);

  const reorderSlideAction = useCallback(async (slideId: Id, newOrder: number) => {
    const sourceIndex = slides.findIndex((slide) => slide.id === slideId);
    if (sourceIndex < 0) return;
    if (sourceIndex === newOrder) return;
    if (newOrder < 0 || newOrder >= slides.length) return;
    const selectionKey = isDetachedDeckBrowser
      ? (currentItemRef ? itemRefKey(currentItemRef) : null)
      : currentPlaylistEntryId;
    await mutatePatch(() => window.castApi.setSlideOrder({ slideId, newOrder }));
    if (selectionKey) updateVisibleSelectedSlideIndex(selectionKey, newOrder);
    setStatusText('Reordered slide');
  }, [currentItemRef, currentPlaylistEntryId, isDetachedDeckBrowser, mutatePatch, setStatusText, slides, updateVisibleSelectedSlideIndex]);

  const updateCurrentSlideNotes = useCallback(async (notes: string) => {
    if (!currentSlide) return;
    await mutatePatch(() => window.castApi.updateSlideNotes({ slideId: currentSlide.id, notes }));
    setStatusText('Saved slide notes');
  }, [currentSlide, mutatePatch, setStatusText]);

  const updateCurrentSlideBackground = useCallback(async (background: SlideBackground | null) => {
    if (!currentSlide) return;
    await mutatePatch(() => window.castApi.updateSlideBackground({ slideId: currentSlide.id, background }));
    setStatusText('Updated slide background');
  }, [currentSlide, mutatePatch, setStatusText]);

  const focusPlaylistEntrySlide = useCallback((entryId: Id, itemRef: ItemRef, index: number) => {
    const contentSlides = slidesForItemRef(itemRef);
    if (contentSlides.length === 0) return;
    const nextIndex = clamp(index, 0, contentSlides.length - 1);
    playlistSelection.update(entryId, nextIndex);
    selectPlaylistEntryInNavigation(entryId);
  }, [selectPlaylistEntryInNavigation, slidesForItemRef, playlistSelection.update]);

  const activatePlaylistEntrySlide = useCallback((entryId: Id, itemRef: ItemRef, index: number) => {
    const contentSlides = slidesForItemRef(itemRef);
    if (contentSlides.length === 0) return;
    const nextIndex = clamp(index, 0, contentSlides.length - 1);
    playlistSelection.update(entryId, nextIndex);
    setLiveTalkScriptIndexForSlide(contentSlides[nextIndex] ?? null, 'first');
    activatePlaylistEntry(entryId, nextIndex);
    const activatedSlideId = contentSlides[nextIndex]?.id;
    if (activatedSlideId) {
      dispatchAutomationTriggerEvent({ triggerType: 'slide.activate', sourceId: activatedSlideId });
    }
    setStatusText(`Live slide ${nextIndex + 1}`);
  }, [activatePlaylistEntry, setLiveTalkScriptIndexForSlide, setStatusText, slidesForItemRef, playlistSelection.update]);

  const value = useMemo<SlideContextValue>(() => ({
    slides,
    currentSlideIndex,
    liveSlideIndex,
    currentSlide,
    liveSlide,
    liveElements,
    nextLiveSlide,
    nextLiveElements,
    liveTalkScriptBlock,
    liveTalkScriptProgress,
    slideElementsById,
    isOutputArmedOnCurrent,
    setCurrentSlideIndex,
    clearCurrentSlideSelection,
    activateSlide,
    armCurrentPlaylistSelection,
    takeSlide,
    goNext,
    goPrev,
    selectPlaylistEntry,
    selectPlaylistItem,
    focusPlaylistEntrySlide,
    activatePlaylistEntrySlide,
    createSlide: createSlideAction,
    duplicateSlide: duplicateSlideAction,
    deleteSlide: deleteSlideAction,
    moveSlide: moveSlideAction,
    reorderSlide: reorderSlideAction,
    updateCurrentSlideNotes,
    updateCurrentSlideBackground,
  }), [
    activatePlaylistEntrySlide,
    activateSlide,
    armCurrentPlaylistSelection,
    createSlideAction,
    deleteSlideAction,
    duplicateSlideAction,
    moveSlideAction,
    reorderSlideAction,
    currentSlide,
    currentSlideIndex,
    clearCurrentSlideSelection,
    focusPlaylistEntrySlide,
    goNext,
    goPrev,
    isOutputArmedOnCurrent,
    liveElements,
    liveSlide,
    liveTalkScriptBlock,
    liveTalkScriptProgress,
    liveSlideIndex,
    nextLiveElements,
    nextLiveSlide,
    selectPlaylistEntry,
    selectPlaylistItem,
    setCurrentSlideIndex,
    slideElementsById,
    slides,
    takeSlide,
    updateCurrentSlideNotes,
    updateCurrentSlideBackground,
  ]);

  return <SlideContext.Provider value={value}>{children}</SlideContext.Provider>;
}

export function useSlides(): SlideContextValue {
  const ctx = useContext(SlideContext);
  if (!ctx) throw new Error('useSlides must be used within SlideProvider');
  return ctx;
}

export function findCreatedSlideIndex(snapshot: AppSnapshot, itemRef: ItemRef, previousSlideIds: Set<Id>): number | null {
  const contentSlides = sortSlides(snapshot.slides.filter((slide) => {
    const ref = getSlideItemRef(slide);
    return ref !== null && ref.type === itemRef.type && ref.id === itemRef.id;
  }));
  const createdIndex = contentSlides.findIndex((slide) => !previousSlideIds.has(slide.id));
  return createdIndex === -1 ? null : createdIndex;
}

function resolveSlideIndex(itemId: Id | null, indicesByItemId: Record<Id, number>, slideCount: number): number {
  if (!itemId || slideCount <= 0) return NO_SLIDE_SELECTED;
  const rawIndex = indicesByItemId[itemId];
  if (rawIndex == null || rawIndex === NO_SLIDE_SELECTED) return NO_SLIDE_SELECTED;
  return clamp(rawIndex, 0, slideCount - 1);
}

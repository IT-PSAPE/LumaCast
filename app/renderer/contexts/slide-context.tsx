import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { getSlideDeckItemId, isTalkDeckItem } from '@core/deck-items';
import type { AppSnapshot, Id, Slide, SlideElement, TalkScriptBlock } from '@core/types';
import { clamp, sortSlides } from '../utils/slides';
import { useIndexedSelection } from '../hooks/use-indexed-selection';
import { useCast } from './app-context';
import { useNavigation } from './navigation-context';
import { useProjectContent } from './use-project-content';

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
  selectPlaylistDeckItem: (itemId: Id) => void;
  focusPlaylistEntrySlide: (entryId: Id, itemId: Id, index: number) => void;
  activatePlaylistEntrySlide: (entryId: Id, itemId: Id, index: number) => void;
  createSlide: () => Promise<void>;
  duplicateSlide: (slideId: Id) => Promise<void>;
  deleteSlide: (slideId: Id) => Promise<void>;
  moveSlide: (slideId: Id, direction: 'up' | 'down') => Promise<void>;
  reorderSlide: (slideId: Id, newOrder: number) => Promise<void>;
  updateCurrentSlideNotes: (notes: string) => Promise<void>;
}

const SlideContext = createContext<SlideContextValue | null>(null);
const NO_SLIDE_SELECTED = -1;

export function SlideProvider({ children }: { children: ReactNode }) {
  const { mutatePatch, runOperation, setStatusText } = useCast();
  const {
    currentDeckItemId,
    currentPlaylistEntryId,
    currentPlaylistDeckItemId,
    currentOutputPlaylistEntryId,
    currentOutputDeckItemId,
    currentDeckItem,
    isDetachedDeckBrowser,
    armOutputPlaylistEntry,
    selectPlaylistEntry: selectPlaylistEntryInNavigation,
    selectPlaylistDeckItem: selectPlaylistDeckItemInNavigation,
  } = useNavigation();
  const { deckItemsById, slidesByDeckItemId, slideElementsBySlideId, talkScriptBlocksBySlideId } = useProjectContent();

  const playlistSelection = useIndexedSelection();
  const drawerSelection = useIndexedSelection();
  const liveSelection = useIndexedSelection();
  const talkScriptSelection = useIndexedSelection();

  const slides = useMemo(() => {
    if (!currentDeckItemId) return [];
    return slidesByDeckItemId.get(currentDeckItemId) ?? [];
  }, [currentDeckItemId, slidesByDeckItemId]);

  const outputSlides = useMemo(() => {
    if (!currentOutputDeckItemId) return [];
    return slidesByDeckItemId.get(currentOutputDeckItemId) ?? [];
  }, [currentOutputDeckItemId, slidesByDeckItemId]);

  const currentSlideIndex = useMemo(() => {
    const indicesByDeckItemId = isDetachedDeckBrowser
      ? drawerSelection.indices
      : playlistSelection.indices;
    return resolveSlideIndex(isDetachedDeckBrowser ? currentDeckItemId : currentPlaylistEntryId, indicesByDeckItemId, slides.length);
  }, [
    currentDeckItemId,
    currentPlaylistEntryId,
    drawerSelection.indices,
    isDetachedDeckBrowser,
    playlistSelection.indices,
    slides.length,
  ]);

  const liveSlideIndex = useMemo(
    () => resolveSlideIndex(currentOutputPlaylistEntryId ?? currentOutputDeckItemId, liveSelection.indices, outputSlides.length),
    [currentOutputDeckItemId, currentOutputPlaylistEntryId, liveSelection.indices, outputSlides.length],
  );

  const currentSlide = slides[currentSlideIndex] ?? null;
  const liveSlide = outputSlides[liveSlideIndex] ?? null;
  const nextLiveSlide = liveSlideIndex >= 0 ? outputSlides[liveSlideIndex + 1] ?? null : null;
  const liveOutputDeckItem = currentOutputDeckItemId ? deckItemsById.get(currentOutputDeckItemId) ?? null : null;

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

  const liveTalkScriptBlock = isTalkDeckItem(liveOutputDeckItem) && liveTalkScriptBlockIndex >= 0
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

  const updateVisibleSelectedSlideIndex = useCallback((itemId: Id, nextIndex: number) => {
    if (isDetachedDeckBrowser) {
      drawerSelection.update(itemId, nextIndex);
      return;
    }
    playlistSelection.update(itemId, nextIndex);
  }, [isDetachedDeckBrowser, drawerSelection, playlistSelection]);

  const activatePlaylistEntry = useCallback((entryId: Id, _itemId: Id, nextIndex: number | null) => {
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

  const selectPlaylistDeckItem = useCallback((itemId: Id) => {
    selectPlaylistDeckItemInNavigation(itemId);
  }, [selectPlaylistDeckItemInNavigation]);

  const setCurrentSlideIndex = useCallback((index: number) => {
    const selectionKey = isDetachedDeckBrowser ? currentDeckItemId : currentPlaylistEntryId;
    if (!selectionKey || slides.length === 0) return;
    updateVisibleSelectedSlideIndex(selectionKey, clamp(index, 0, slides.length - 1));
  }, [currentDeckItemId, currentPlaylistEntryId, isDetachedDeckBrowser, slides.length, updateVisibleSelectedSlideIndex]);

  const clearCurrentSlideSelection = useCallback(() => {
    const selectionKey = isDetachedDeckBrowser ? currentDeckItemId : currentPlaylistEntryId;
    if (!selectionKey) return;
    updateVisibleSelectedSlideIndex(selectionKey, NO_SLIDE_SELECTED);
  }, [currentDeckItemId, currentPlaylistEntryId, isDetachedDeckBrowser, updateVisibleSelectedSlideIndex]);

  const canDriveOutput = Boolean(
    !isDetachedDeckBrowser
    && currentDeckItemId
    && currentPlaylistDeckItemId
    && currentPlaylistEntryId
    && currentDeckItemId === currentPlaylistDeckItemId,
  );

  const isOutputArmedOnCurrent = Boolean(
    canDriveOutput
    && currentPlaylistEntryId === currentOutputPlaylistEntryId
    && currentDeckItemId === currentOutputDeckItemId,
  );

  const activateSlide = useCallback((index: number) => {
    const selectionKey = isDetachedDeckBrowser ? currentDeckItemId : currentPlaylistEntryId;
    if (!selectionKey || !currentDeckItemId || slides.length === 0) return;
    const nextIndex = clamp(index, 0, slides.length - 1);
    updateVisibleSelectedSlideIndex(selectionKey, nextIndex);
    if (!canDriveOutput || !currentPlaylistEntryId) return;
    liveSelection.update(currentPlaylistEntryId, nextIndex);
    setLiveTalkScriptIndexForSlide(slides[nextIndex] ?? null, 'first');
    armOutputPlaylistEntry(currentPlaylistEntryId);
    setStatusText(`Live slide ${nextIndex + 1}`);
  }, [
    armOutputPlaylistEntry,
    canDriveOutput,
    currentPlaylistEntryId,
    currentDeckItemId,
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
    if (!currentPlaylistDeckItemId || !currentPlaylistEntryId) return;
    const contentSlides = slidesByDeckItemId.get(currentPlaylistDeckItemId) ?? [];
    const nextIndex = resolveSlideIndex(currentPlaylistEntryId, playlistSelection.indices, contentSlides.length);
    if (contentSlides.length > 0) {
      liveSelection.update(currentPlaylistEntryId, nextIndex);
      setLiveTalkScriptIndexForSlide(contentSlides[nextIndex] ?? null, 'first');
    }
    armOutputPlaylistEntry(currentPlaylistEntryId);
  }, [armOutputPlaylistEntry, currentPlaylistDeckItemId, currentPlaylistEntryId, playlistSelection.indices, setLiveTalkScriptIndexForSlide, slidesByDeckItemId, liveSelection.update]);

  const goNext = useCallback(() => {
    if (slides.length === 0) return;
    if (
      canDriveOutput
      && isTalkDeckItem(currentDeckItem)
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
  }, [activateSlide, canDriveOutput, currentDeckItem, currentSlide, currentSlideIndex, liveSlideIndex, setStatusText, slides.length, talkScriptBlocksBySlideId, talkScriptSelection]);

  const goPrev = useCallback(() => {
    if (slides.length === 0) return;
    if (
      canDriveOutput
      && isTalkDeckItem(currentDeckItem)
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
  }, [activateSlide, canDriveOutput, currentDeckItem, currentSlide, currentSlideIndex, liveSlideIndex, setLiveTalkScriptIndexForSlide, setStatusText, slides, talkScriptBlocksBySlideId, talkScriptSelection]);

  const createSlideAction = useCallback(async () => {
    if (!currentDeckItemId || !currentDeckItem) return;
    await runOperation('Creating slide...', async () => {
      const previousSlideIds = new Set(slides.map((slide) => slide.id));
      const nextSnapshot = await mutatePatch(() => window.castApi.createSlide({
        presentationId: currentDeckItem.type === 'presentation' ? currentDeckItemId : null,
        lyricId: currentDeckItem.type === 'lyric' ? currentDeckItemId : null,
        talkId: currentDeckItem.type === 'talk' ? currentDeckItemId : null,
      }));
      const createdSlideIndex = findCreatedSlideIndex(nextSnapshot, currentDeckItemId, previousSlideIds);
      const selectionKey = isDetachedDeckBrowser ? currentDeckItemId : currentPlaylistEntryId;
      if (selectionKey && createdSlideIndex !== null) updateVisibleSelectedSlideIndex(selectionKey, createdSlideIndex);
      setStatusText('Created slide');
    });
  }, [currentDeckItem, currentDeckItemId, currentPlaylistEntryId, isDetachedDeckBrowser, mutatePatch, runOperation, setStatusText, slides, updateVisibleSelectedSlideIndex]);

  const deleteSlideAction = useCallback(async (slideId: Id) => {
    const selectionKey = isDetachedDeckBrowser ? currentDeckItemId : currentPlaylistEntryId;
    if (!selectionKey) return;
    const deletedIndex = slides.findIndex((slide) => slide.id === slideId);
    await mutatePatch(() => window.castApi.deleteSlide(slideId));
    if (deletedIndex >= 0 && slides.length > 1) {
      const nextIndex = clamp(deletedIndex >= slides.length - 1 ? deletedIndex - 1 : deletedIndex, 0, slides.length - 2);
      updateVisibleSelectedSlideIndex(selectionKey, nextIndex);
    }
    setStatusText('Deleted slide');
  }, [currentDeckItemId, currentPlaylistEntryId, isDetachedDeckBrowser, mutatePatch, setStatusText, slides, updateVisibleSelectedSlideIndex]);

  const duplicateSlideAction = useCallback(async (slideId: Id) => {
    const selectionKey = isDetachedDeckBrowser ? currentDeckItemId : currentPlaylistEntryId;
    const sourceIndex = slides.findIndex((slide) => slide.id === slideId);
    if (sourceIndex < 0) return;
    await mutatePatch(() => window.castApi.duplicateSlide(slideId));
    if (selectionKey) updateVisibleSelectedSlideIndex(selectionKey, sourceIndex + 1);
    setStatusText('Duplicated slide');
  }, [currentDeckItemId, currentPlaylistEntryId, isDetachedDeckBrowser, mutatePatch, setStatusText, slides, updateVisibleSelectedSlideIndex]);

  const moveSlideAction = useCallback(async (slideId: Id, direction: 'up' | 'down') => {
    const sourceIndex = slides.findIndex((slide) => slide.id === slideId);
    if (sourceIndex < 0) return;
    const newOrder = direction === 'up' ? sourceIndex - 1 : sourceIndex + 1;
    if (newOrder < 0 || newOrder >= slides.length) return;
    const selectionKey = isDetachedDeckBrowser ? currentDeckItemId : currentPlaylistEntryId;
    await mutatePatch(() => window.castApi.setSlideOrder({ slideId, newOrder }));
    if (selectionKey) updateVisibleSelectedSlideIndex(selectionKey, newOrder);
    setStatusText(direction === 'up' ? 'Moved slide up' : 'Moved slide down');
  }, [currentDeckItemId, currentPlaylistEntryId, isDetachedDeckBrowser, mutatePatch, setStatusText, slides, updateVisibleSelectedSlideIndex]);

  const reorderSlideAction = useCallback(async (slideId: Id, newOrder: number) => {
    const sourceIndex = slides.findIndex((slide) => slide.id === slideId);
    if (sourceIndex < 0) return;
    if (sourceIndex === newOrder) return;
    if (newOrder < 0 || newOrder >= slides.length) return;
    const selectionKey = isDetachedDeckBrowser ? currentDeckItemId : currentPlaylistEntryId;
    await mutatePatch(() => window.castApi.setSlideOrder({ slideId, newOrder }));
    if (selectionKey) updateVisibleSelectedSlideIndex(selectionKey, newOrder);
    setStatusText('Reordered slide');
  }, [currentDeckItemId, currentPlaylistEntryId, isDetachedDeckBrowser, mutatePatch, setStatusText, slides, updateVisibleSelectedSlideIndex]);

  const updateCurrentSlideNotes = useCallback(async (notes: string) => {
    if (!currentSlide) return;
    await mutatePatch(() => window.castApi.updateSlideNotes({ slideId: currentSlide.id, notes }));
    setStatusText('Saved slide notes');
  }, [currentSlide, mutatePatch, setStatusText]);

  const focusPlaylistEntrySlide = useCallback((entryId: Id, itemId: Id, index: number) => {
    const contentSlides = slidesByDeckItemId.get(itemId) ?? [];
    if (contentSlides.length === 0) return;
    const nextIndex = clamp(index, 0, contentSlides.length - 1);
    playlistSelection.update(entryId, nextIndex);
    selectPlaylistEntryInNavigation(entryId);
  }, [selectPlaylistEntryInNavigation, slidesByDeckItemId, playlistSelection.update]);

  const activatePlaylistEntrySlide = useCallback((entryId: Id, itemId: Id, index: number) => {
    const contentSlides = slidesByDeckItemId.get(itemId) ?? [];
    if (contentSlides.length === 0) return;
    const nextIndex = clamp(index, 0, contentSlides.length - 1);
    playlistSelection.update(entryId, nextIndex);
    setLiveTalkScriptIndexForSlide(contentSlides[nextIndex] ?? null, 'first');
    activatePlaylistEntry(entryId, itemId, nextIndex);
    setStatusText(`Live slide ${nextIndex + 1}`);
  }, [activatePlaylistEntry, setLiveTalkScriptIndexForSlide, setStatusText, slidesByDeckItemId, playlistSelection.update]);

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
    selectPlaylistDeckItem,
    focusPlaylistEntrySlide,
    activatePlaylistEntrySlide,
    createSlide: createSlideAction,
    duplicateSlide: duplicateSlideAction,
    deleteSlide: deleteSlideAction,
    moveSlide: moveSlideAction,
    reorderSlide: reorderSlideAction,
    updateCurrentSlideNotes,
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
    selectPlaylistDeckItem,
    setCurrentSlideIndex,
    slideElementsById,
    slides,
    takeSlide,
    updateCurrentSlideNotes,
  ]);

  return <SlideContext.Provider value={value}>{children}</SlideContext.Provider>;
}

export function useSlides(): SlideContextValue {
  const ctx = useContext(SlideContext);
  if (!ctx) throw new Error('useSlides must be used within SlideProvider');
  return ctx;
}

export function findCreatedSlideIndex(snapshot: AppSnapshot, itemId: Id, previousSlideIds: Set<Id>): number | null {
  const contentSlides = sortSlides(snapshot.slides.filter((slide) => getSlideDeckItemId(slide) === itemId));
  const createdIndex = contentSlides.findIndex((slide) => !previousSlideIds.has(slide.id));
  return createdIndex === -1 ? null : createdIndex;
}

function resolveSlideIndex(itemId: Id | null, indicesByItemId: Record<Id, number>, slideCount: number): number {
  if (!itemId || slideCount <= 0) return NO_SLIDE_SELECTED;
  const rawIndex = indicesByItemId[itemId];
  if (rawIndex == null || rawIndex === NO_SLIDE_SELECTED) return NO_SLIDE_SELECTED;
  return clamp(rawIndex, 0, slideCount - 1);
}

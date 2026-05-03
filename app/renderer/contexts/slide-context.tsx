import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { getSlideDeckItemId } from '@core/deck-items';
import type { AppSnapshot, Id, Slide, SlideElement } from '@core/types';
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
  const { slidesByDeckItemId, slideElementsBySlideId } = useProjectContent();

  const playlistSelection = useIndexedSelection();
  const drawerSelection = useIndexedSelection();
  const liveSelection = useIndexedSelection();

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

  const liveElements = useMemo(() => {
    if (!liveSlide) return [];
    return slideElementsBySlideId.get(liveSlide.id) ?? [];
  }, [liveSlide, slideElementsBySlideId]);

  const nextLiveElements = useMemo(() => {
    if (!nextLiveSlide) return [];
    return slideElementsBySlideId.get(nextLiveSlide.id) ?? [];
  }, [nextLiveSlide, slideElementsBySlideId]);

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

  // Clicking an entry inside a segment should arm it on the program output
  // (program + monitor surfaces). Free-floating selections that don't belong
  // to a segment go through other code paths and are not armed here.
  const selectPlaylistEntry = useCallback((entryId: Id) => {
    selectPlaylistEntryInNavigation(entryId);
    armOutputPlaylistEntry(entryId);
  }, [armOutputPlaylistEntry, selectPlaylistEntryInNavigation]);

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
    armOutputPlaylistEntry(currentPlaylistEntryId);
    setStatusText(`Live slide ${nextIndex + 1}`);
  }, [
    armOutputPlaylistEntry,
    canDriveOutput,
    currentPlaylistEntryId,
    currentDeckItemId,
    isDetachedDeckBrowser,
    setStatusText,
    slides.length,
    liveSelection.update,
    updateVisibleSelectedSlideIndex,
  ]);

  const takeSlide = useCallback(() => {
    if (!canDriveOutput || !currentPlaylistEntryId || slides.length === 0 || currentSlideIndex < 0) return;
    liveSelection.update(currentPlaylistEntryId, currentSlideIndex);
    armOutputPlaylistEntry(currentPlaylistEntryId);
    setStatusText(`Taken slide ${currentSlideIndex + 1}`);
  }, [
    armOutputPlaylistEntry,
    canDriveOutput,
    currentPlaylistEntryId,
    currentSlideIndex,
    setStatusText,
    slides.length,
    liveSelection.update,
  ]);

  const armCurrentPlaylistSelection = useCallback(() => {
    if (!currentPlaylistDeckItemId || !currentPlaylistEntryId) return;
    const contentSlides = slidesByDeckItemId.get(currentPlaylistDeckItemId) ?? [];
    const nextIndex = resolveSlideIndex(currentPlaylistEntryId, playlistSelection.indices, contentSlides.length);
    if (contentSlides.length > 0) {
      liveSelection.update(currentPlaylistEntryId, nextIndex);
    }
    armOutputPlaylistEntry(currentPlaylistEntryId);
  }, [armOutputPlaylistEntry, currentPlaylistDeckItemId, currentPlaylistEntryId, playlistSelection.indices, slidesByDeckItemId, liveSelection.update]);

  const goNext = useCallback(() => {
    if (slides.length === 0) return;
    activateSlide(currentSlideIndex + 1);
  }, [activateSlide, currentSlideIndex, slides.length]);

  const goPrev = useCallback(() => {
    if (slides.length === 0) return;
    activateSlide(currentSlideIndex - 1);
  }, [activateSlide, currentSlideIndex, slides.length]);

  const createSlideAction = useCallback(async () => {
    if (!currentDeckItemId || !currentDeckItem) return;
    await runOperation('Creating slide...', async () => {
      const previousSlideIds = new Set(slides.map((slide) => slide.id));
      const nextSnapshot = await mutatePatch(() => window.castApi.createSlide({
        presentationId: currentDeckItem.type === 'presentation' ? currentDeckItemId : null,
        lyricId: currentDeckItem.type === 'lyric' ? currentDeckItemId : null,
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
    activatePlaylistEntry(entryId, itemId, nextIndex);
    setStatusText(`Live slide ${nextIndex + 1}`);
  }, [activatePlaylistEntry, setStatusText, slidesByDeckItemId, playlistSelection.update]);

  const value = useMemo<SlideContextValue>(() => ({
    slides,
    currentSlideIndex,
    liveSlideIndex,
    currentSlide,
    liveSlide,
    liveElements,
    nextLiveSlide,
    nextLiveElements,
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

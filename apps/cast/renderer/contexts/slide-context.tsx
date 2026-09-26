import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { getPlaylistEntryItemRef, getSlideItemRef } from '@lumacast/composition';
import type { Id } from '@lumacast/kernel';
import type { ItemRef, LyricBlankSlideMode, Slide, SlideBackground, SlideElement } from '@lumacast/composition';
import type { AppSnapshot, NdiTakeReason } from '@lumacast/protocol';
import { clamp, sortSlides } from '../utils/slides';
import { itemRefsEqual } from '../utils/navigation-context-utils';
import { buildNdiTakeScopeKey, noteNdiTakeCorrelation } from '../utils/ndi-take-correlation';
import { useIndexedSelection } from '../hooks/use-indexed-selection';
import { useCast } from './app-context';
import { useNavigation } from './navigation-context';
import { itemRefKey, useProjectContent } from './use-project-content';
import { dispatchAutomationTriggerEvent } from '../features/automation/automation-events';

// #219 item-model refactor decision D9: selection stays keyed on playlist
// entry ids (preserved across the migration) for the playlist/live cases;
// the detached-browser case, which previously keyed on the bare merged
// deck-item id, now keys on `itemRefKey(currentItemRef)` — there is no
// merged id space to rely on any more.

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
  selectPlaylistItem: (itemRef: ItemRef) => void;
  activateScheduledSlide: (itemRef: ItemRef, slideId: Id) => void;
  createSlide: () => Promise<void>;
  setLyricBlankSlides: (mode: LyricBlankSlideMode) => Promise<void>;
  duplicateSlide: (slideId: Id) => Promise<void>;
  deleteSlide: (slideId: Id) => Promise<void>;
  moveSlide: (slideId: Id, direction: 'up' | 'down') => Promise<void>;
  reorderSlide: (slideId: Id, newOrder: number) => Promise<void>;
  updateCurrentSlideNotes: (notes: string) => Promise<void>;
  updateCurrentSlideBackground: (background: SlideBackground | null) => Promise<void>;
}

const SlideContext = createContext<SlideContextValue | null>(null);
const NO_SLIDE_SELECTED = -1;

function classifyTakeReason(params: {
  targetEntryId: Id | null;
  targetItemRef: ItemRef | null;
  targetIndex: number;
  currentOutputEntryId: Id | null;
  currentOutputItemRef: ItemRef | null;
  currentLiveIndex: number;
}): NdiTakeReason {
  const {
    targetEntryId,
    targetItemRef,
    targetIndex,
    currentOutputEntryId,
    currentOutputItemRef,
    currentLiveIndex,
  } = params;
  const sameOutputEntry = targetEntryId !== null && currentOutputEntryId === targetEntryId;
  const sameOutputItem = itemRefsEqual(targetItemRef, currentOutputItemRef);
  if (!sameOutputEntry || !sameOutputItem) return 'crossItem';
  if (currentLiveIndex >= 0 && Math.abs(targetIndex - currentLiveIndex) === 1) return 'sequential';
  return 'jump';
}

function noteOutputTakeIntent(params: {
  kind: 'activate' | 'take';
  slideId: Id | undefined;
  outputScopeKey: string | null;
  reason: NdiTakeReason;
}): void {
  const { kind, slideId, outputScopeKey, reason } = params;
  if (!slideId) return;
  noteNdiTakeCorrelation({ kind, slideId, outputScopeKey, reason });
}

export function SlideProvider({ children }: { children: ReactNode }) {
  const { mutatePatch, runOperation, setStatusText } = useCast();
  const {
    currentItemRef,
    currentPlaylistEntryId,
    currentPlaylistItemRef,
    currentPlaylistRows,
    currentOutputPlaylistEntryId,
    currentOutputItemRef,
    isDetachedDeckBrowser,
    armOutputPlaylistEntry,
    armOutputItem,
    selectPlaylistEntry: selectPlaylistEntryInNavigation,
    selectPlaylistItem: selectPlaylistItemInNavigation,
  } = useNavigation();
  const { slidesForItemRef, liveSlideElementsBySlideId } = useProjectContent();

  const playlistSelection = useIndexedSelection();
  const drawerSelection = useIndexedSelection();
  const liveSelection = useIndexedSelection();

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

  // Live inherited themes: output reads the resolved elements (current theme
  // styling with local overrides and authored content preserved), not the raw
  // persisted rows.
  const liveElements = useMemo(() => {
    if (!liveSlide) return [];
    return liveSlideElementsBySlideId.get(liveSlide.id) ?? [];
  }, [liveSlide, liveSlideElementsBySlideId]);

  const nextLiveElements = useMemo(() => {
    if (!nextLiveSlide) return [];
    return liveSlideElementsBySlideId.get(nextLiveSlide.id) ?? [];
  }, [nextLiveSlide, liveSlideElementsBySlideId]);

  const slideElementsById = useMemo(() => {
    const bySlide = new Map<Id, SlideElement[]>();
    for (const slide of slides) {
      bySlide.set(slide.id, liveSlideElementsBySlideId.get(slide.id) ?? []);
    }
    return bySlide;
  }, [liveSlideElementsBySlideId, slides]);

  const updateVisibleSelectedSlideIndex = useCallback((selectionKey: Id, nextIndex: number) => {
    if (isDetachedDeckBrowser) {
      drawerSelection.update(selectionKey, nextIndex);
      return;
    }
    playlistSelection.update(selectionKey, nextIndex);
  }, [isDetachedDeckBrowser, drawerSelection, playlistSelection]);

  // Focus only — Program state is independent of which entry the operator is
  // currently inspecting. Arming happens through explicit actions (activate,
  // take and armCurrentPlaylistSelection).
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

    let armedEntryId: Id | null = null;
    if (canDriveOutput && currentPlaylistEntryId) {
      armedEntryId = currentPlaylistEntryId;
      liveSelection.update(currentPlaylistEntryId, nextIndex);
      armOutputPlaylistEntry(currentPlaylistEntryId);
    } else if (isDetachedDeckBrowser) {
      // Direct (rowless) item opened from the Deck bin: arm the output item
      // directly, mirroring activateScheduledSlide's rowless fallback below —
      // there is no playlist entry to arm instead.
      liveSelection.update(itemRefKey(currentItemRef), nextIndex);
      armOutputItem(currentItemRef);
    } else {
      return;
    }

    const activatedSlideId = slides[nextIndex]?.id;
    if (activatedSlideId) {
      noteOutputTakeIntent({
        kind: 'activate',
        slideId: activatedSlideId,
        outputScopeKey: buildNdiTakeScopeKey(armedEntryId, currentItemRef),
        reason: classifyTakeReason({
          targetEntryId: armedEntryId,
          targetItemRef: currentItemRef,
          targetIndex: nextIndex,
          currentOutputEntryId: currentOutputPlaylistEntryId,
          currentOutputItemRef,
          currentLiveIndex: liveSlideIndex,
        }),
      });
      dispatchAutomationTriggerEvent({ triggerType: 'slide.activate', sourceId: activatedSlideId });
    }
    setStatusText(`Live slide ${nextIndex + 1}`);
  }, [
    armOutputItem,
    armOutputPlaylistEntry,
    canDriveOutput,
    currentPlaylistEntryId,
    currentItemRef,
    currentOutputItemRef,
    currentOutputPlaylistEntryId,
    isDetachedDeckBrowser,
    liveSlideIndex,
    setStatusText,
    slides.length,
    slides,
    liveSelection.update,
    updateVisibleSelectedSlideIndex,
  ]);

  const takeSlide = useCallback(() => {
    if (!currentItemRef || slides.length === 0 || currentSlideIndex < 0) return;

    let armedEntryId: Id | null = null;
    if (canDriveOutput && currentPlaylistEntryId) {
      armedEntryId = currentPlaylistEntryId;
      liveSelection.update(currentPlaylistEntryId, currentSlideIndex);
      armOutputPlaylistEntry(currentPlaylistEntryId);
    } else if (isDetachedDeckBrowser) {
      // Direct (rowless) item opened from the Deck bin: arm the output item
      // directly, mirroring activateScheduledSlide's rowless fallback below —
      // there is no playlist entry to arm instead.
      liveSelection.update(itemRefKey(currentItemRef), currentSlideIndex);
      armOutputItem(currentItemRef);
    } else {
      return;
    }

    const takenSlideId = slides[currentSlideIndex]?.id;
    if (takenSlideId) {
      noteOutputTakeIntent({
        kind: 'take',
        slideId: takenSlideId,
        outputScopeKey: buildNdiTakeScopeKey(armedEntryId, currentItemRef),
        reason: classifyTakeReason({
          targetEntryId: armedEntryId,
          targetItemRef: currentItemRef,
          targetIndex: currentSlideIndex,
          currentOutputEntryId: currentOutputPlaylistEntryId,
          currentOutputItemRef,
          currentLiveIndex: liveSlideIndex,
        }),
      });
      dispatchAutomationTriggerEvent({ triggerType: 'slide.activate', sourceId: takenSlideId });
      dispatchAutomationTriggerEvent({ triggerType: 'slide.take', sourceId: takenSlideId });
    }
    setStatusText(`Taken slide ${currentSlideIndex + 1}`);
  }, [
    armOutputItem,
    armOutputPlaylistEntry,
    canDriveOutput,
    currentPlaylistEntryId,
    currentItemRef,
    currentSlideIndex,
    currentOutputItemRef,
    currentOutputPlaylistEntryId,
    isDetachedDeckBrowser,
    liveSlideIndex,
    setStatusText,
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
      const activatedSlideId = contentSlides[nextIndex]?.id;
      if (activatedSlideId) {
        noteOutputTakeIntent({
          kind: 'activate',
          slideId: activatedSlideId,
          outputScopeKey: buildNdiTakeScopeKey(currentPlaylistEntryId, currentPlaylistItemRef),
          reason: classifyTakeReason({
            targetEntryId: currentPlaylistEntryId,
            targetItemRef: currentPlaylistItemRef,
            targetIndex: nextIndex,
            currentOutputEntryId: currentOutputPlaylistEntryId,
            currentOutputItemRef,
            currentLiveIndex: liveSlideIndex,
          }),
        });
        dispatchAutomationTriggerEvent({ triggerType: 'slide.activate', sourceId: activatedSlideId });
      }
    }
    armOutputPlaylistEntry(currentPlaylistEntryId);
  }, [
    armOutputPlaylistEntry,
    currentOutputItemRef,
    currentOutputPlaylistEntryId,
    currentPlaylistItemRef,
    currentPlaylistEntryId,
    liveSlideIndex,
    playlistSelection.indices,
    slidesForItemRef,
    liveSelection.update,
  ]);

  // Shared by both the keyboard shortcut and the app-menu command so the two
  // never diverge: advance the live output only when it is already armed on
  // the browsed slide, otherwise just move the browse cursor.
  const goNext = useCallback(() => {
    if (slides.length === 0) return;
    if (isOutputArmedOnCurrent) activateSlide(currentSlideIndex + 1);
    else setCurrentSlideIndex(currentSlideIndex + 1);
  }, [activateSlide, currentSlideIndex, isOutputArmedOnCurrent, setCurrentSlideIndex, slides.length]);

  const goPrev = useCallback(() => {
    if (slides.length === 0) return;
    if (isOutputArmedOnCurrent) activateSlide(currentSlideIndex - 1);
    else setCurrentSlideIndex(currentSlideIndex - 1);
  }, [activateSlide, currentSlideIndex, isOutputArmedOnCurrent, setCurrentSlideIndex, slides.length]);

  const createSlideAction = useCallback(async () => {
    if (!currentItemRef) return;
    await runOperation('Creating slide...', async () => {
      const previousSlideIds = new Set(slides.map((slide) => slide.id));
      const nextSnapshot = await mutatePatch(() => window.castApi.createSlide({
        presentationId: currentItemRef.type === 'presentation' ? currentItemRef.id : null,
        lyricId: currentItemRef.type === 'lyric' ? currentItemRef.id : null,
      }));
      const persistedCreatedIndex = findCreatedSlideIndex(nextSnapshot, currentItemRef, previousSlideIds);
      const createdSlideIndex = persistedCreatedIndex === null
        ? null
        : persistedCreatedIndex + (slides[0]?.runtimeBlank === 'start' ? 1 : 0);
      const selectionKey = isDetachedDeckBrowser ? itemRefKey(currentItemRef) : currentPlaylistEntryId;
      if (selectionKey && createdSlideIndex !== null) updateVisibleSelectedSlideIndex(selectionKey, createdSlideIndex);
      setStatusText('Created slide');
    });
  }, [currentItemRef, currentPlaylistEntryId, isDetachedDeckBrowser, mutatePatch, runOperation, setStatusText, slides, updateVisibleSelectedSlideIndex]);

  const deleteSlideAction = useCallback(async (slideId: Id) => {
    if (slides.find((slide) => slide.id === slideId)?.runtimeBlank) return;
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
    if (sourceIndex < 0 || slides[sourceIndex]?.runtimeBlank) return;
    await mutatePatch(() => window.castApi.duplicateSlide(slideId));
    if (selectionKey) updateVisibleSelectedSlideIndex(selectionKey, sourceIndex + 1);
    setStatusText('Duplicated slide');
  }, [currentItemRef, currentPlaylistEntryId, isDetachedDeckBrowser, mutatePatch, setStatusText, slides, updateVisibleSelectedSlideIndex]);

  const moveSlideAction = useCallback(async (slideId: Id, direction: 'up' | 'down') => {
    const storedSlides = slides.filter((slide) => !slide.runtimeBlank);
    const sourceIndex = storedSlides.findIndex((slide) => slide.id === slideId);
    if (sourceIndex < 0) return;
    const newOrder = direction === 'up' ? sourceIndex - 1 : sourceIndex + 1;
    if (newOrder < 0 || newOrder >= storedSlides.length) return;
    const selectionKey = isDetachedDeckBrowser
      ? (currentItemRef ? itemRefKey(currentItemRef) : null)
      : currentPlaylistEntryId;
    await mutatePatch(() => window.castApi.setSlideOrder({ slideId, newOrder }));
    if (selectionKey) updateVisibleSelectedSlideIndex(selectionKey, newOrder + (slides[0]?.runtimeBlank === 'start' ? 1 : 0));
    setStatusText(direction === 'up' ? 'Moved slide up' : 'Moved slide down');
  }, [currentItemRef, currentPlaylistEntryId, isDetachedDeckBrowser, mutatePatch, setStatusText, slides, updateVisibleSelectedSlideIndex]);

  const reorderSlideAction = useCallback(async (slideId: Id, newOrder: number) => {
    const storedSlides = slides.filter((slide) => !slide.runtimeBlank);
    const sourceIndex = storedSlides.findIndex((slide) => slide.id === slideId);
    if (sourceIndex < 0) return;
    const prefix = slides[0]?.runtimeBlank === 'start' ? 1 : 0;
    const storedNewOrder = newOrder - prefix;
    if (sourceIndex === storedNewOrder) return;
    if (storedNewOrder < 0 || storedNewOrder >= storedSlides.length) return;
    const selectionKey = isDetachedDeckBrowser
      ? (currentItemRef ? itemRefKey(currentItemRef) : null)
      : currentPlaylistEntryId;
    await mutatePatch(() => window.castApi.setSlideOrder({ slideId, newOrder: storedNewOrder }));
    if (selectionKey) updateVisibleSelectedSlideIndex(selectionKey, newOrder);
    setStatusText('Reordered slide');
  }, [currentItemRef, currentPlaylistEntryId, isDetachedDeckBrowser, mutatePatch, setStatusText, slides, updateVisibleSelectedSlideIndex]);

  const updateCurrentSlideNotes = useCallback(async (notes: string) => {
    if (!currentSlide || currentSlide.runtimeBlank) return;
    await mutatePatch(() => window.castApi.updateSlideNotes({ slideId: currentSlide.id, notes }));
    setStatusText('Saved slide notes');
  }, [currentSlide, mutatePatch, setStatusText]);

  const updateCurrentSlideBackground = useCallback(async (background: SlideBackground | null) => {
    if (!currentSlide || currentSlide.runtimeBlank) return;
    await mutatePatch(() => window.castApi.updateSlideBackground({ slideId: currentSlide.id, background }));
    setStatusText('Updated slide background');
  }, [currentSlide, mutatePatch, setStatusText]);

  const setLyricBlankSlidesAction = useCallback(async (mode: LyricBlankSlideMode) => {
    if (currentItemRef?.type !== 'lyric') return;
    await runOperation('Updating blank slides...', async () => {
      await mutatePatch(() => window.castApi.setLyricBlankSlides({ lyricId: currentItemRef.id, mode }));
      setStatusText('Updated blank slides');
    });
  }, [currentItemRef, mutatePatch, runOperation, setStatusText]);

  const activateScheduledSlide = useCallback((itemRef: ItemRef, slideId: Id) => {
    const contentSlides = slidesForItemRef(itemRef);
    const slideIndex = contentSlides.findIndex((s) => s.id === slideId);
    if (slideIndex < 0) return;

    // The same item may occur more than once: preserve the current matching
    // playlist row instead of always jumping to the first occurrence.
    const matchingRows = currentPlaylistRows.filter((row) => {
      if (row.kind !== 'item') return false;
      const rowRef = getPlaylistEntryItemRef(row);
      return rowRef.type === itemRef.type && rowRef.id === itemRef.id;
    });
    const foundRow = matchingRows.find((row) => row.id === currentOutputPlaylistEntryId)
      ?? matchingRows[0];

    if (foundRow) {
      liveSelection.update(foundRow.id, slideIndex);
      armOutputPlaylistEntry(foundRow.id);
    } else {
      // Direct item with no playlist row: the live index for a rowless
      // output is keyed on `itemRefKey(currentOutputItemRef)`, so update
      // that key directly before arming output.
      liveSelection.update(itemRefKey(itemRef), slideIndex);
      armOutputItem(itemRef);
    }

    noteOutputTakeIntent({
      kind: 'activate',
      slideId,
      outputScopeKey: buildNdiTakeScopeKey(foundRow?.id ?? null, itemRef),
      reason: classifyTakeReason({
        targetEntryId: foundRow?.id ?? null,
        targetItemRef: itemRef,
        targetIndex: slideIndex,
        currentOutputEntryId: currentOutputPlaylistEntryId,
        currentOutputItemRef,
        currentLiveIndex: liveSlideIndex,
      }),
    });

    dispatchAutomationTriggerEvent({ triggerType: 'slide.activate', sourceId: slideId });
    dispatchAutomationTriggerEvent({ triggerType: 'slide.take', sourceId: slideId });
  }, [
    armOutputItem,
    armOutputPlaylistEntry,
    currentOutputItemRef,
    currentOutputPlaylistEntryId,
    currentPlaylistRows,
    liveSelection,
    liveSlideIndex,
    slidesForItemRef,
  ]);

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
    selectPlaylistItem,
    activateScheduledSlide,
    createSlide: createSlideAction,
    setLyricBlankSlides: setLyricBlankSlidesAction,
    duplicateSlide: duplicateSlideAction,
    deleteSlide: deleteSlideAction,
    moveSlide: moveSlideAction,
    reorderSlide: reorderSlideAction,
    updateCurrentSlideNotes,
    updateCurrentSlideBackground,
  }), [
    activateScheduledSlide,
    activateSlide,
    armCurrentPlaylistSelection,
    createSlideAction,
    setLyricBlankSlidesAction,
    deleteSlideAction,
    duplicateSlideAction,
    moveSlideAction,
    reorderSlideAction,
    currentSlide,
    currentSlideIndex,
    clearCurrentSlideSelection,
    goNext,
    goPrev,
    isOutputArmedOnCurrent,
    liveElements,
    liveSlide,
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

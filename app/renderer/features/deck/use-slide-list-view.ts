import { useCallback, useMemo } from 'react';
import { isLyricDeckItem } from '@lumacast/composition';
import type { Id } from '@lumacast/kernel';
import type { Slide, SlideElement } from '@lumacast/composition';
import type { SlideVisualState } from '../../types/ui';
import { clamp, getSlideVisualState, slideTextDetails } from '../../utils/slides';
import { useNavigation } from '../../contexts/navigation-context';
import { useSlides } from '../../contexts/slide-context';
import { useSlideOutlineTextEditing } from './use-slide-outline-text-editing';

export interface OutlineSlideRow {
  slide: Slide;
  index: number;
  state: SlideVisualState;
  elements: SlideElement[];
  text: string;
  primaryText: string;
  secondaryText: string;
  textElementId: Id | null;
  textEditable: boolean;
}

interface OutlineViewModel {
  rows: OutlineSlideRow[];
  currentSlideIndex: number;
  selectSlide: (index: number) => void;
  openSlide: (index: number) => void;
  updateText: (slideId: Id, nextText: string) => void;
}

export function useOutlineView(): OutlineViewModel {
  const { currentDeckItem, currentDeckItemId, currentOutputDeckItemId, isDetachedDeckBrowser } = useNavigation();
  const { slides, currentSlideIndex, liveSlideIndex, slideElementsById, activateSlide, setCurrentSlideIndex } = useSlides();
  const { updateText } = useSlideOutlineTextEditing();
  const textEditable = isLyricDeckItem(currentDeckItem);
  const showLiveState = !isDetachedDeckBrowser && currentDeckItemId === currentOutputDeckItemId;

  const rows = useMemo(() => {
    return slides.map((slide, index) => {
      const elements = slideElementsById.get(slide.id) ?? [];
      const details = slideTextDetails(elements);
      const state = getSlideVisualState(index, showLiveState ? liveSlideIndex : -1, currentSlideIndex, elements);

      return {
        slide,
        index,
        state,
        elements,
        text: details.text,
        primaryText: details.primaryLine,
        secondaryText: details.secondaryLine,
        textElementId: details.textElement?.id ?? null,
        textEditable,
      } satisfies OutlineSlideRow;
    });
  }, [slides, slideElementsById, liveSlideIndex, currentSlideIndex, showLiveState, textEditable]);

  const rowBySlideId = useMemo(() => {
    const map = new Map<Id, OutlineSlideRow>();
    for (const row of rows) map.set(row.slide.id, row);
    return map;
  }, [rows]);

  const selectSlide = useCallback((index: number) => {
    if (slides.length === 0) return;
    activateSlide(clamp(index, 0, slides.length - 1));
  }, [activateSlide, slides.length]);

  const openSlide = useCallback((index: number) => {
    if (slides.length === 0) return;
    setCurrentSlideIndex(clamp(index, 0, slides.length - 1));
  }, [setCurrentSlideIndex, slides.length]);

  const commitText = useCallback((slideId: Id, nextText: string) => {
    const row = rowBySlideId.get(slideId);
    if (!row) return;

    updateText({
      elements: row.elements,
      nextText,
      slideIndex: row.index,
      textEditable: row.textEditable,
      textElementId: row.textElementId,
    });
  }, [rowBySlideId, updateText]);

  return { rows, currentSlideIndex, selectSlide, openSlide, updateText: commitText };
}

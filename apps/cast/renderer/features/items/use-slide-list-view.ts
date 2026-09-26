import { useCallback, useMemo } from 'react';
import type { Slide, SlideElement } from '@lumacast/composition';
import type { SlideVisualState } from '../../types/ui';
import { clamp, getSlideVisualState } from '../../utils/slides';
import { itemRefsEqual } from '../../utils/navigation-context-utils';
import { useNavigation } from '../../contexts/navigation-context';
import { useSlides } from '../../contexts/slide-context';

export interface OutlineSlideRow {
  slide: Slide;
  index: number;
  state: SlideVisualState;
  elements: SlideElement[];
}

interface OutlineViewModel {
  rows: OutlineSlideRow[];
  currentSlideIndex: number;
  selectSlide: (index: number) => void;
  openSlide: (index: number) => void;
}

export function useOutlineView(): OutlineViewModel {
  const { currentItemRef, currentOutputItemRef, isDetachedDeckBrowser } = useNavigation();
  const { slides, currentSlideIndex, liveSlideIndex, slideElementsById, activateSlide, setCurrentSlideIndex } = useSlides();
  const showLiveState = !isDetachedDeckBrowser && itemRefsEqual(currentItemRef, currentOutputItemRef);

  const rows = useMemo(() => {
    return slides.map((slide, index) => {
      const elements = slideElementsById.get(slide.id) ?? [];
      const state = getSlideVisualState(index, showLiveState ? liveSlideIndex : -1, currentSlideIndex, elements);

      return {
        slide,
        index,
        state,
        elements,
      } satisfies OutlineSlideRow;
    });
  }, [slides, slideElementsById, liveSlideIndex, currentSlideIndex, showLiveState]);

  const selectSlide = useCallback((index: number) => {
    if (slides.length === 0) return;
    activateSlide(clamp(index, 0, slides.length - 1));
  }, [activateSlide, slides.length]);

  const openSlide = useCallback((index: number) => {
    if (slides.length === 0) return;
    setCurrentSlideIndex(clamp(index, 0, slides.length - 1));
  }, [setCurrentSlideIndex, slides.length]);

  return { rows, currentSlideIndex, selectSlide, openSlide };
}

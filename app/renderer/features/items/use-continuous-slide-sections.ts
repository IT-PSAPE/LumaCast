import { useCallback } from 'react';
import type { Id } from '@lumacast/kernel';
import type { ItemRef } from '@lumacast/composition';
import { useNavigation } from '../../contexts/navigation-context';
import { useProjectContent } from '../../contexts/use-project-content';
import { useSlides } from '../../contexts/slide-context';

export function useContinuousSlideSections() {
  const { currentPlaylistEntryId, currentOutputPlaylistEntryId } = useNavigation();
  const { currentSlideIndex, liveSlideIndex, activatePlaylistEntrySlide, focusPlaylistEntrySlide } = useSlides();
  const { slideElementsBySlideId } = useProjectContent();

  const handleActivateSlide = useCallback((entryId: Id, itemRef: ItemRef, slideIndex: number) => {
    activatePlaylistEntrySlide(entryId, itemRef, slideIndex);
  }, [activatePlaylistEntrySlide]);

  const handleEditSlide = useCallback((entryId: Id, itemRef: ItemRef, slideIndex: number) => {
    focusPlaylistEntrySlide(entryId, itemRef, slideIndex);
  }, [focusPlaylistEntrySlide]);

  return {
    currentPlaylistEntryId,
    currentOutputPlaylistEntryId,
    currentSlideIndex,
    liveSlideIndex,
    slideElementsBySlideId,
    handleActivateSlide,
    handleEditSlide,
  };
}

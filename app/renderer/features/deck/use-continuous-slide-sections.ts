import { useCallback } from 'react';
import type { Id } from '@lumacast/kernel';
import { useNavigation } from '../../contexts/navigation-context';
import { useProjectContent } from '../../contexts/use-project-content';
import { useSlides } from '../../contexts/slide-context';

export function useContinuousSlideSections() {
  const { currentPlaylistEntryId, currentOutputPlaylistEntryId } = useNavigation();
  const { currentSlideIndex, liveSlideIndex, activatePlaylistEntrySlide, focusPlaylistEntrySlide } = useSlides();
  const { slideElementsBySlideId } = useProjectContent();

  const handleActivateSlide = useCallback((entryId: Id, itemId: Id, slideIndex: number) => {
    activatePlaylistEntrySlide(entryId, itemId, slideIndex);
  }, [activatePlaylistEntrySlide]);

  const handleEditSlide = useCallback((entryId: Id, itemId: Id, slideIndex: number) => {
    focusPlaylistEntrySlide(entryId, itemId, slideIndex);
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

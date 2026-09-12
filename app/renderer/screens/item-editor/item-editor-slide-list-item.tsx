import { useItemEditorScreen } from './screen-context';
import { getSlideVisualState } from '../../utils/slides';
import { SortableSlideTile } from './slide-tile';
import type { Id } from '@lumacast/kernel';

export function ItemEditorSlideListItem({
  slide,
  index,
  isSelected,
  actionSlideIds,
  onSelect,
}: {
  slide: ReturnType<typeof useItemEditorScreen>['state']['slides'][number];
  index: number;
  isSelected: boolean;
  actionSlideIds: Id[];
  onSelect: (extendRange: boolean) => void;
}) {
  const { state, actions } = useItemEditorScreen();
  const elements = state.currentSlide?.id === slide.id ? state.effectiveElements : actions.getSlideElements(slide.id);
  const scene = actions.getThumbnailScene(slide.id, 'deck-editor');
  if (!scene) return null;

  const visualState = getSlideVisualState(index, state.liveSlideIndex, state.currentSlideIndex, elements);

  return (
    <SortableSlideTile
      slideId={slide.id}
      scene={scene}
      index={index}
      isActive={index === state.currentSlideIndex}
      isSelected={isSelected}
      isLive={visualState === 'live'}
      isEmpty={visualState === 'warning'}
      actionSlideIds={actionSlideIds}
      onSelect={onSelect}
    />
  );
}

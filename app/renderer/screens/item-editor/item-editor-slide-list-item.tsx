import { useItemEditorScreen } from './screen-context';
import { getSlideVisualState, slideTextPreview } from '../../utils/slides';
import { SlideTile } from './slide-tile';

export function ItemEditorSlideListItem({
  slide,
  index,
}: {
  slide: ReturnType<typeof useItemEditorScreen>['state']['slides'][number];
  index: number;
}) {
  const { state, actions } = useItemEditorScreen();
  const elements = state.currentSlide?.id === slide.id ? state.effectiveElements : actions.getSlideElements(slide.id);
  const scene = actions.getThumbnailScene(slide.id, 'deck-editor');
  if (!scene) return null;

  const visualState = getSlideVisualState(index, state.liveSlideIndex, state.currentSlideIndex, elements);

  function handleSelect() {
    actions.setCurrentSlideIndex(index);
  }

  return (
    <SlideTile
      slideId={slide.id}
      scene={scene}
      index={index}
      isActive={index === state.currentSlideIndex}
      isLive={visualState === 'live'}
      isEmpty={visualState === 'warning'}
      textPreview={slideTextPreview(elements)}
      onSelect={handleSelect}
    />
  );
}

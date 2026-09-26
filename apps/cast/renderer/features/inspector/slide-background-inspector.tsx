import { useSlides } from '@renderer/contexts/slide-context';
import { BackgroundControls } from './background-controls';

export function SlideBackgroundInspector() {
  const { currentSlide, updateCurrentSlideBackground } = useSlides();
  if (!currentSlide) return null;
  return (
    <BackgroundControls
      title="Slide Background"
      background={currentSlide.background ?? null}
      onChange={(next) => { void updateCurrentSlideBackground(next); }}
    />
  );
}

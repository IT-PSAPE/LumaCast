import type { Id, SlideBackground } from '@core/types';
import { useCast } from '@renderer/contexts/app-context';
import { BackgroundControls } from './background-controls';

// Background editor for theme/overlay/stage. Their background lives on the
// backing slide row (`<ownerId>:slide`); persisting it via updateSlideBackground
// upserts the owning container so the editor + outputs refresh.
export function EntityBackgroundInspector({ ownerId, background }: { ownerId: Id; background: SlideBackground | null }) {
  const { mutatePatch } = useCast();
  return (
    <BackgroundControls
      title="Background"
      background={background}
      onChange={(next) => {
        void mutatePatch(() => window.castApi.updateSlideBackground({ slideId: `${ownerId}:slide`, background: next }));
      }}
    />
  );
}

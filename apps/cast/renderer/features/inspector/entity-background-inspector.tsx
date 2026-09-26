import type { Id } from '@lumacast/kernel';
import type { SlideBackground } from '@lumacast/composition';
import { useCast } from '@renderer/contexts/app-context';
import { BackgroundControls } from './background-controls';

// Background editor for theme/overlay/stage. Their background lives on the
// backing slide row (`<ownerId>:slide`); persisting it via updateSlideBackground
// upserts the owning container so the editor + outputs refresh.
//
// When an `onChange` callback is provided, it is called instead of the default
// `updateSlideBackground` IPC call. This lets callers (e.g. ThemeInspector)
// route changes through their own staging mechanism.
export function EntityBackgroundInspector({ ownerId, background, onChange }: { ownerId: Id; background: SlideBackground | null; onChange?: (background: SlideBackground | null) => void }) {
  const { mutatePatch } = useCast();
  return (
    <BackgroundControls
      title="Background"
      background={background}
      onChange={(next) => {
        if (onChange) {
          onChange(next);
        } else {
          void mutatePatch(() => window.castApi.updateSlideBackground({ slideId: `${ownerId}:slide`, background: next }));
        }
      }}
    />
  );
}

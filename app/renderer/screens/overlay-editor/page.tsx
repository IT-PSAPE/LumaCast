import { OverlayEditorScreenProvider } from './screen-context';
import { OverlayEditorScreenContent } from './screen-content';

export function OverlayEditorScreen() {
  return (
    <OverlayEditorScreenProvider>
      <OverlayEditorScreenContent />
    </OverlayEditorScreenProvider>
  );
}

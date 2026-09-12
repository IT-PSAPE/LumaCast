import { StageEditorScreenProvider } from './screen-context';
import { StageEditorScreenContent } from './screen-content';

export function StageEditorScreen() {
  return (
    <StageEditorScreenProvider>
      <StageEditorScreenContent />
    </StageEditorScreenProvider>
  );
}

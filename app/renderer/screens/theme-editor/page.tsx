import { ThemeEditorScreenProvider } from './screen-context';
import { ThemeEditorScreenContent } from './screen-content';

export function ThemeEditorScreen() {
  return (
    <ThemeEditorScreenProvider>
      <ThemeEditorScreenContent />
    </ThemeEditorScreenProvider>
  );
}

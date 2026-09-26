import { MacroEditorScreenProvider } from './screen-context';
import { MacroEditorScreenContent } from './screen-content';

export function MacroEditorScreen() {
  return (
    <MacroEditorScreenProvider>
      <MacroEditorScreenContent />
    </MacroEditorScreenProvider>
  );
}

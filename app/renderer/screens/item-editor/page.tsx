import { ItemEditorScreenContent } from './item-editor-screen-content';
import { ItemEditorScreenProvider } from './screen-context';

export function ItemEditorScreen() {
  return (
    <ItemEditorScreenProvider>
      <ItemEditorScreenContent />
    </ItemEditorScreenProvider>
  );
}

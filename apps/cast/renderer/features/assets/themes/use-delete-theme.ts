import type { EditorThemeSource } from '@lumacast/canvas';
import { useThemeEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { useConfirm } from '@lumacast/ui';

export function useDeleteTheme(theme: EditorThemeSource) {
  const { deleteTheme } = useThemeEditor();
  const confirm = useConfirm();

  return async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${theme.name}"?`,
      description: 'Slides linked to this theme will be detached.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (ok) deleteTheme(theme.id);
  };
}

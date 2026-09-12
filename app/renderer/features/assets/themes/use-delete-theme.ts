import type { EditorThemeSource } from '@lumacast/canvas';
import { useConfirm } from '../../../components/overlays/confirm-dialog';
import { useThemeEditor } from '../../../contexts/asset-editor/asset-editor-context';

export function useDeleteTheme(theme: EditorThemeSource) {
  const { deleteTheme } = useThemeEditor();
  const confirm = useConfirm();

  return async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${theme.name}"?`,
      description: 'Slides linked to this theme will be detached.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) deleteTheme(theme.id);
  };
}

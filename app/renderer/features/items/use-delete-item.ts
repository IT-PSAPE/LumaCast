import type { ItemRef } from '@lumacast/composition';
import { useConfirm } from '../../components/overlays/confirm-dialog';
import { useNavigation } from '../../contexts/navigation-context';

export function useDeleteItem(itemRef: ItemRef, title: string) {
  const { deleteItem } = useNavigation();
  const confirm = useConfirm();

  return async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${title}"?`,
      description: 'This permanently removes the item and all its slides. This action cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await deleteItem(itemRef);
  };
}

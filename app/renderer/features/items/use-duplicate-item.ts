import type { ItemRef } from '@lumacast/composition';
import { useCast } from '../../contexts/app-context';
import { useNavigation } from '../../contexts/navigation-context';

// Talks don't support duplication (D1: there is simply no duplicateTalk).
export function useDuplicateItem(itemRef: ItemRef, title: string) {
  const { mutatePatch, setStatusText } = useCast();
  const { browseItem } = useNavigation();

  if (itemRef.type === 'talk') return null;
  const duplicableType = itemRef.type;

  return async function handleDuplicate() {
    try {
      const result = await window.castApi.duplicateItem({ type: duplicableType, id: itemRef.id });
      await mutatePatch(async () => result.patch);
      browseItem({ type: duplicableType, id: result.itemId });
      setStatusText(`Duplicated "${title}"`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(`Failed to duplicate: ${message}`);
    }
  };
}

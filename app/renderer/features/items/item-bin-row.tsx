import { ContextMenu } from '../../components/overlays/context-menu';
import type { ItemLike, ItemProps } from './item-bin-types';
import { ItemBinRowBody } from './item-bin-row-body';

export function ItemBinRow<T extends ItemLike>(props: ItemProps<T>) {
  return (
    <ContextMenu.Root>
      <ItemBinRowBody {...props} />
    </ContextMenu.Root>
  );
}

import { ContextMenu } from '../../components/overlays/context-menu';
import type { ItemLike, ItemProps } from './item-bin-types';
import { ItemBinTileBody } from './item-bin-tile-body';

export function ItemBinTile<T extends ItemLike>(props: ItemProps<T>) {
  return (
    <ContextMenu.Root>
      <ItemBinTileBody {...props} />
    </ContextMenu.Root>
  );
}

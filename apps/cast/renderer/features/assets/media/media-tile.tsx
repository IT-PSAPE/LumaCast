import { ContextMenu } from '../../../components/overlays/context-menu';
import type { MediaItemProps } from './media-bin-types';
import { MediaTileBody } from './media-tile-body';

export function MediaTile(props: MediaItemProps) {
  return (
    <ContextMenu.Root>
      <MediaTileBody {...props} />
    </ContextMenu.Root>
  );
}

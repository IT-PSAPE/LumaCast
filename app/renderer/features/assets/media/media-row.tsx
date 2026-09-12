import { ContextMenu } from '../../../components/overlays/context-menu';
import type { MediaItemProps } from './media-bin-types';
import { MediaRowBody } from './media-row-body';

export function MediaRow(props: MediaItemProps) {
  return (
    <ContextMenu.Root>
      <MediaRowBody {...props} />
    </ContextMenu.Root>
  );
}

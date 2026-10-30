import { ContextMenu } from '@lumacast/ui';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { useMultiSelection } from '@lumacast/selection';
import { useOverlayEditorScreen } from './screen-context';
import { OverlayListItemBody } from './overlay-list-item-body';

export function OverlayListItem(props: {
  overlay: ReturnType<typeof useOverlayEditorScreen>['state']['overlays'][number];
  isActive: boolean;
  selection: ReturnType<typeof useMultiSelection>;
  onSelect: (event: ReactMouseEvent<HTMLElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  return (
    <ContextMenu.Root>
      <OverlayListItemBody {...props} />
    </ContextMenu.Root>
  );
}

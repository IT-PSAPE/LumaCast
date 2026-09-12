import { ContextMenu } from '@renderer/components/overlays/context-menu';
import { useOverlayEditorScreen } from './screen-context';
import { OverlayListItemBody } from './overlay-list-item-body';

export function OverlayListItem(props: {
  overlay: ReturnType<typeof useOverlayEditorScreen>['state']['overlays'][number];
  index: number;
  isActive: boolean;
}) {
  return (
    <ContextMenu.Root>
      <OverlayListItemBody {...props} />
    </ContextMenu.Root>
  );
}

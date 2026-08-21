import { ContextMenu } from '../../../components/overlays/context-menu';

export function MediaContextMenuItems({
  onReplaceSource,
  onDelete,
}: {
  onReplaceSource: () => void;
  onDelete: () => void;
}) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.Menu>
        <ContextMenu.Item onSelect={onReplaceSource}>Replace source…</ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item variant="destructive" onSelect={onDelete}>Delete</ContextMenu.Item>
      </ContextMenu.Menu>
    </ContextMenu.Portal>
  );
}

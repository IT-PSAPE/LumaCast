import { ContextMenu } from '@renderer/components/overlays/context-menu';
import type { Macro } from '@lumacast/automation';
import { MacroListItemBody } from './macro-list-item-body';

interface MacroListItemProps {
  macro: Macro;
  index: number;
  isActive: boolean;
  onSelect: (id: Macro['id']) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function MacroListItem(props: MacroListItemProps) {
  return (
    <ContextMenu.Root>
      <MacroListItemBody {...props} />
    </ContextMenu.Root>
  );
}

import { ContextMenu } from '@lumacast/ui';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Id } from '@lumacast/kernel';
import type { useMultiSelection } from '@lumacast/selection';
import type { Macro } from '@lumacast/automation';
import { MacroListItemBody } from './macro-list-item-body';

interface MacroListItemProps {
  macro: Macro;
  isActive: boolean;
  selection: ReturnType<typeof useMultiSelection>;
  onSelect: (event: ReactMouseEvent<HTMLElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDuplicateMany: (ids: Id[]) => void;
  onDeleteMany: (ids: Id[]) => void;
}

export function MacroListItem(props: MacroListItemProps) {
  return (
    <ContextMenu.Root>
      <MacroListItemBody {...props} />
    </ContextMenu.Root>
  );
}

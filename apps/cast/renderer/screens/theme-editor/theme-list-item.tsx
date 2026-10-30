import { ContextMenu } from '@lumacast/ui';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { useMultiSelection } from '@lumacast/selection';
import { useThemeEditorScreen } from './screen-context';
import { ThemeListItemBody } from './theme-list-item-body';

export function ThemeListItem(props: {
  theme: ReturnType<typeof useThemeEditorScreen>['state']['themes'][number];
  isActive: boolean;
  selection: ReturnType<typeof useMultiSelection>;
  onSelect: (event: ReactMouseEvent<HTMLElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  return (
    <ContextMenu.Root>
      <ThemeListItemBody {...props} />
    </ContextMenu.Root>
  );
}

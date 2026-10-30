import { ContextMenu } from '@lumacast/ui';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { useMultiSelection } from '@lumacast/selection';
import { useStageEditorScreen } from './screen-context';
import { StageListItemBody } from './stage-list-item-body';

export function StageListItem(props: {
  stage: ReturnType<typeof useStageEditorScreen>['state']['stages'][number];
  isActive: boolean;
  selection: ReturnType<typeof useMultiSelection>;
  onSelect: (event: ReactMouseEvent<HTMLElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  return (
    <ContextMenu.Root>
      <StageListItemBody {...props} />
    </ContextMenu.Root>
  );
}

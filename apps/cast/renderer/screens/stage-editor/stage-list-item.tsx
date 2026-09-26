import { ContextMenu } from '@renderer/components/overlays/context-menu';
import { useStageEditorScreen } from './screen-context';
import { StageListItemBody } from './stage-list-item-body';

export function StageListItem(props: {
  stage: ReturnType<typeof useStageEditorScreen>['state']['stages'][number];
  index: number;
  isActive: boolean;
}) {
  return (
    <ContextMenu.Root>
      <StageListItemBody {...props} />
    </ContextMenu.Root>
  );
}

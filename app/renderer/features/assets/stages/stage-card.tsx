import { memo } from 'react';
import { ContextMenu } from '../../../components/overlays/context-menu';
import type { StageCardProps } from './stage-card-body';
import { StageCardBody } from './stage-card-body';

// Keep the memo wrapper together with its Impl.
function StageCardImpl(props: StageCardProps) {
  return (
    <ContextMenu.Root>
      <StageCardBody {...props} />
    </ContextMenu.Root>
  );
}

export const StageCard = memo(StageCardImpl);

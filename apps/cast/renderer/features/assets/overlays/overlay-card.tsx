import { memo } from 'react';
import { ContextMenu } from '../../../components/overlays/context-menu';
import type { OverlayCardProps } from './overlay-card-body';
import { OverlayCardBody } from './overlay-card-body';

// Keep the memo wrapper together with its Impl.
function OverlayCardImpl(props: OverlayCardProps) {
  return (
    <ContextMenu.Root>
      <OverlayCardBody {...props} />
    </ContextMenu.Root>
  );
}

export const OverlayCard = memo(OverlayCardImpl);

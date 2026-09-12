import { memo } from 'react';
import { ContextMenu } from '../../components/overlays/context-menu';
import type { MacroCardProps } from './macro-card-body';
import { MacroCardBody } from './macro-card-body';

// Keep the memo wrapper together with its Impl.
function MacroCardImpl(props: MacroCardProps) {
  return (
    <ContextMenu.Root>
      <MacroCardBody {...props} />
    </ContextMenu.Root>
  );
}

export const MacroCard = memo(MacroCardImpl);

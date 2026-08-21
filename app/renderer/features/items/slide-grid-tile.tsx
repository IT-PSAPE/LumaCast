import { memo } from 'react';
import { ContextMenu } from '@renderer/components/overlays/context-menu';
import { SlideGridTileBody, type SlideGridTileProps } from './slide-grid-tile-body';

function SlideGridTileImpl(props: SlideGridTileProps) {
  return (
    <ContextMenu.Root>
      <SlideGridTileBody {...props} />
    </ContextMenu.Root>
  );
}

export const SlideGridTile = memo(SlideGridTileImpl);

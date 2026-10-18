import { memo } from 'react';
import { ContextMenu } from '@lumacast/ui';
import { SlideGridTileBody, type SlideGridTileProps } from './slide-grid-tile-body';

function SlideGridTileImpl(props: SlideGridTileProps) {
  if (props.overlay) return <SlideGridTileBody {...props} />;
  return (
    <ContextMenu.Root>
      <SlideGridTileBody {...props} />
    </ContextMenu.Root>
  );
}

export const SlideGridTile = memo(SlideGridTileImpl);

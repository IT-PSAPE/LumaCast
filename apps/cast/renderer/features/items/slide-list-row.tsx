import { memo } from 'react';
import { ContextMenu } from '@lumacast/ui';
import { SlideOutlineRowBody, type SlideOutlineRowProps } from './slide-list-row-body';

function SlideOutlineRowImpl(props: SlideOutlineRowProps) {
  if (props.overlay) return <SlideOutlineRowBody {...props} />;
  return (
    <ContextMenu.Root>
      <SlideOutlineRowBody {...props} />
    </ContextMenu.Root>
  );
}

export const SlideOutlineRow = memo(SlideOutlineRowImpl);

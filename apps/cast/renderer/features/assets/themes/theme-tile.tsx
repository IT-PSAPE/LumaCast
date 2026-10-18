import { memo } from 'react';
import { ContextMenu } from '@lumacast/ui';
import { type ThemeItemProps } from './theme-bin-types';
import { ThemeTileBody } from './theme-tile-body';

function ThemeTileImpl(props: ThemeItemProps) {
  return (
    <ContextMenu.Root>
      <ThemeTileBody {...props} />
    </ContextMenu.Root>
  );
}

export const ThemeTile = memo(ThemeTileImpl);

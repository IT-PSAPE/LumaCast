import { memo } from 'react';
import { ContextMenu } from '../../../components/overlays/context-menu';
import { type ThemeItemProps } from './theme-bin-types';
import { ThemeRowBody } from './theme-row-body';

function ThemeRowImpl(props: ThemeItemProps) {
  return (
    <ContextMenu.Root>
      <ThemeRowBody {...props} />
    </ContextMenu.Root>
  );
}

export const ThemeRow = memo(ThemeRowImpl);

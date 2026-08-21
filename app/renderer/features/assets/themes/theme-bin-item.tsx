import { type ThemeItemProps } from './theme-bin-types';
import { ThemeRow } from './theme-row';
import { ThemeTile } from './theme-tile';

export function ThemeBinItem({ mode, ...props }: ThemeItemProps & { mode: 'grid' | 'list' }) {
  if (mode === 'list') return <ThemeRow {...props} />;
  return <ThemeTile {...props} />;
}

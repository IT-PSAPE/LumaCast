import type { MediaItemProps } from './media-bin-types';
import { MediaRow } from './media-row';
import { MediaTile } from './media-tile';

export function MediaBinItem({ mode, ...props }: MediaItemProps & { mode: 'grid' | 'list' }) {
  if (mode === 'list') return <MediaRow {...props} />;
  return <MediaTile {...props} />;
}

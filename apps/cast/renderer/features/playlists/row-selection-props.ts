import type { PlaylistRow } from '@lumacast/composition';

export interface PlaylistSelectionProps {
  isMultiSelected?: boolean;
  onSelectionClick?: (rowId: string, event: React.MouseEvent<HTMLElement>) => boolean;
}

export interface PlaylistRowSelectionProps {
  isMultiSelected?: boolean;
  actionRows?: PlaylistRow[];
  onSelectionClick?: (rowId: string, event: React.MouseEvent<HTMLElement>) => boolean;
  onRemoveRows?: (rows: readonly PlaylistRow[]) => void | Promise<void>;
  onMoveRows?: (rows: readonly PlaylistRow[], direction: 'up' | 'down') => void | Promise<void>;
}

import type { Playlist } from '@lumacast/composition';
import { ContextMenu } from '@lumacast/ui';
import { PlaylistRowBody } from './playlist-row-body';
import type { PlaylistSelectionProps } from './row-selection-props';

export function PlaylistRow({
  playlist,
  isMultiSelected,
  actionPlaylists,
  onSelectionClick,
  onDeletePlaylists,
  onMovePlaylists,
}: PlaylistSelectionProps & {
  playlist: Playlist;
  actionPlaylists?: Playlist[];
  onDeletePlaylists?: (playlists: readonly Playlist[]) => void | Promise<void>;
  onMovePlaylists?: (playlists: readonly Playlist[], direction: 'up' | 'down') => void | Promise<void>;
}) {
  return (
    <ContextMenu.Root>
      <PlaylistRowBody
        playlist={playlist}
        isMultiSelected={isMultiSelected}
        actionPlaylists={actionPlaylists}
        onSelectionClick={onSelectionClick}
        onDeletePlaylists={onDeletePlaylists}
        onMovePlaylists={onMovePlaylists}
      />
    </ContextMenu.Root>
  );
}

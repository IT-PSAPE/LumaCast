import type { Playlist } from '@lumacast/composition';
import { ContextMenu } from '@lumacast/ui';
import { PlaylistRowBody } from './playlist-row-body';

export function PlaylistRow({ playlist }: { playlist: Playlist }) {
  return (
    <ContextMenu.Root>
      <PlaylistRowBody playlist={playlist} />
    </ContextMenu.Root>
  );
}

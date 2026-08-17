// Domain primitives (#153, split from app/core/types.ts): the library /
// playlist hierarchy (library -> playlist -> group -> entry) and the
// read-composed trees built from it.
import type { Id } from './ids';
import type { DeckItem } from './decks';
import type { PlaylistItemReference } from '../playlist-item-reference';

export interface Library {
  id: Id;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Playlist {
  id: Id;
  libraryId: Id;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistGroup {
  id: Id;
  playlistId: Id;
  name: string;
  colorKey: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistEntry {
  id: Id;
  groupId: Id;
  // Canonical, exhaustively-validated pointer to the referenced item. `id`
  // above is this entry's own identity; `reference.itemId` is the referenced
  // item's identity — the two are independent (see @core/playlist-item-reference).
  reference: PlaylistItemReference;
  // Legacy nullable owner columns mirroring `reference`, retained because
  // persistence stores them directly and app/core/deck-items.ts still reads
  // them. Always kept in sync with `reference`; do not set independently.
  presentationId: Id | null;
  lyricId: Id | null;
  talkId: Id | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistTree {
  playlist: Playlist;
  groups: Array<{
    group: PlaylistGroup;
    entries: Array<{
      entry: PlaylistEntry;
      item: DeckItem;
    }>;
  }>;
}

export interface LibraryPlaylistBundle {
  library: Library;
  playlists: PlaylistTree[];
}

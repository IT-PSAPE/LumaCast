// Domain primitives (#153, split from app/core/types.ts; #219 item-model
// refactor decisions D4/D5): the playlist entity and the flat, ordered rows
// that make it up. Playlists are global — there is no library grouping
// them (Library and LibraryPlaylistBundle are gone) — and there is no
// PlaylistGroup nesting: a separator is a plain divider row inside the flat
// row list, not a collapsible section.
import type { Id } from '@lumacast/kernel';
import type { PlaylistItemReference } from '../playlist-item-reference';

export interface Playlist {
  id: Id;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistItemEntry {
  id: Id;
  playlistId: Id;
  kind: 'item';
  // Canonical, exhaustively-validated pointer to the referenced item. `id`
  // above is this entry's own identity; `reference.itemId` is the referenced
  // item's identity — the two are independent (see ../playlist-item-reference).
  reference: PlaylistItemReference;
  // Legacy nullable owner columns mirroring `reference`, retained because
  // persistence stores them directly. Always kept in sync with `reference`;
  // do not set independently. Only ever populated on a `kind: 'item'` row —
  // a separator carries none of them.
  presentationId: Id | null;
  lyricId: Id | null;
  talkId: Id | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

// The divider row: keeps its own label and color, never collapses, and owns
// no item. Replaces PlaylistGroup — a separator is a row *in* the playlist,
// not a container *around* entries.
export interface PlaylistSeparator {
  id: Id;
  playlistId: Id;
  kind: 'separator';
  label: string;
  colorKey: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One row in a playlist's flat, ordered row list, discriminated on `kind`.
 * `../playlist-item-reference`'s parsePlaylistItemReference must only ever
 * see the owner columns of a `kind: 'item'` row — discriminate on `kind`
 * before parsing a reference, never call it on a separator.
 */
export type PlaylistRow = PlaylistItemEntry | PlaylistSeparator;

export interface PlaylistTree {
  playlist: Playlist;
  rows: PlaylistRow[];
}

import type { Id } from '@lumacast/kernel';
import type { ItemRef, ItemType, Lyric, PlaylistRow, Presentation, Talk } from '@lumacast/composition';

// #219 item-model refactor decision D9: no `currentLibraryId`/
// `currentLibraryBundle` — playlists are global and a playlist's rows come
// straight off the flat snapshot. `currentItemRef`/`currentPlaylistItemRef`/
// `currentDrawerItemRef`/`currentOutputItemRef` replace the old
// `*DeckItemId` spine with a typed `ItemRef` (there is no merged id space to
// key a bare `Id` against any more).

export interface NavigationStateValue {
  currentPlaylistId: Id | null;
  /** The current playlist's rows (item entries + separators), flat and ordered. Empty when no playlist is selected. */
  currentPlaylistRows: PlaylistRow[];
  currentPlaylistEntryId: Id | null;
  currentItemRef: ItemRef | null;
  currentPlaylistItemRef: ItemRef | null;
  currentDrawerItemRef: ItemRef | null;
  currentOutputPlaylistEntryId: Id | null;
  currentOutputItemRef: ItemRef | null;
  currentItem: Presentation | Lyric | Talk | null;
  currentPlaylistItem: Presentation | Lyric | Talk | null;
  isDetachedDeckBrowser: boolean;
  outputArmVersion: number;
  slideCountByItem: ReadonlyMap<string, number>;
  recentlyCreatedId: Id | null;
}

export interface ItemCreateOptions {
  type: ItemType;
  name: string;
  themeId?: Id;
  playlistId?: Id;
  position?: number;
}

export interface NavigationActionsValue {
  selectPlaylistEntry: (rowId: Id) => void;
  selectPlaylistItem: (itemRef: ItemRef) => void;
  browseItem: (itemRef: ItemRef) => void;
  armOutputPlaylistEntry: (rowId: Id) => void;
  armOutputItem: (itemRef: ItemRef) => void;
  clearOutputItem: () => void;
  setCurrentPlaylistId: (id: Id | null) => void;
  clearRecentlyCreated: () => void;
  createPlaylist: () => Promise<void>;
  createPresentation: () => Promise<void>;
  createEmptyLyric: () => Promise<void>;
  createItem: (input: ItemCreateOptions) => Promise<void>;
  createSeparator: () => Promise<void>;
  renameSeparator: (id: Id, label: string) => Promise<void>;
  setSeparatorColor: (id: Id, colorKey: string | null) => Promise<void>;
  addItemToPlaylist: (playlistId: Id, itemRef: ItemRef, position?: number) => Promise<Id | null>;
  renamePlaylist: (id: Id, name: string) => Promise<void>;
  renameItem: (itemRef: ItemRef, title: string) => Promise<void>;
  deleteItem: (itemRef: ItemRef) => Promise<void>;
  moveItem: (itemRef: ItemRef, direction: 'up' | 'down') => Promise<void>;
  reorderPlaylist: (playlistId: Id, newOrder: number) => Promise<void>;
  movePlaylistRow: (rowId: Id, newOrder: number) => Promise<void>;
  removePlaylistRow: (rowId: Id) => Promise<void>;
}

export type NavigationContextValue = NavigationStateValue & NavigationActionsValue;

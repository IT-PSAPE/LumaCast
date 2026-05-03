import type { DeckItem, Id, LibraryPlaylistBundle } from '@core/types';

export interface NavigationStateValue {
  currentLibraryId: Id | null;
  currentPlaylistId: Id | null;
  currentPlaylistEntryId: Id | null;
  currentDeckItemId: Id | null;
  currentPlaylistDeckItemId: Id | null;
  currentDrawerDeckItemId: Id | null;
  currentOutputPlaylistEntryId: Id | null;
  currentOutputDeckItemId: Id | null;
  currentLibraryBundle: LibraryPlaylistBundle | null;
  currentDeckItem: DeckItem | null;
  currentPlaylistDeckItem: DeckItem | null;
  isDetachedDeckBrowser: boolean;
  outputArmVersion: number;
  slideCountByDeckItem: Map<Id, number>;
  recentlyCreatedId: Id | null;
}

export interface NavigationActionsValue {
  selectLibrary: (id: Id) => void;
  selectPlaylistEntry: (entryId: Id) => void;
  selectPlaylistDeckItem: (id: Id) => void;
  browseDeckItem: (id: Id) => void;
  armOutputPlaylistEntry: (entryId: Id) => void;
  armOutputDeckItem: (id: Id) => void;
  clearOutputDeckItem: () => void;
  setCurrentPlaylistId: (id: Id | null) => void;
  clearRecentlyCreated: () => void;
  createLibrary: () => Promise<void>;
  createPlaylist: () => Promise<void>;
  createPresentation: () => Promise<void>;
  createEmptyLyric: () => Promise<void>;
  createDeckItem: (input: {
    kind: 'presentation' | 'lyric';
    name: string;
    themeId?: Id;
    segmentId?: Id;
  }) => Promise<void>;
  createSegment: () => Promise<void>;
  addDeckItemToSegment: (segmentId: Id) => Promise<void>;
  addDeckItemToSegmentAt: (segmentId: Id, itemId: Id, newOrder: number) => Promise<Id | null>;
  moveCurrentDeckItemToSegment: (segmentId: Id | null) => Promise<void>;
  renameLibrary: (id: Id, name: string) => Promise<void>;
  renamePlaylist: (id: Id, name: string) => Promise<void>;
  renameDeckItem: (id: Id, title: string) => Promise<void>;
  reorderLibrary: (libraryId: Id, newOrder: number) => Promise<void>;
  reorderPlaylist: (playlistId: Id, newOrder: number) => Promise<void>;
  reorderSegment: (segmentId: Id, newOrder: number) => Promise<void>;
  movePlaylistEntry: (entryId: Id, segmentId: Id, newOrder: number) => Promise<void>;
  movePlaylistEntryDirection: (entryId: Id, direction: 'up' | 'down') => Promise<void>;
  removePlaylistEntry: (entryId: Id) => Promise<void>;
}

export type NavigationContextValue = NavigationStateValue & NavigationActionsValue;

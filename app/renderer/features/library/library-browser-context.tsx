import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PlaylistTree } from '@core/types';
import { useNavigation } from '../../contexts/navigation-context';
import { useLibraryPanelManagement } from './use-library-panel-management';
import { useLibraryPanelState } from './library-panel-context';

export type EditingTarget = { type: 'library' | 'playlist' | 'group' | 'presentation'; id: string } | null;

interface LibraryBrowserContextValue {
  state: {
    selectedTree: PlaylistTree | null;
    editingTarget: EditingTarget;
  };
  actions: {
    beginEditing: (type: NonNullable<EditingTarget>['type'], id: string) => void;
    setLibrariesView: () => void;
    setPlaylistView: () => void;
    renameGroup: (groupId: string, name: string) => void;
    renameDeckItem: (itemId: string, title: string) => void;
    isEditing: (type: NonNullable<EditingTarget>['type'], id: string) => boolean;
    clearEditing: () => void;
  };
}

const LibraryBrowserContext = createContext<LibraryBrowserContextValue | null>(null);

export function LibraryBrowserProvider({ children }: { children: ReactNode }) {
  const { currentLibraryBundle, currentPlaylistId, clearRecentlyCreated } = useNavigation();
  const { libraryPanelView, setLibraryPanelView } = useLibraryPanelState();
  const { renameGroup, renameDeckItem } = useLibraryPanelManagement();
  const [editingTarget, setEditingTarget] = useState<EditingTarget>(null);

  const selectedTree = currentLibraryBundle?.playlists.find((playlist) => playlist.playlist.id === currentPlaylistId) ?? null;
  const clearEditing = useCallback(() => setEditingTarget(null), []);
  const beginEditing = useCallback((type: NonNullable<EditingTarget>['type'], id: string) => {
    setEditingTarget({ type, id });
  }, []);
  const isEditing = useCallback((type: NonNullable<EditingTarget>['type'], id: string) => {
    return editingTarget?.type === type && editingTarget.id === id;
  }, [editingTarget]);

  useEffect(() => {
    if (libraryPanelView === 'libraries') return;
    clearEditing();
    clearRecentlyCreated();
  }, [clearEditing, clearRecentlyCreated, libraryPanelView]);

  const value = useMemo<LibraryBrowserContextValue>(() => ({
    state: {
      selectedTree,
      editingTarget,
    },
    actions: {
      setLibrariesView: () => { setLibraryPanelView('libraries'); },
      setPlaylistView: () => { setLibraryPanelView('playlist'); },
      beginEditing,
      renameGroup: (groupId: string, name: string) => {
        // renameGroup → renamePlaylistGroup rejects when the group no longer
        // exists (#214), which a rename field commit can race with a concurrent
        // delete. mutatePatch has already reported the failure, so absorb the
        // rethrow here.
        void renameGroup(groupId, name).catch(() => undefined);
      },
      renameDeckItem: (itemId: string, title: string) => {
        // renameDeckItem → renamePresentation/Lyric/Talk rejects when the item
        // no longer exists (#214), which a rename field commit can race with a
        // concurrent delete. mutatePatch has already reported the failure, so
        // absorb the rethrow here.
        void renameDeckItem(itemId, title).catch(() => undefined);
      },
      isEditing,
      clearEditing,
    },
  }), [beginEditing, clearEditing, editingTarget, isEditing, renameDeckItem, renameGroup, selectedTree, setLibraryPanelView]);

  return <LibraryBrowserContext.Provider value={value}>{children}</LibraryBrowserContext.Provider>;
}

export function useLibraryBrowser(): LibraryBrowserContextValue {
  const context = useContext(LibraryBrowserContext);
  if (!context) throw new Error('useLibraryBrowser must be used within LibraryBrowserProvider');
  return context;
}

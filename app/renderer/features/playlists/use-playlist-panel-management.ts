import { useCallback } from 'react';
import type { Id } from '@lumacast/kernel';
import { useCast } from '../../contexts/app-context';

// #219 item-model refactor decision D4/D5: libraries, playlist groups, and
// the unified deck-item dispatch this hook used to carry all die with their
// concepts. renamePlaylist/renameItem/deleteItem/moveItem/movePlaylistRow/
// removePlaylistRow/createSeparator/renameSeparator/setSeparatorColor now
// live directly on navigation-context (one IPC op each, no cross-feature
// dispatch needed) — the two playlist-only ops below (deletePlaylist,
// movePlaylist direction) are what's left uncovered by that context.
export function usePlaylistPanelManagement() {
  const { mutatePatch, setStatusText } = useCast();

  const deletePlaylist = useCallback(async (id: Id) => {
    await mutatePatch(() => window.castApi.deletePlaylist(id));
    setStatusText('Deleted playlist');
  }, [mutatePatch, setStatusText]);

  const movePlaylist = useCallback(async (id: Id, direction: 'up' | 'down') => {
    await mutatePatch(() => window.castApi.movePlaylist(id, direction));
    setStatusText(direction === 'up' ? 'Moved playlist up' : 'Moved playlist down');
  }, [mutatePatch, setStatusText]);

  return {
    deletePlaylist,
    movePlaylist,
  };
}

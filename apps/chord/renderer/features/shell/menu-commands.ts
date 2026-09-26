// Subscribes once (mounted by `App.tsx`) to main's two push channels and
// dispatches every native menu command to the store or to a dialog. Renders
// nothing — it's the same event either way whether the user clicked a top
// bar control or used the menu bar/a shortcut, so both paths land here or in
// `top-bar.tsx`'s own handlers, never duplicated.
import { useEffect } from 'react';
import { getApi } from '../../api';
import { useChordStore } from '../../store';
import { importAudio, importBackground, importLyrics } from '../library/import-flows';
import { openCueFormatChooser, openExportDialog } from './shell-ui-state';

export function useMenuCommands(): void {
  useEffect(() => {
    const api = getApi();

    const unsubscribeCommand = api.onMenuCommand((command) => {
      const store = useChordStore.getState();
      switch (command) {
        case 'new':
          void store.newDocument();
          break;
        case 'open':
          void store.openDocument();
          break;
        case 'save':
          void store.saveDocument(false);
          break;
        case 'save-as':
          void store.saveDocument(true);
          break;
        case 'import-audio':
          void importAudio();
          break;
        case 'import-cues':
          void importLyrics();
          break;
        case 'import-background':
          void importBackground();
          break;
        case 'export':
          openExportDialog();
          break;
        case 'export-cues':
          openCueFormatChooser();
          break;
        case 'undo':
          store.undo();
          break;
        case 'redo':
          store.redo();
          break;
        case 'play-pause':
          store.togglePlay();
          break;
        case 'add-cue':
          store.addCue(store.playback.timeMs);
          break;
        case 'split-cue': {
          const [id] = store.selection;
          if (id) store.splitCueAt(id, store.playback.timeMs);
          break;
        }
        case 'delete-selection':
          if (store.selection.length > 0) store.deleteCues(store.selection);
          break;
        case 'zoom-in':
          store.zoomBy(1.25);
          break;
        case 'zoom-out':
          store.zoomBy(0.8);
          break;
        case 'zoom-fit':
          store.zoomToFit();
          break;
        default: {
          const exhaustive: never = command;
          void exhaustive;
        }
      }
    });

    const unsubscribeOpen = api.onOpenDocument((document) => {
      useChordStore.getState().loadDocument(document);
    });

    return () => {
      unsubscribeCommand();
      unsubscribeOpen();
    };
  }, []);
}

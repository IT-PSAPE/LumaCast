// Subscribes once (mounted by `App.tsx`) to main's two push channels and
// dispatches every native menu command to the store or to a dialog. Renders
// nothing — it's the same event either way whether the user clicked a top
// bar control or used the menu bar/a shortcut, so both paths land here or in
// `top-bar.tsx`'s own handlers, never duplicated.
import { useEffect } from 'react';
import { getApi } from '../../api';
import { useChordStore } from '../../store';
import { isEditableTarget } from '../timeline/use-timeline-shortcuts';
import { deleteSelectedCues, duplicateSelectedCue, trimSelectedCueToPlayhead } from '../timeline/cue-commands';
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
          if (store.document.project.cues.length > 0 || store.document.project.audio !== null) openExportDialog();
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
          deleteSelectedCues();
          break;
        case 'duplicate-cue':
          duplicateSelectedCue();
          break;
        case 'set-cue-start':
          trimSelectedCueToPlayhead('start');
          break;
        case 'set-cue-end':
          trimSelectedCueToPlayhead('end');
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

    // Main swaps the Edit menu between native editing roles and app commands
    // on this; see buildEditMenu in main/application-menu.ts. Sent only on a
    // change, since each report rebuilds the native menu.
    let editable = false;
    const reportFocus = (next: boolean) => {
      if (next === editable) return;
      editable = next;
      void api.setEditableFocus(next);
    };
    // focusin names the element gaining focus, focusout the one receiving it
    // (relatedTarget); reading either avoids a false blip between two fields.
    const handleFocusIn = (event: FocusEvent) => reportFocus(isEditableTarget(event.target));
    const handleFocusOut = (event: FocusEvent) => reportFocus(isEditableTarget(event.relatedTarget));
    reportFocus(isEditableTarget(document.activeElement));
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      unsubscribeCommand();
      unsubscribeOpen();
    };
  }, []);
}

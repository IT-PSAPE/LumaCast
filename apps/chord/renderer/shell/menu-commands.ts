// Subscribes once (mounted by `App.tsx`) to main's two push channels and
// dispatches every native menu command to the store or to a dialog. Renders
// nothing — it's the same event either way whether the user clicked a top
// bar control or used the menu bar/a shortcut, so both paths land here or in
// `top-bar.tsx`'s own handlers, never duplicated.
import { useEffect } from 'react';
import { useToast } from '@lumacast/ui';
import { getApi } from '../api';
import { useChordStore } from '../store';
import { deleteSelectedCues, duplicateSelectedCue, isEditableTarget, trimSelectedCueToPlayhead } from '../features/timeline';
import { importAudio, importBackground, importLyrics } from './media-import';
import { openCueFormatChooser, openExportDialog } from './shell-ui-state';
import type { DocumentNavigationCommands } from './document-navigation';

export function useMenuCommands(navigation: DocumentNavigationCommands): void {
  const { toast } = useToast();
  useEffect(() => {
    const api = getApi();
    let mounted = true;

    const unsubscribeCommand = api.onMenuCommand((command) => {
      const store = useChordStore.getState();
      switch (command) {
        case 'new':
          void navigation.newDocument();
          break;
        case 'open':
          void navigation.openDocument();
          break;
        case 'save':
          void navigation.saveDocument(false);
          break;
        case 'save-as':
          void navigation.saveDocument(true);
          break;
        case 'close':
          void navigation.closeDocument();
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

    const unsubscribeOpen = api.onOpenProjectRequest((path) => {
      void navigation.openDocument(path);
    });
    void api.documentNavigationReady().catch(() => {
      if (mounted) toast({ description: 'Could not finish closing the previous session. Close the window to retry.', tone: 'error' });
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
      mounted = false;
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      unsubscribeCommand();
      unsubscribeOpen();
    };
  }, [navigation, toast]);
}

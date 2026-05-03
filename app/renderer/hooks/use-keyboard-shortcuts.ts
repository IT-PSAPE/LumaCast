import { useEffect } from 'react';
import { SHORTCUTS, type ShortcutActionId } from '@core/shortcuts';
import type { SlideBrowserMode, PlaylistBrowserMode } from '../types/ui';
import { CANVAS_VIEW_LABELS, PLAYLIST_DISPLAY_MODE_LABELS } from '../utils/slides';
import { useCast } from '../contexts/app-context';
import { useSlides } from '../contexts/slide-context';
import { useElements } from '../contexts/canvas/canvas-context';
import { useDeckBrowser } from '../features/deck/deck-browser-context';
import { useCommandPalette } from '../features/command-palette/command-palette-context';
import { useWorkbench } from '../contexts/workbench-context';
import { matchesShortcut } from './use-keyboard-shortcuts-match';
import { handleEditableTextShortcut } from '../utils/editable-text-shortcuts';

function isEditableTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  return target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.getAttribute('contenteditable') === 'true';
}

// Only block shortcuts when the target is a text-editing surface or has been
// explicitly opted out (data-shortcuts-scope="ignore"). Buttons and other
// interactive controls do NOT block — otherwise pressing Backspace right after
// clicking a slide/element button would hit the focused button and skip the
// delete shortcut entirely.
function isInteractiveTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (isEditableTarget(target)) return true;
  return target.closest('[data-shortcuts-scope="ignore"]') !== null;
}

export function useKeyboardShortcuts(): void {
  const { setStatusText, undo: globalUndoAction, redo: globalRedoAction } = useCast();
  const { open: openCommandPalette } = useCommandPalette();
  const { slides, currentSlide, currentSlideIndex, isOutputArmedOnCurrent, activateSlide, takeSlide, goNext, goPrev, deleteSlide, setCurrentSlideIndex } = useSlides();
  const { selectedElementId, clearSelection, deleteSelected, nudgeSelection, copySelection, cutSelection, pasteSelection, duplicateSelection, undo, redo } = useElements();
  const { setSlideBrowserMode, setPlaylistBrowserMode } = useDeckBrowser();
  const { state: { workbenchMode } } = useWorkbench();
  const isEditSlideBrowser = workbenchMode === 'deck-editor' || workbenchMode === 'overlay-editor' || workbenchMode === 'theme-editor' || workbenchMode === 'stage-editor';

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (isEditableTarget(target)) {
        handleEditableTextShortcut(event, target, {
          readText: () => window.castApi.readClipboardText(),
          writeText: (text) => window.castApi.writeClipboardText(text),
        });
        return;
      }
      if (isInteractiveTarget(target)) return;

      const handlers: Record<ShortcutActionId, (event: KeyboardEvent, payload?: string) => void> = {
        copySelection: () => copySelection(),
        cutSelection: () => { void cutSelection(); },
        pasteSelection: () => { void pasteSelection(); },
        duplicateSelection: () => { void duplicateSelection(); },
        undo: () => { void undo(); },
        redo: () => { void redo(); },
        globalUndo: () => { void globalUndoAction(); },
        globalRedo: () => { void globalRedoAction(); },
        openCommandPalette: () => openCommandPalette(),
        setPlaylistBrowserMode: (_event, digit) => {
          const modes: PlaylistBrowserMode[] = ['current', 'tabs', 'continuous'];
          const next = modes[Number(digit) - 1];
          setPlaylistBrowserMode(next);
          setStatusText(`Playlist view: ${PLAYLIST_DISPLAY_MODE_LABELS[next]}`);
        },
        setSlideBrowserMode: (_event, digit) => {
          const modes: SlideBrowserMode[] = ['grid', 'list'];
          const next = modes[Number(digit) - 1];
          setSlideBrowserMode(next);
          setStatusText(`View: ${CANVAS_VIEW_LABELS[next]}`);
        },
        takeSlide: () => takeSlide(),
        deleteSelected: () => {
          if (selectedElementId) void deleteSelected();
          else if (currentSlide) void deleteSlide(currentSlide.id);
        },
        clearSelection: () => clearSelection(),
        nudgeOrGoNext: (e) => {
          if (isEditSlideBrowser) {
            if (selectedElementId) void nudgeSelection(e.shiftKey ? 10 : 1, 0);
            return;
          }
          if (isOutputArmedOnCurrent) goNext();
          else setCurrentSlideIndex(currentSlideIndex + 1);
        },
        nudgeOrGoPrev: (e) => {
          if (isEditSlideBrowser) {
            if (selectedElementId) void nudgeSelection(e.shiftKey ? -10 : -1, 0);
            return;
          }
          if (isOutputArmedOnCurrent) goPrev();
          else setCurrentSlideIndex(currentSlideIndex - 1);
        },
        nudgeUp: (e) => { void nudgeSelection(0, e.shiftKey ? -10 : -1); },
        nudgeDown: (e) => { void nudgeSelection(0, e.shiftKey ? 10 : 1); },
        activateSlide: (_event, digit) => {
          const jumpTo = Number(digit) - 1;
          if (jumpTo < slides.length) activateSlide(jumpTo);
        },
      };

      for (const def of SHORTCUTS) {
        if (def.context === 'editSlideBrowser' && !isEditSlideBrowser) continue;
        if (def.context === 'editWithSelection' && !(isEditSlideBrowser && selectedElementId)) continue;
        const match = matchesShortcut(event, def);
        if (!match) continue;
        event.preventDefault();
        handlers[def.id](event, typeof match === 'string' ? match : undefined);
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isEditSlideBrowser, slides.length, selectedElementId, currentSlide, currentSlideIndex, isOutputArmedOnCurrent, activateSlide, takeSlide, goNext, goPrev, setCurrentSlideIndex, clearSelection, deleteSelected, deleteSlide, setSlideBrowserMode, setPlaylistBrowserMode, setStatusText, nudgeSelection, copySelection, cutSelection, pasteSelection, duplicateSelection, undo, redo, globalUndoAction, globalRedoAction, openCommandPalette]);
}

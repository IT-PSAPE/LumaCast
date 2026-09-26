import { useEffect } from 'react';
import { SHORTCUTS, matchesShortcut, menuCommandForEvent, menuCommandClaimRegistry, type ShortcutActionId } from '@lumacast/commands';
import { useCast } from '../contexts/app-context';
import { useSlides } from '../contexts/slide-context';
import { useElements } from '../contexts/canvas/canvas-context';
import { useDeckBrowser } from '../features/items/deck-browser-context';
import { useCommandPalette } from '../features/command-palette/command-palette-context';
import { useWorkbench } from '../contexts/workbench-context';

function isEditableTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  if (target.isContentEditable) return true;
  return target.closest<HTMLElement>('[contenteditable="true"]') !== null;
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
  const { slides, currentSlide, activateSlide, takeSlide, goNext, goPrev, deleteSlide } = useSlides();
  const { selectedElementId, clearSelection, deleteSelected, nudgeSelection, copySelection, cutSelection, pasteSelection, duplicateSelection, groupSelection, ungroupSelection, undo, redo } = useElements();
  const { setSlideBrowserMode } = useDeckBrowser();
  const { state: { workbenchMode }, overlayStack } = useWorkbench();
  const isEditSlideBrowser = workbenchMode === 'item-editor' || workbenchMode === 'overlay-editor' || workbenchMode === 'theme-editor' || workbenchMode === 'stage-editor';
  const isShowMode = workbenchMode === 'show';

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // A component that already consumed this key owns it. Overlays listen on
      // `document`, which runs before this `window` listener, so without this
      // guard Escape would close the topmost dialog *and* clear the canvas
      // selection behind it from the same keypress.
      if (event.defaultPrevented) {
        // Even then a modal overlay can leave the native menu able to fire an
        // app command underneath it (macOS accelerators cannot be
        // unregistered), so neutralize the parallel menu command too.
        if (overlayStack.stack.length > 0) {
          const menuCommand = menuCommandForEvent(event);
          if (menuCommand) menuCommandClaimRegistry.claim(menuCommand);
        }
        return;
      }

      const target = event.target as HTMLElement | null;

      // Editable surfaces, scope-ignored regions, and open modal overlays are
      // out of scope for the app-level dispatcher. The browser owns editing
      // chords in editable fields (rich-text copy, caret paste, per-field undo
      // history), so we never preventDefault or mirror the clipboard through
      // IPC here. We do claim the parallel native-menu command so the
      // duplicate macOS menu IPC is dropped instead of falling through to a
      // canvas/app action underneath.
      if (isInteractiveTarget(target) || overlayStack.stack.length > 0) {
        const menuCommand = menuCommandForEvent(event);
        if (menuCommand) menuCommandClaimRegistry.claim(menuCommand);
        return;
      }

      const handlers: Record<ShortcutActionId, (event: KeyboardEvent, payload?: string) => boolean> = {
        copySelection: () => { copySelection(); return true; },
        cutSelection: () => { void cutSelection().catch(() => undefined); return true; },
        pasteSelection: () => { void pasteSelection().catch(() => undefined); return true; },
        duplicateSelection: () => { void duplicateSelection().catch(() => undefined); return true; },
        groupSelection: () => { void groupSelection().catch(() => undefined); return true; },
        ungroupSelection: () => { void ungroupSelection().catch(() => undefined); return true; },
        undo: () => { void undo().catch(() => undefined); return true; },
        redo: () => { void redo().catch(() => undefined); return true; },
        globalUndo: () => { void globalUndoAction().catch(() => undefined); return true; },
        globalRedo: () => { void globalRedoAction().catch(() => undefined); return true; },
        openCommandPalette: () => { openCommandPalette(); return true; },
        setSlideBrowserMode: (_event, digit) => {
          switch (digit) {
            case '1':
              setSlideBrowserMode('grid');
              setStatusText('View: Grid');
              return true;
            case '2':
              setSlideBrowserMode('list');
              setStatusText('View: List');
              return true;
            default:
              return false;
          }
        },
        takeSlide: () => { takeSlide(); return true; },
        deleteSelected: () => {
          if (isEditSlideBrowser && selectedElementId) { void deleteSelected().catch(() => undefined); return true; }
          if (currentSlide && (isEditSlideBrowser || isShowMode)) { void deleteSlide(currentSlide.id).catch(() => undefined); return true; }
          return false;
        },
        clearSelection: () => { clearSelection(); return true; },
        nudgeOrGoNext: (e) => {
          if (isEditSlideBrowser) {
            // nudgeSelection → updateElementsBatch rejects when an element no
            // longer exists (#214); mutatePatch has already reported the
            // failure, so absorb the rethrow here.
            if (selectedElementId) { void nudgeSelection(e.shiftKey ? 10 : 1, 0).catch(() => undefined); return true; }
            return false;
          }
          // goNext already decides armed-advance vs browse-only — the menu
          // command (use-app-menu.ts) shares the same decision by calling the
          // same context method.
          goNext();
          return true;
        },
        nudgeOrGoPrev: (e) => {
          if (isEditSlideBrowser) {
            // See nudgeOrGoNext: same race, same absorption.
            if (selectedElementId) { void nudgeSelection(e.shiftKey ? -10 : -1, 0).catch(() => undefined); return true; }
            return false;
          }
          goPrev();
          return true;
        },
        nudgeUp: (e) => { void nudgeSelection(0, e.shiftKey ? -10 : -1).catch(() => undefined); return true; },
        nudgeDown: (e) => { void nudgeSelection(0, e.shiftKey ? 10 : 1).catch(() => undefined); return true; },
        activateSlide: (_event, digit) => {
          const jumpTo = Number(digit) - 1;
          if (jumpTo < slides.length) { activateSlide(jumpTo); return true; }
          return false;
        },
      };

      for (const def of SHORTCUTS) {
        if (def.context === 'editSlideBrowser' && !isEditSlideBrowser) continue;
        if (def.context === 'editWithSelection' && !(isEditSlideBrowser && selectedElementId)) continue;
        const match = matchesShortcut(event, def);
        if (!match) continue;
        const acted = handlers[def.id](event, typeof match === 'string' ? match : undefined);
        if (acted) {
          menuCommandClaimRegistry.claimForShortcut(def.id);
          event.preventDefault();
          return;
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isEditSlideBrowser, isShowMode, workbenchMode, overlayStack, slides.length, selectedElementId, currentSlide, activateSlide, takeSlide, goNext, goPrev, clearSelection, deleteSelected, deleteSlide, setSlideBrowserMode, setStatusText, nudgeSelection, copySelection, cutSelection, pasteSelection, duplicateSelection, groupSelection, ungroupSelection, undo, redo, globalUndoAction, globalRedoAction, openCommandPalette]);
}

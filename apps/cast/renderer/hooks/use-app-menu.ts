import { useCallback, useEffect, useMemo, useState } from 'react';
import { type AppMenuCommandId, type AppMenuState } from '@lumacast/commands';
import {
  consumeLiveMenuClaim,
  getMenuEditableTarget,
  isMenuScopeIgnored,
  isReadOnlyEditableTarget,
  noteMenuCommandKeydown,
  pasteClipboardTextIntoEditable,
  tryNativeEditCommand,
} from '../utils/menu-editable';
import { useCast, useNdi } from '../contexts/app-context';
import { useElements } from '../contexts/canvas/canvas-context';
import { useNavigation } from '../contexts/navigation-context';
import { useProjectContent } from '../contexts/use-project-content';
import { useSlides } from '../contexts/slide-context';
import { useWorkbench } from '../contexts/workbench-context';
import { hasClipboardContent } from '../contexts/element/use-element-history';
import { useCommandPalette } from '../features/command-palette/command-palette-context';
import { useDeckBrowser } from '../features/items/deck-browser-context';

function hasEditableFocus(): boolean {
  return getMenuEditableTarget(document.activeElement as HTMLElement | null) !== null;
}

export function useAppMenu(): void {
  // A boolean, not a change counter. This hook sits at the shell root, so
  // every state it sets re-renders the whole app; focus moves usually land
  // on the same answer and React bails out. The counter it replaces
  // re-rendered everything on each focusin/focusout/selectionchange/mouseup
  // — one full app render per keystroke — which is what made Settings crawl
  // once a 400-model catalog was on screen.
  const [isEditableTargetFocused, setEditableTargetFocused] = useState(hasEditableFocus);
  const cast = useCast();
  const ndi = useNdi();
  const navigation = useNavigation();
  const slides = useSlides();
  const elements = useElements();
  const workbench = useWorkbench();
  const deckBrowser = useDeckBrowser();
  const { presentations, lyrics } = useProjectContent();
  const { open: openCommandPalette } = useCommandPalette();

  const overlayOpen = workbench.overlayStack.stack.length > 0;
  const isEditWorkbench = workbench.state.workbenchMode === 'item-editor'
    || workbench.state.workbenchMode === 'overlay-editor'
    || workbench.state.workbenchMode === 'theme-editor'
    || workbench.state.workbenchMode === 'stage-editor';
  const isShowWorkbench = workbench.state.workbenchMode === 'show';
  const hasElementSelection = elements.selectedElementIds.length > 0;
  const itemCount = presentations.length + lyrics.length;

  const menuState = useMemo<AppMenuState>(() => ({
    workbenchMode: workbench.state.workbenchMode,
    slideBrowserMode: deckBrowser.slideBrowserMode,
    hasCurrentPlaylist: navigation.currentPlaylistId !== null,
    hasCurrentItem: navigation.currentItem !== null,
    hasCurrentSlide: slides.currentSlide !== null,
    hasMultipleSlides: slides.slides.length > 1,
    hasEditableSelection: hasElementSelection,
    canUndo: cast.canUndo || (isEditWorkbench && hasElementSelection) || isEditableTargetFocused,
    canRedo: cast.canRedo || isEditableTargetFocused,
    canCut: isEditableTargetFocused || (isEditWorkbench && hasElementSelection),
    // Always allow Copy: Electron disables menu accelerators when this is
    // false, so gating it on focus would suppress Cmd+C for plain DOM text
    // selections (e.g. selecting text in a panel label). The handler decides
    // what to copy at fire time.
    canCopy: true,
    canPaste: isEditableTargetFocused || (isEditWorkbench && hasClipboardContent()),
    // Flips the Edit menu to native roles while typing; see AppMenuState.
    hasEditableFocus: isEditableTargetFocused,
    canDuplicate: isEditWorkbench && hasElementSelection,
    canDelete: isEditableTargetFocused
      || (isEditWorkbench && hasElementSelection)
      || ((isEditWorkbench || isShowWorkbench) && slides.currentSlide !== null),
    canClearSelection: isEditWorkbench && hasElementSelection,
    canTakeSlide: slides.currentSlide !== null,
    canGoToPreviousSlide: slides.currentSlideIndex > 0,
    canGoToNextSlide: slides.currentSlideIndex >= 0 && slides.currentSlideIndex < slides.slides.length - 1,
    canExportWorkspace: itemCount > 0,
    audienceOutputEnabled: ndi.state.outputState.audience,
    stageOutputEnabled: ndi.state.outputState.stage,
  }), [
    cast.canRedo,
    cast.canUndo,
    deckBrowser.slideBrowserMode,
    itemCount,
    hasElementSelection,
    isEditWorkbench,
    isEditableTargetFocused,
    navigation.currentItem,
    navigation.currentPlaylistId,
    ndi.state.outputState.audience,
    ndi.state.outputState.stage,
    slides.currentSlide,
    slides.currentSlideIndex,
    slides.slides.length,
    workbench.state.workbenchMode,
  ]);

  // Only focus moves can change which element is active; the menu state
  // reads nothing from the text selection (Copy is always enabled and decides
  // what to copy at fire time), so selectionchange/mouseup are not observed.
  useEffect(() => {
    const refresh = () => { setEditableTargetFocused(hasEditableFocus()); };
    document.addEventListener('focusin', refresh);
    document.addEventListener('focusout', refresh);
    return () => {
      document.removeEventListener('focusin', refresh);
      document.removeEventListener('focusout', refresh);
    };
  }, []);

  useEffect(() => {
    void window.castApi.updateAppMenuState(menuState);
  }, [menuState]);

  const exportCurrentItem = useCallback(async () => {
    if (!navigation.currentItemRef || !navigation.currentItem) return;
    const filePath = await window.castApi.chooseBundleExportPath(navigation.currentItem.title);
    if (!filePath) return;
    const result = await window.castApi.exportBundle([navigation.currentItemRef.id], filePath);
    cast.setStatusText(`Exported ${result.itemCount} item${result.itemCount === 1 ? '' : 's'}.`);
  }, [cast, navigation.currentItem, navigation.currentItemRef]);

  const exportWorkspace = useCallback(async () => {
    if (itemCount === 0) return;
    const filePath = await window.castApi.chooseBundleExportPath('cast-workspace');
    if (!filePath) return;
    const allItemIds = [...presentations, ...lyrics].map((item) => item.id);
    const result = await window.castApi.exportBundle(
      allItemIds,
      filePath,
      { includeAllThemes: true, includeOverlays: true, includeStages: true },
    );
    cast.setStatusText(`Exported ${result.itemCount} item${result.itemCount === 1 ? '' : 's'} plus workspace assets.`);
  }, [cast, itemCount, lyrics, presentations]);

  const handleMenuCommand = useCallback(async (commandId: AppMenuCommandId) => {
    // Drops the duplicate menu IPC that follows a keyboard chord the
    // shortcut hook already handled. Stale claims (no matching recent
    // keydown) are ignored so an explicit mouse click is never swallowed.
    if (consumeLiveMenuClaim(commandId)) return;
    // Fire-time focus snapshot: a focused editable field owns its edit
    // commands even when the native execCommand reports failure, and an
    // open modal overlay or scope-ignored region owns everything except
    // text edits on text fields. File/settings/view commands are never
    // blocked here.
    const activeElement = document.activeElement as HTMLElement | null;
    const editableTarget = getMenuEditableTarget(activeElement);
    const outOfScope = isMenuScopeIgnored(activeElement) || overlayOpen;
    switch (commandId) {
      case 'file.newPresentation':
        await navigation.createPresentation();
        return;
      case 'file.newLyric':
        await navigation.createEmptyLyric();
        return;
      case 'file.newPlaylist':
        await navigation.createPlaylist();
        return;
      case 'file.newSeparator':
        await navigation.createSeparator();
        return;
      case 'file.newSlide':
        await slides.createSlide();
        return;
      case 'file.exportCurrentItem':
        await exportCurrentItem();
        return;
      case 'file.exportWorkspace':
        await exportWorkspace();
        return;
      case 'app.openSettings':
      case 'view.mode.settings':
        workbench.actions.setWorkbenchMode('settings');
        return;
      case 'app.checkForUpdates':
        await window.castApi.checkForAppUpdates(true);
        return;
      case 'edit.undo':
        // An editable target owns undo even when native execCommand fails:
        // falling through would replay global history behind the field's
        // own undo stack. A modal/scope region without an editable target
        // swallows the command so nothing underneath is undone.
        if (editableTarget) {
          if (!isReadOnlyEditableTarget(editableTarget)) tryNativeEditCommand('undo');
          return;
        }
        if (outOfScope) return;
        if (isEditWorkbench) {
          // elements.undo → applySnapshot → updateElementsBatch rejects when an
          // element no longer exists (#214), which an undo can race with a
          // concurrent delete. mutatePatch has already reported the failure, so
          // absorb the rethrow here.
          await elements.undo().catch(() => undefined);
          return;
        }
        await cast.undo();
        return;
      case 'edit.redo':
        if (editableTarget) {
          if (!isReadOnlyEditableTarget(editableTarget)) tryNativeEditCommand('redo');
          return;
        }
        if (outOfScope) return;
        if (isEditWorkbench) {
          // See edit.undo above: same race, same absorption.
          await elements.redo().catch(() => undefined);
          return;
        }
        await cast.redo();
        return;
      case 'edit.cut':
        if (editableTarget) {
          if (!isReadOnlyEditableTarget(editableTarget)) tryNativeEditCommand('cut');
          return;
        }
        if (outOfScope) return;
        await elements.cutSelection();
        return;
      case 'edit.copy':
        // Copy is broader than the other edit commands: a plain DOM
        // selection (e.g. selecting label text in a panel) is copyable even
        // when nothing editable has focus. Run execCommand directly so that
        // selection gets copied; when it reports nothing copied, an
        // editable target or an out-of-scope region still owns the command
        // and only the plain canvas case falls through to element copy.
        if (tryNativeEditCommand('copy')) return;
        if (editableTarget || outOfScope) return;
        elements.copySelection();
        return;
      case 'edit.paste':
        // Editable paste never reaches canvas state: native paste first,
        // then the async clipboard-read/insert fallback (a no-op on
        // read-only fields and on clipboard errors or focus changes).
        if (editableTarget) {
          await pasteClipboardTextIntoEditable(editableTarget);
          return;
        }
        if (outOfScope) return;
        await elements.pasteSelection();
        return;
      case 'edit.duplicate':
        // Duplicate has no text-field meaning; a focused field or an
        // out-of-scope region blocks the canvas duplicate underneath.
        if (editableTarget || outOfScope) return;
        await elements.duplicateSelection();
        return;
      case 'edit.delete':
        // Like undo: an editable target owns delete even when native
        // execCommand fails, so canvas/slide deletion never fires while
        // typing. Read-only fields swallow the command untouched.
        if (editableTarget) {
          if (!isReadOnlyEditableTarget(editableTarget)) tryNativeEditCommand('delete');
          return;
        }
        if (outOfScope) return;
        if (elements.selectedElementId) {
          await elements.deleteSelected();
          return;
        }
        if (slides.currentSlide) {
          await slides.deleteSlide(slides.currentSlide.id);
        }
        return;
      case 'edit.clearSelection':
        if (outOfScope) return;
        elements.clearSelection();
        return;
      case 'view.openCommandPalette':
        openCommandPalette();
        return;
      case 'view.mode.show':
        workbench.actions.setWorkbenchMode('show');
        return;
      case 'view.mode.deckEditor':
        workbench.actions.setWorkbenchMode('item-editor');
        return;
      case 'view.mode.overlayEditor':
        workbench.actions.setWorkbenchMode('overlay-editor');
        return;
      case 'view.mode.themeEditor':
        workbench.actions.setWorkbenchMode('theme-editor');
        return;
      case 'view.mode.stageEditor':
        workbench.actions.setWorkbenchMode('stage-editor');
        return;
      case 'view.mode.macroEditor':
        workbench.actions.setWorkbenchMode('macro-editor');
        return;
      case 'view.slideBrowser.grid':
        deckBrowser.setSlideBrowserMode('grid');
        return;
      case 'view.slideBrowser.list':
        deckBrowser.setSlideBrowserMode('list');
        return;
      case 'playback.takeSlide':
        // Playback commands fire underneath modal overlays and
        // scope-ignored regions via native accelerators; swallow them
        // there. A merely focused text field does not block an explicit
        // playback click.
        if (outOfScope) return;
        slides.takeSlide();
        return;
      case 'playback.previousSlide':
        if (outOfScope) return;
        slides.goPrev();
        return;
      case 'playback.nextSlide':
        if (outOfScope) return;
        slides.goNext();
        return;
      case 'playback.toggleAudienceOutput':
        if (outOfScope) return;
        ndi.actions.toggleAudienceOutput();
        return;
      case 'playback.toggleStageOutput':
        if (outOfScope) return;
        ndi.actions.toggleStageOutput();
        return;
    }
  }, [cast, deckBrowser, elements, exportCurrentItem, exportWorkspace, isEditWorkbench, navigation, ndi.actions, openCommandPalette, overlayOpen, slides, workbench.actions]);

  // Records menu-chord keydowns so consumeLiveMenuClaim can tell a genuine
  // menu echo (milliseconds after its keydown) from a stale claim that must
  // not swallow an explicit mouse click. Capture phase so overlay-consumed
  // keys are still observed.
  useEffect(() => {
    window.addEventListener('keydown', noteMenuCommandKeydown, true);
    return () => window.removeEventListener('keydown', noteMenuCommandKeydown, true);
  }, []);

  useEffect(() => {
    return window.castApi.onAppMenuCommand((commandId) => {
      void handleMenuCommand(commandId);
    });
  }, [handleMenuCommand]);
}

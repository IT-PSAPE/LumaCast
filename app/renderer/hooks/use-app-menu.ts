import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppMenuCommandId, AppMenuState } from '@core/ipc';
import { useCast, useNdi } from '../contexts/app-context';
import { useElements } from '../contexts/canvas/canvas-context';
import { useNavigation } from '../contexts/navigation-context';
import { useProjectContent } from '../contexts/use-project-content';
import { useSlides } from '../contexts/slide-context';
import { useWorkbench } from '../contexts/workbench-context';
import { hasClipboardContent } from '../contexts/element/use-element-history';
import { useCommandPalette } from '../features/command-palette/command-palette-context';
import { useDeckBrowser } from '../features/deck/deck-browser-context';

function getEditableTarget(target: HTMLElement | null): HTMLElement | null {
  if (!target) return null;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return target;
  if (target.isContentEditable) return target;
  return target.closest<HTMLElement>('[contenteditable="true"]');
}

function execEditableCommand(command: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'delete'): boolean {
  const target = getEditableTarget(document.activeElement as HTMLElement | null);
  if (!target) return false;
  return document.execCommand(command);
}

export function useAppMenu(): void {
  const [editableVersion, setEditableVersion] = useState(0);
  const cast = useCast();
  const ndi = useNdi();
  const navigation = useNavigation();
  const slides = useSlides();
  const elements = useElements();
  const workbench = useWorkbench();
  const deckBrowser = useDeckBrowser();
  const { deckItems } = useProjectContent();
  const { open: openCommandPalette } = useCommandPalette();

  const isEditableTargetFocused = Boolean(getEditableTarget(document.activeElement as HTMLElement | null));
  const isEditWorkbench = workbench.state.workbenchMode === 'deck-editor'
    || workbench.state.workbenchMode === 'overlay-editor'
    || workbench.state.workbenchMode === 'theme-editor'
    || workbench.state.workbenchMode === 'stage-editor';
  const hasElementSelection = elements.selectedElementIds.length > 0;

  const menuState = useMemo<AppMenuState>(() => ({
    workbenchMode: workbench.state.workbenchMode,
    slideBrowserMode: deckBrowser.slideBrowserMode,
    playlistBrowserMode: deckBrowser.playlistBrowserMode,
    hasCurrentLibrary: navigation.currentLibraryId !== null,
    hasCurrentPlaylist: navigation.currentPlaylistId !== null,
    hasCurrentDeckItem: navigation.currentDeckItem !== null,
    hasCurrentSlide: slides.currentSlide !== null,
    hasMultipleSlides: slides.slides.length > 1,
    hasEditableSelection: hasElementSelection,
    canUndo: cast.canUndo || (isEditWorkbench && hasElementSelection) || isEditableTargetFocused,
    canRedo: cast.canRedo || isEditableTargetFocused,
    canCut: isEditableTargetFocused || (isEditWorkbench && hasElementSelection),
    canCopy: isEditableTargetFocused || (isEditWorkbench && hasElementSelection),
    canPaste: isEditableTargetFocused || (isEditWorkbench && hasClipboardContent()),
    canDuplicate: isEditWorkbench && hasElementSelection,
    canDelete: isEditableTargetFocused || (isEditWorkbench && (hasElementSelection || slides.currentSlide !== null)),
    canClearSelection: isEditWorkbench && hasElementSelection,
    canTakeSlide: slides.currentSlide !== null,
    canGoToPreviousSlide: slides.currentSlideIndex > 0,
    canGoToNextSlide: slides.currentSlideIndex >= 0 && slides.currentSlideIndex < slides.slides.length - 1,
    canExportWorkspace: deckItems.length > 0,
    audienceOutputEnabled: ndi.state.outputState.audience,
    stageOutputEnabled: ndi.state.outputState.stage,
  }), [
    cast.canRedo,
    cast.canUndo,
    deckBrowser.playlistBrowserMode,
    deckBrowser.slideBrowserMode,
    deckItems.length,
    editableVersion,
    hasElementSelection,
    isEditWorkbench,
    isEditableTargetFocused,
    navigation.currentDeckItem,
    navigation.currentLibraryId,
    navigation.currentPlaylistId,
    ndi.state.outputState.audience,
    ndi.state.outputState.stage,
    slides.currentSlide,
    slides.currentSlideIndex,
    slides.slides.length,
    workbench.state.workbenchMode,
  ]);

  useEffect(() => {
    const refresh = () => { setEditableVersion((current) => current + 1); };
    document.addEventListener('focusin', refresh);
    document.addEventListener('focusout', refresh);
    document.addEventListener('selectionchange', refresh);
    window.addEventListener('mouseup', refresh);
    return () => {
      document.removeEventListener('focusin', refresh);
      document.removeEventListener('focusout', refresh);
      document.removeEventListener('selectionchange', refresh);
      window.removeEventListener('mouseup', refresh);
    };
  }, []);

  useEffect(() => {
    void window.castApi.updateAppMenuState(menuState);
  }, [menuState]);

  const exportCurrentItem = useCallback(async () => {
    if (!navigation.currentDeckItem) return;
    const filePath = await window.castApi.chooseDeckBundleExportPath(navigation.currentDeckItem.title);
    if (!filePath) return;
    const result = await window.castApi.exportDeckBundle([navigation.currentDeckItem.id], filePath);
    cast.setStatusText(`Exported ${result.itemCount} item${result.itemCount === 1 ? '' : 's'}.`);
  }, [cast, navigation.currentDeckItem]);

  const exportWorkspace = useCallback(async () => {
    if (deckItems.length === 0) return;
    const filePath = await window.castApi.chooseDeckBundleExportPath('cast-workspace');
    if (!filePath) return;
    const result = await window.castApi.exportDeckBundle(
      deckItems.map((item) => item.id),
      filePath,
      { includeAllThemes: true, includeOverlays: true, includeStages: true },
    );
    cast.setStatusText(`Exported ${result.itemCount} item${result.itemCount === 1 ? '' : 's'} plus workspace assets.`);
  }, [cast, deckItems]);

  const handleMenuCommand = useCallback(async (commandId: AppMenuCommandId) => {
    switch (commandId) {
      case 'file.newPresentation':
        await navigation.createPresentation();
        return;
      case 'file.newLyric':
        await navigation.createEmptyLyric();
        return;
      case 'file.newLibrary':
        await navigation.createLibrary();
        return;
      case 'file.newPlaylist':
        await navigation.createPlaylist();
        return;
      case 'file.newSegment':
        await navigation.createSegment();
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
        if (execEditableCommand('undo')) return;
        if (isEditWorkbench) {
          await elements.undo();
          return;
        }
        await cast.undo();
        return;
      case 'edit.redo':
        if (execEditableCommand('redo')) return;
        if (isEditWorkbench) {
          await elements.redo();
          return;
        }
        await cast.redo();
        return;
      case 'edit.cut':
        if (execEditableCommand('cut')) return;
        await elements.cutSelection();
        return;
      case 'edit.copy':
        if (execEditableCommand('copy')) return;
        elements.copySelection();
        return;
      case 'edit.paste':
        if (execEditableCommand('paste')) return;
        await elements.pasteSelection();
        return;
      case 'edit.duplicate':
        await elements.duplicateSelection();
        return;
      case 'edit.delete':
        if (execEditableCommand('delete')) return;
        if (elements.selectedElementId) {
          await elements.deleteSelected();
          return;
        }
        if (slides.currentSlide) {
          await slides.deleteSlide(slides.currentSlide.id);
        }
        return;
      case 'edit.clearSelection':
        elements.clearSelection();
        return;
      case 'view.openCommandPalette':
        openCommandPalette();
        return;
      case 'view.mode.show':
        workbench.actions.setWorkbenchMode('show');
        return;
      case 'view.mode.deckEditor':
        workbench.actions.setWorkbenchMode('deck-editor');
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
      case 'view.slideBrowser.grid':
        deckBrowser.setSlideBrowserMode('grid');
        return;
      case 'view.slideBrowser.list':
        deckBrowser.setSlideBrowserMode('list');
        return;
      case 'view.playlistBrowser.current':
        deckBrowser.setPlaylistBrowserMode('current');
        return;
      case 'view.playlistBrowser.tabs':
        deckBrowser.setPlaylistBrowserMode('tabs');
        return;
      case 'view.playlistBrowser.continuous':
        deckBrowser.setPlaylistBrowserMode('continuous');
        return;
      case 'playback.takeSlide':
        slides.takeSlide();
        return;
      case 'playback.previousSlide':
        slides.goPrev();
        return;
      case 'playback.nextSlide':
        slides.goNext();
        return;
      case 'playback.toggleAudienceOutput':
        ndi.actions.toggleAudienceOutput();
        return;
      case 'playback.toggleStageOutput':
        ndi.actions.toggleStageOutput();
        return;
    }
  }, [cast, deckBrowser, elements, exportCurrentItem, exportWorkspace, isEditWorkbench, navigation, ndi.actions, openCommandPalette, slides, workbench.actions]);

  useEffect(() => {
    return window.castApi.onAppMenuCommand((commandId) => {
      void handleMenuCommand(commandId);
    });
  }, [handleMenuCommand]);
}

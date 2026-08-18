// The app-menu command vocabulary: every command id the native application
// menu (built in app/main/application-menu.ts) can send to the renderer, and
// the renderer-computed state (enable/disable + mode flags) that drives how
// that menu is built. Moved out of app/core/ipc.ts (issue #219, wave W3) so
// the command vocabulary lives with the rest of the commands package rather
// than the IPC contract module; `APP_MENU_EVENTS`/`AppMenuEventPayloads`
// stay in app/core/ipc.ts since those describe the event/subscription
// channel shape, not the command vocabulary itself.
export type AppMenuCommandId =
  | 'file.newPresentation'
  | 'file.newLyric'
  | 'file.newPlaylist'
  | 'file.newSeparator'
  | 'file.newSlide'
  | 'file.exportCurrentItem'
  | 'file.exportWorkspace'
  | 'app.openSettings'
  | 'app.checkForUpdates'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.cut'
  | 'edit.copy'
  | 'edit.paste'
  | 'edit.duplicate'
  | 'edit.delete'
  | 'edit.clearSelection'
  | 'view.openCommandPalette'
  | 'view.mode.show'
  | 'view.mode.deckEditor'
  | 'view.mode.overlayEditor'
  | 'view.mode.themeEditor'
  | 'view.mode.stageEditor'
  | 'view.mode.macroEditor'
  | 'view.mode.settings'
  | 'view.slideBrowser.grid'
  | 'view.slideBrowser.list'
  | 'view.playlistBrowser.current'
  | 'view.playlistBrowser.tabs'
  | 'view.playlistBrowser.continuous'
  | 'playback.takeSlide'
  | 'playback.previousSlide'
  | 'playback.nextSlide'
  | 'playback.toggleAudienceOutput'
  | 'playback.toggleStageOutput';

export interface AppMenuState {
  workbenchMode: 'show' | 'item-editor' | 'overlay-editor' | 'theme-editor' | 'stage-editor' | 'macro-editor' | 'settings';
  slideBrowserMode: 'grid' | 'list';
  playlistBrowserMode: 'current' | 'tabs' | 'continuous';
  hasCurrentPlaylist: boolean;
  hasCurrentItem: boolean;
  hasCurrentSlide: boolean;
  hasMultipleSlides: boolean;
  hasEditableSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
  canDuplicate: boolean;
  canDelete: boolean;
  canClearSelection: boolean;
  canTakeSlide: boolean;
  canGoToPreviousSlide: boolean;
  canGoToNextSlide: boolean;
  canExportWorkspace: boolean;
  audienceOutputEnabled: boolean;
  stageOutputEnabled: boolean;
}

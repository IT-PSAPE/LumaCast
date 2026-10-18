import type { AppMenuContext } from '../../chrome/app-menu';
import type { DockId, WorkbenchLayout } from '../../workbench-layout';
import { DOCK_LABELS, visibleDocks } from '../../workbench-layout';
import type { SceneCollectionSummary, StreamProject, StreamProfileSummary, StreamSource } from '../../../shared/desktop-api';
import type { StreamPlatform } from '../../../shared/platform-capabilities';

export interface UseAppMenuParams {
  platform: StreamPlatform;
  /** Null until the workspace has loaded; menus then render with studio mode off. */
  project: StreamProject | null;
  multiviewWindowOpen: boolean;
  undoAvailable: boolean;
  redoAvailable: boolean;
  selectedSource: StreamSource | null;
  sourceClipboardAvailable: boolean;
  workbenchLayout: WorkbenchLayout;
  collections: SceneCollectionSummary[];
  activeCollectionId: string | null;
  profiles: StreamProfileSummary[];
  activeProfileId: string | null;

  openSettings: () => void;
  importCollectionFromFile: () => Promise<void>;
  exportActiveCollection: () => Promise<void>;
  showRecordingsFolder: () => void;
  remuxRecording: () => Promise<void>;
  undoSceneEdit: () => void;
  redoSceneEdit: () => void;
  copySelectedSource: () => void;
  pasteSource: () => Promise<void>;
  removeSelectedSource: () => void;
  fitSource: (source: StreamSource) => void;
  stretchSource: (source: StreamSource) => void;
  centerSource: (source: StreamSource) => void;
  resetSourceTransform: (source: StreamSource) => void;
  toggleStudioMode: () => void;
  toggleMultiviewWindow: () => void;
  openProjector: (kind: 'preview' | 'program') => void;
  toggleDock: (id: DockId) => void;
  resetUi: () => void;
  activateCollection: (id: string) => Promise<void>;
  openCollectionDialog: (kind: 'new' | 'duplicate' | 'rename' | 'delete') => void;
  activateProfile: (id: string) => Promise<void>;
  openProfileDialog: (kind: 'new' | 'duplicate' | 'rename' | 'delete') => void;
  importProfileFromFile: () => Promise<void>;
  exportActiveProfile: () => Promise<void>;
  setAboutDialogOpen: (open: boolean) => void;
  setShortcutsDialogOpen: (open: boolean) => void;
}

/**
 * Builds the `AppMenuContext` (state + `AppMenuActions`) consumed by
 * `chrome/app-menu.ts`'s `buildAppMenus` and rendered by `TitleBar`. Pure
 * state/action aggregation, no JSX — this is the seam a later native-macOS-menu
 * integration (`Menu.setApplicationMenu`) will read from instead of `TitleBar`.
 */
export function useAppMenu(params: UseAppMenuParams): AppMenuContext {
  const {
    platform, project, multiviewWindowOpen, undoAvailable, redoAvailable, selectedSource, sourceClipboardAvailable,
    workbenchLayout, collections, activeCollectionId, profiles, activeProfileId,
    openSettings, importCollectionFromFile, exportActiveCollection, showRecordingsFolder, remuxRecording,
    undoSceneEdit, redoSceneEdit, copySelectedSource, pasteSource, removeSelectedSource,
    fitSource, stretchSource, centerSource, resetSourceTransform, toggleStudioMode, toggleMultiviewWindow, openProjector,
    toggleDock, resetUi, activateCollection, openCollectionDialog, activateProfile, openProfileDialog,
    importProfileFromFile, exportActiveProfile, setAboutDialogOpen, setShortcutsDialogOpen,
  } = params;

  const visibleDockIds = visibleDocks(workbenchLayout);

  return {
    platform,
    studioMode: project?.studioMode ?? false,
    multiviewOpen: multiviewWindowOpen,
    undoAvailable,
    redoAvailable,
    sourceSelected: selectedSource !== null,
    clipboardAvailable: sourceClipboardAvailable,
    docks: workbenchLayout.dockOrder.map((id) => ({ id, label: DOCK_LABELS[id], visible: visibleDockIds.includes(id) })),
    collections: collections.map((collection) => ({ id: collection.id, name: collection.name })),
    activeCollectionId,
    profiles: profiles.map((profile) => ({ id: profile.id, name: profile.name })),
    activeProfileId,
    actions: {
      openSettings: () => openSettings(),
      quit: () => window.close(),
      importCollection: () => void importCollectionFromFile(),
      exportCollection: () => void exportActiveCollection(),
      showRecordings: showRecordingsFolder,
      remux: () => void remuxRecording(),
      undo: undoSceneEdit,
      redo: redoSceneEdit,
      copySource: copySelectedSource,
      pasteSource: () => void pasteSource(),
      deleteSource: removeSelectedSource,
      fitSource: () => { if (selectedSource) fitSource(selectedSource); },
      stretchSource: () => { if (selectedSource) stretchSource(selectedSource); },
      centerSource: () => { if (selectedSource) centerSource(selectedSource); },
      resetTransform: () => { if (selectedSource) resetSourceTransform(selectedSource); },
      toggleStudioMode,
      openMultiview: toggleMultiviewWindow,
      openPreviewProjector: () => openProjector('preview'),
      openProgramProjector: () => openProjector('program'),
      toggleDock: (id) => toggleDock(id as DockId),
      resetUi,
      activateCollection: (id) => void activateCollection(id),
      newCollection: () => openCollectionDialog('new'),
      duplicateCollection: () => openCollectionDialog('duplicate'),
      renameCollection: () => openCollectionDialog('rename'),
      deleteCollection: () => openCollectionDialog('delete'),
      activateProfile: (id) => void activateProfile(id),
      newProfile: () => openProfileDialog('new'),
      duplicateProfile: () => openProfileDialog('duplicate'),
      renameProfile: () => openProfileDialog('rename'),
      deleteProfile: () => openProfileDialog('delete'),
      importProfile: () => void importProfileFromFile(),
      exportProfile: () => void exportActiveProfile(),
      about: () => setAboutDialogOpen(true),
      shortcuts: () => setShortcutsDialogOpen(true),
    },
  };
}

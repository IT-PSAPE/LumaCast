// The complete set of IPC channel names, in one place, so the preload bridge
// and the main-process handlers cannot drift apart: every channel the renderer
// can `invoke` appears exactly once here, and main registers a handler for
// each of them. The two push channels are main-to-renderer only and are
// deliberately not in the invoked set.
export const IPC_CHANNELS = {
  newProject: 'project-new',
  openProject: 'project-open',
  saveProject: 'project-save',
  recentProjects: 'project-recent',
  setDocumentState: 'project-document-state',
  importMedia: 'media-import',
  admitFiles: 'media-admit',
  mediaUrl: 'media-url',
  readCueFile: 'cues-read',
  exportCues: 'cues-export',
  chooseExportPath: 'export-choose-path',
  exportOpen: 'export-open',
  exportWrite: 'export-write',
  exportClose: 'export-close',
  exportAbort: 'export-abort',
  revealPath: 'reveal-path',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** Pushed when the application menu (or a shortcut) issues a command. */
export const MENU_COMMAND_CHANNEL = 'menu-command';
/** Pushed when the OS asks the app to open a project file. */
export const OPEN_DOCUMENT_CHANNEL = 'open-document';

/** Channels the renderer invokes, in the order main registers them. */
export const INVOKED_CHANNELS: readonly IpcChannel[] = Object.values(IPC_CHANNELS);

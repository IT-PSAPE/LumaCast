// The LumaChord renderer's entire privileged surface, and the only module
// both processes depend on. It is a contract boundary, not code: no Electron,
// no Node builtins, and no main-process module may be named here, so the same
// shape is importable from main (which implements it over IPC) and from the
// renderer (which consumes `window.lumachord`).
//
// The renderer owns the document, playback, rendering, and the export
// encoder; main owns dialogs, the filesystem, the media scheme, menus, and
// the export file sink.
import type { ProjectDocument, ChordProject, RecentProject } from './project';

export type ImportKind = 'audio' | 'image' | 'video' | 'cues';

/** A file main has admitted: only admitted paths resolve on the media scheme. */
export interface ImportedFile {
  kind: ImportKind;
  path: string;
  name: string;
  /** `lumachord://file/<encoded path>`; null for cue files (read as text). */
  url: string | null;
  sizeBytes: number;
}

export type CueFileFormat = 'csv' | 'lrc' | 'srt';

export type MenuCommand =
  | 'new'
  | 'open'
  | 'save'
  | 'save-as'
  | 'import-audio'
  | 'import-cues'
  | 'import-background'
  | 'export'
  | 'export-cues'
  | 'undo'
  | 'redo'
  | 'play-pause'
  | 'add-cue'
  | 'split-cue'
  | 'delete-selection'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-fit';

export interface ExportSink {
  id: string;
  path: string;
}

export interface ChordDesktopAPI {
  // Documents
  newProject: () => Promise<ProjectDocument>;
  /** Shows the open dialog when `path` is omitted; null when cancelled. */
  openProject: (path?: string) => Promise<ProjectDocument | null>;
  /** Save-as dialog when the document has no path or `saveAs` is set; null when cancelled. */
  saveProject: (document: ProjectDocument, options?: { saveAs?: boolean }) => Promise<string | null>;
  recentProjects: () => Promise<RecentProject[]>;
  /** Drives the window title and the close prompt. */
  setDocumentState: (state: { title: string; path: string | null; dirty: boolean }) => Promise<void>;

  // Media
  importMedia: (kind: ImportKind) => Promise<ImportedFile | null>;
  /** Admits files dropped on the window; unsupported types are skipped. */
  admitFiles: (paths: string[]) => Promise<ImportedFile[]>;
  /** Resolves dropped File objects to paths (preload, via webUtils). */
  pathsForFiles: (files: File[]) => string[];
  /** Re-admits a project's media after open so its scheme URLs resolve. */
  mediaUrl: (path: string) => Promise<string | null>;
  readCueFile: (path: string) => Promise<string>;

  // Cue files
  exportCues: (text: string, format: CueFileFormat, suggestedName: string) => Promise<string | null>;

  // Export sink: the renderer encodes; main writes chunks at byte offsets.
  chooseExportPath: (suggestedName: string, extension: string) => Promise<string | null>;
  exportOpen: (path: string) => Promise<ExportSink>;
  exportWrite: (sinkId: string, position: number, bytes: Uint8Array) => Promise<void>;
  exportClose: (sinkId: string) => Promise<void>;
  /** Deletes the partial file. */
  exportAbort: (sinkId: string) => Promise<void>;
  revealPath: (path: string) => Promise<void>;

  // Push channels
  onMenuCommand: (callback: (command: MenuCommand) => void) => () => void;
  onOpenDocument: (callback: (document: ProjectDocument) => void) => () => void;
}

declare global {
  interface Window {
    lumachord?: ChordDesktopAPI;
  }
}

export type { ChordProject };

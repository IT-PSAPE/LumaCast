// The LumaChord IPC surface. `createIpcHandlers` is a pure function over
// narrow collaborator interfaces (no Electron import reachable from it) so
// argument validation and delegation are unit-testable under plain
// Node/vitest; `registerIpc` is the thin binding to real `ipcMain`, with the
// sender/mainFrame validation from apps/flux/main/index.ts and
// apps/cloud/main/ipc.ts.
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { createEmptyProject, parseProjectFile } from '../shared/project-schema';
import type {
  CueFileFormat,
  ExportSink,
  ImportedFile,
  ImportKind,
  MenuCommand,
} from '../shared/desktop-api';
import type { ChordProject, ProjectDocument, RecentProject } from '../shared/project';
import { buildMediaUrl, kindForPath } from './media-scheme';
import {
  IPC_CHANNELS,
  INVOKED_CHANNELS,
  MENU_COMMAND_CHANNEL,
  OPEN_DOCUMENT_CHANNEL,
  type IpcChannel,
} from './ipc-channels';

/** ~10 MB: generous for a lyric cue sheet, small enough that a giant file
 *  cannot be used to exhaust renderer memory via readCueFile. */
export const MAX_CUE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PATH_LENGTH = 4096;

// ---- Collaborator interfaces --------------------------------------------
// Narrow shapes rather than the concrete classes: a fake satisfying these
// needs no Electron/fs runtime, which is what lets ipc.test.ts exercise
// createIpcHandlers directly. The concrete implementations
// (MediaAdmissions, RecentProjectsStore, ExportSinkRegistry) already match
// these shapes structurally, so main/index.ts passes the instances straight
// through with no wrapper.

export interface IpcMediaAdmissions {
  admit(path: string, kind: ImportKind): Promise<ImportedFile>;
  isAdmitted(path: string): boolean;
}

export interface IpcRecentProjects {
  list(): Promise<RecentProject[]>;
  push(entry: RecentProject): Promise<RecentProject[]>;
}

export interface IpcExportSinks {
  open(path: string): Promise<ExportSink>;
  write(id: string, position: number, bytes: Uint8Array): Promise<void>;
  close(id: string): Promise<void>;
  abort(id: string): Promise<void>;
}

export interface IpcProjectStore {
  read(path: string): Promise<ProjectDocument>;
  write(path: string, project: ChordProject): Promise<void>;
}

export interface IpcDialogs {
  showOpenProjectDialog(): Promise<string | null>;
  showSaveProjectDialog(suggestedName: string): Promise<string | null>;
  showOpenMediaDialog(kind: ImportKind): Promise<string | null>;
  showSaveCueDialog(suggestedName: string, format: CueFileFormat): Promise<string | null>;
  showSaveExportDialog(suggestedName: string, extension: string): Promise<string | null>;
}

export interface IpcWindowControl {
  setTitle(title: string): void;
  /** macOS-only affordance; a no-op implementation elsewhere is fine. */
  setDocumentEdited(edited: boolean): void;
}

export interface IpcShellEffects {
  showItemInFolder(path: string): void;
}

export interface IpcClock {
  now(): string;
  createId(): string;
}

/** Tracks whether the open document has unsaved changes, shared between the
 *  setDocumentState handler (which sets it) and main/index.ts's window
 *  `close` handler (which reads it to decide whether to prompt). */
export class DocumentDirtyTracker {
  private dirty = false;

  set(value: boolean): void {
    this.dirty = value;
  }

  get(): boolean {
    return this.dirty;
  }
}

export interface IpcTextFiles {
  readTextFileWithLimit(path: string, maxBytes: number): Promise<string>;
  writeTextFile(path: string, text: string): Promise<void>;
}

export interface IpcDeps {
  dialogs: IpcDialogs;
  windowControl: IpcWindowControl;
  shellEffects: IpcShellEffects;
  projectStore: IpcProjectStore;
  recentProjects: IpcRecentProjects;
  admissions: IpcMediaAdmissions;
  exportSinks: IpcExportSinks;
  clock: IpcClock;
  dirty: Pick<DocumentDirtyTracker, 'set'>;
  textFiles: IpcTextFiles;
}

export type IpcHandlerMap = Record<IpcChannel, (...args: unknown[]) => unknown>;

// ---- Validation schemas ---------------------------------------------------

const pathSchema = z.string().min(1).max(MAX_PATH_LENGTH);
const pathListSchema = z.array(pathSchema).max(256);
const importKindSchema = z.enum(['audio', 'image', 'video', 'cues']) satisfies z.ZodType<ImportKind>;
const cueFormatSchema = z.enum(['csv', 'lrc', 'srt']) satisfies z.ZodType<CueFileFormat>;
const extensionSchema = z.string().min(1).max(16);
const sinkIdSchema = z.string().min(1).max(128);
const positionSchema = z.number().int().min(0);
const bytesSchema = z.instanceof(Uint8Array);
const cueTextSchema = z.string().max(MAX_CUE_FILE_BYTES);
const saveOptionsSchema = z.object({ saveAs: z.boolean().optional() }).optional();
const documentStateSchema = z.object({
  title: z.string().max(500),
  path: pathSchema.nullable(),
  dirty: z.boolean(),
});

// `project` is validated by round-tripping through the shared project
// schema's own `parseProjectFile` (JSON in, JSON out) rather than duplicating
// its shape here: it is the single source of truth for what a valid
// ChordProject looks like, and reusing it means an in-memory document the
// renderer hands back to save is held to exactly the same rules as one read
// off disk.
const projectDocumentEnvelopeSchema = z.object({
  project: z.unknown(),
  path: pathSchema.nullable(),
});

function parseProjectDocumentArg(value: unknown): ProjectDocument {
  const envelope = projectDocumentEnvelopeSchema.parse(value);
  let serialized: string;
  try {
    serialized = JSON.stringify(envelope.project);
  } catch {
    throw new Error('Project document is not serializable');
  }
  const project = parseProjectFile(serialized);
  return { project, path: envelope.path };
}

/**
 * Admits a just-opened project's audio and (image/video) background paths so
 * their `lumachord://` URLs resolve immediately. Failures are swallowed: a
 * project whose media has since moved or been deleted must still open — the
 * renderer sees a null `mediaUrl` for that asset rather than a failed open.
 */
export async function admitProjectMedia(admissions: IpcMediaAdmissions, project: ChordProject): Promise<void> {
  if (project.audio) {
    await admissions.admit(project.audio.path, 'audio').catch(() => {});
  }
  if (project.background.kind === 'image' || project.background.kind === 'video') {
    await admissions.admit(project.background.media.path, project.background.kind).catch(() => {});
  }
}

export function createIpcHandlers(deps: IpcDeps): IpcHandlerMap {
  // Export destinations are revealable once chosen or opened, in addition to
  // admitted media paths — revealPath's contract is "admitted or export
  // paths only". Tracked here (not in ExportSinkRegistry) because a path is
  // revealable as soon as it's chosen, even before exportOpen is called.
  const revealableExportPaths = new Set<string>();

  const recentEntryFor = (path: string, project: ChordProject): RecentProject => ({
    path,
    title: project.title,
    openedAt: deps.clock.now(),
  });

  return {
    [IPC_CHANNELS.newProject]: async (): Promise<ProjectDocument> => {
      const project = createEmptyProject(deps.clock.now(), deps.clock.createId());
      return { project, path: null };
    },

    [IPC_CHANNELS.openProject]: async (pathArg?: unknown): Promise<ProjectDocument | null> => {
      const requestedPath = pathArg === undefined ? undefined : pathSchema.parse(pathArg);
      const path = requestedPath ?? (await deps.dialogs.showOpenProjectDialog());
      if (!path) return null;

      const document = await deps.projectStore.read(path);
      await admitProjectMedia(deps.admissions, document.project);
      await deps.recentProjects.push(recentEntryFor(path, document.project));
      return document;
    },

    [IPC_CHANNELS.saveProject]: async (documentArg: unknown, optionsArg?: unknown): Promise<string | null> => {
      const document = parseProjectDocumentArg(documentArg);
      const options = saveOptionsSchema.parse(optionsArg);

      let path = document.path;
      if (!path || options?.saveAs) {
        const chosen = await deps.dialogs.showSaveProjectDialog(document.project.title || 'Untitled');
        if (!chosen) return null;
        path = chosen;
      }

      await deps.projectStore.write(path, document.project);
      await deps.recentProjects.push(recentEntryFor(path, document.project));
      return path;
    },

    [IPC_CHANNELS.recentProjects]: async (): Promise<RecentProject[]> => deps.recentProjects.list(),

    [IPC_CHANNELS.setDocumentState]: async (stateArg: unknown): Promise<void> => {
      const state = documentStateSchema.parse(stateArg);
      const bullet = state.dirty ? '• ' : '';
      deps.windowControl.setTitle(`${bullet}${state.title} — LumaChord`);
      deps.windowControl.setDocumentEdited(state.dirty);
      deps.dirty.set(state.dirty);
    },

    [IPC_CHANNELS.importMedia]: async (kindArg: unknown): Promise<ImportedFile | null> => {
      const kind = importKindSchema.parse(kindArg);
      const path = await deps.dialogs.showOpenMediaDialog(kind);
      if (!path) return null;
      // The background picker offers images and videos together, so the
      // admitted kind follows the chosen file, not the requested one.
      return deps.admissions.admit(path, kindForPath(path) ?? kind);
    },

    [IPC_CHANNELS.admitFiles]: async (pathsArg: unknown): Promise<ImportedFile[]> => {
      const paths = pathListSchema.parse(pathsArg);
      const admitted: ImportedFile[] = [];
      for (const candidate of paths) {
        const kind = kindForPath(candidate);
        if (!kind) continue; // Unsupported extensions are skipped, per ChordDesktopAPI.admitFiles.
        try {
          admitted.push(await deps.admissions.admit(candidate, kind));
        } catch {
          // Admission failed (missing file, oversized, …); skip rather than
          // fail the whole batch a drag-drop may have included by mistake.
        }
      }
      return admitted;
    },

    [IPC_CHANNELS.mediaUrl]: async (pathArg: unknown): Promise<string | null> => {
      const path = pathSchema.parse(pathArg);
      if (!deps.admissions.isAdmitted(path)) return null;
      return buildMediaUrl(path);
    },

    [IPC_CHANNELS.readCueFile]: async (pathArg: unknown): Promise<string> => {
      const path = pathSchema.parse(pathArg);
      if (!deps.admissions.isAdmitted(path)) {
        throw new Error(`Refusing to read an unadmitted file: ${path}`);
      }
      return deps.textFiles.readTextFileWithLimit(path, MAX_CUE_FILE_BYTES);
    },

    [IPC_CHANNELS.exportCues]: async (
      textArg: unknown,
      formatArg: unknown,
      suggestedNameArg: unknown,
    ): Promise<string | null> => {
      const text = cueTextSchema.parse(textArg);
      const format = cueFormatSchema.parse(formatArg);
      const suggestedName = pathSchema.parse(suggestedNameArg);

      const path = await deps.dialogs.showSaveCueDialog(suggestedName, format);
      if (!path) return null;
      await deps.textFiles.writeTextFile(path, text);
      return path;
    },

    [IPC_CHANNELS.chooseExportPath]: async (
      suggestedNameArg: unknown,
      extensionArg: unknown,
    ): Promise<string | null> => {
      const suggestedName = pathSchema.parse(suggestedNameArg);
      const extension = extensionSchema.parse(extensionArg);
      const path = await deps.dialogs.showSaveExportDialog(suggestedName, extension);
      if (path) revealableExportPaths.add(path);
      return path;
    },

    [IPC_CHANNELS.exportOpen]: async (pathArg: unknown): Promise<ExportSink> => {
      const path = pathSchema.parse(pathArg);
      const sink = await deps.exportSinks.open(path);
      revealableExportPaths.add(sink.path);
      return sink;
    },

    [IPC_CHANNELS.exportWrite]: async (idArg: unknown, positionArg: unknown, bytesArg: unknown): Promise<void> => {
      const id = sinkIdSchema.parse(idArg);
      const position = positionSchema.parse(positionArg);
      const bytes = bytesSchema.parse(bytesArg);
      await deps.exportSinks.write(id, position, bytes);
    },

    [IPC_CHANNELS.exportClose]: async (idArg: unknown): Promise<void> => {
      await deps.exportSinks.close(sinkIdSchema.parse(idArg));
    },

    [IPC_CHANNELS.exportAbort]: async (idArg: unknown): Promise<void> => {
      await deps.exportSinks.abort(sinkIdSchema.parse(idArg));
    },

    [IPC_CHANNELS.revealPath]: async (pathArg: unknown): Promise<void> => {
      const path = pathSchema.parse(pathArg);
      if (!deps.admissions.isAdmitted(path) && !revealableExportPaths.has(path)) {
        throw new Error(`Refusing to reveal an unrecognized path: ${path}`);
      }
      deps.shellEffects.showItemInFolder(path);
    },
  };
}

export interface RegisterIpcOptions {
  handlers: IpcHandlerMap;
  getWindow: () => BrowserWindow | null;
}

/**
 * Binds `createIpcHandlers`'s pure map to real `ipcMain.handle`. Every
 * privileged channel is reachable only from this app's own window and its
 * main frame — mirroring apps/flux/main/index.ts's `handle` wrapper and
 * apps/cloud/main/ipc.ts's `registerIpc` — so a devtools extension, an
 * embedded frame, or a second renderer cannot invoke them.
 */
export function registerIpc(options: RegisterIpcOptions): void {
  const { handlers, getWindow } = options;

  for (const channel of INVOKED_CHANNELS) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const window = getWindow();
      if (event.sender !== window?.webContents || event.senderFrame !== window?.webContents.mainFrame) {
        throw new Error('Invalid IPC sender');
      }
      return handlers[channel](...args);
    });
  }
}

/** Pushes a MenuCommand to the renderer; a no-op if the window is gone. */
export function sendMenuCommand(window: BrowserWindow | null, command: MenuCommand): void {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(MENU_COMMAND_CHANNEL, command);
}

/** Pushes an opened document to the renderer (OS file-open, Open Recent). */
export function sendOpenDocument(window: BrowserWindow | null, document: ProjectDocument): void {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(OPEN_DOCUMENT_CHANNEL, document);
}

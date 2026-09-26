import { describe, expect, it, vi } from 'vitest';

// ipc.ts imports `ipcMain` from 'electron' at module scope for `registerIpc`
// (not exercised here); `createIpcHandlers` never calls it, but the import
// still has to resolve to *something* under plain Node/vitest.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import {
  DocumentDirtyTracker,
  admitProjectMedia,
  createIpcHandlers,
  MAX_CUE_FILE_BYTES,
  type IpcDeps,
} from '../../../../apps/chord/main/ipc';
import { IPC_CHANNELS } from '../../../../apps/chord/main/ipc-channels';
import { buildMediaUrl } from '../../../../apps/chord/main/media-scheme';
import { createEmptyProject } from '../../../../apps/chord/shared/project-schema';
import type {
  ChordBackground,
  ChordProject,
  ChordMediaRef,
  RecentProject,
} from '../../../../apps/chord/shared/project';
import type { ExportSink, ImportedFile, ImportKind } from '../../../../apps/chord/shared/desktop-api';

function fakeAdmittedFile(filePath: string, kind: ImportKind): ImportedFile {
  return {
    kind,
    path: filePath,
    name: filePath.split('/').pop() ?? filePath,
    url: kind === 'cues' ? null : buildMediaUrl(filePath),
    sizeBytes: 10,
  };
}

type DepsOverrides = { [K in keyof IpcDeps]?: Partial<IpcDeps[K]> };

function makeDeps(overrides: DepsOverrides = {}): IpcDeps {
  return {
    dialogs: {
      showOpenProjectDialog: vi.fn(async () => null),
      showSaveProjectDialog: vi.fn(async () => null),
      showOpenMediaDialog: vi.fn(async () => null),
      showSaveCueDialog: vi.fn(async () => null),
      showSaveExportDialog: vi.fn(async () => null),
      ...overrides.dialogs,
    },
    windowControl: {
      setTitle: vi.fn(),
      setDocumentEdited: vi.fn(),
      ...overrides.windowControl,
    },
    shellEffects: {
      showItemInFolder: vi.fn(),
      ...overrides.shellEffects,
    },
    projectStore: {
      read: vi.fn(async (p: string) => ({ project: createEmptyProject('2026-01-01T00:00:00.000Z', 'id-1'), path: p })),
      write: vi.fn(async () => {}),
      ...overrides.projectStore,
    },
    recentProjects: {
      list: vi.fn(async () => []),
      push: vi.fn(async (entry: RecentProject) => [entry]),
      ...overrides.recentProjects,
    },
    admissions: {
      admit: vi.fn(async (p: string, kind: ImportKind) => fakeAdmittedFile(p, kind)),
      isAdmitted: vi.fn(() => false),
      ...overrides.admissions,
    },
    exportSinks: {
      open: vi.fn(async (p: string): Promise<ExportSink> => ({ id: 'sink-1', path: p })),
      write: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
      ...overrides.exportSinks,
    },
    clock: {
      now: vi.fn(() => '2026-01-01T00:00:00.000Z'),
      createId: vi.fn(() => 'new-id'),
      ...overrides.clock,
    },
    dirty: { set: vi.fn(), ...overrides.dirty },
    textFiles: {
      readTextFileWithLimit: vi.fn(async () => 'file text'),
      writeTextFile: vi.fn(async () => {}),
      ...overrides.textFiles,
    },
  };
}

function project(overrides: Partial<ChordProject> = {}): ChordProject {
  return { ...createEmptyProject('2026-01-01T00:00:00.000Z', 'id-1'), ...overrides };
}

describe('apps/chord createIpcHandlers: newProject / openProject', () => {
  it('newProject builds an empty project with a fresh id and timestamp', async () => {
    const deps = makeDeps();
    const handlers = createIpcHandlers(deps);

    const document = await handlers[IPC_CHANNELS.newProject]();

    expect(document).toEqual({ project: createEmptyProject('2026-01-01T00:00:00.000Z', 'new-id'), path: null });
  });

  it('openProject uses the given path without showing a dialog', async () => {
    const deps = makeDeps();
    const handlers = createIpcHandlers(deps);

    const document = await handlers[IPC_CHANNELS.openProject]('/tmp/song.lumachord');

    expect(deps.dialogs.showOpenProjectDialog).not.toHaveBeenCalled();
    expect(deps.projectStore.read).toHaveBeenCalledWith('/tmp/song.lumachord');
    expect(document).not.toBeNull();
    expect(deps.recentProjects.push).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/tmp/song.lumachord' }),
    );
  });

  it('openProject shows a dialog when no path is given, and returns null when cancelled', async () => {
    const deps = makeDeps({ dialogs: { showOpenProjectDialog: vi.fn(async () => null) } });
    const handlers = createIpcHandlers(deps);

    const document = await handlers[IPC_CHANNELS.openProject]();

    expect(deps.dialogs.showOpenProjectDialog).toHaveBeenCalledOnce();
    expect(document).toBeNull();
    expect(deps.projectStore.read).not.toHaveBeenCalled();
  });

  it('openProject admits the project media it opened', async () => {
    const withMedia = project({
      audio: { path: '/music/song.mp3', name: 'song.mp3', durationMs: 1000 },
      background: {
        kind: 'image',
        media: { path: '/img/bg.png', name: 'bg.png', durationMs: null },
        fit: 'cover',
        dim: 0,
        blur: 0,
        loop: false,
      },
    });
    const deps = makeDeps({
      projectStore: { read: vi.fn(async (p: string) => ({ project: withMedia, path: p })) },
    });
    const handlers = createIpcHandlers(deps);

    await handlers[IPC_CHANNELS.openProject]('/tmp/song.lumachord');

    expect(deps.admissions.admit).toHaveBeenCalledWith('/music/song.mp3', 'audio');
    expect(deps.admissions.admit).toHaveBeenCalledWith('/img/bg.png', 'image');
  });

  it('rejects a non-string path', async () => {
    const deps = makeDeps();
    const handlers = createIpcHandlers(deps);
    await expect(handlers[IPC_CHANNELS.openProject](42)).rejects.toThrow();
  });
});

describe('apps/chord createIpcHandlers: saveProject', () => {
  it('writes directly when the document already has a path', async () => {
    const deps = makeDeps();
    const handlers = createIpcHandlers(deps);
    const doc = { project: project(), path: '/tmp/song.lumachord' };

    const result = await handlers[IPC_CHANNELS.saveProject](doc);

    expect(deps.dialogs.showSaveProjectDialog).not.toHaveBeenCalled();
    expect(deps.projectStore.write).toHaveBeenCalledWith('/tmp/song.lumachord', expect.any(Object));
    expect(result).toBe('/tmp/song.lumachord');
    expect(deps.recentProjects.push).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/tmp/song.lumachord' }),
    );
  });

  it('shows a save dialog when the document has no path', async () => {
    const deps = makeDeps({
      dialogs: { showSaveProjectDialog: vi.fn(async () => '/tmp/chosen.lumachord') },
    });
    const handlers = createIpcHandlers(deps);
    const doc = { project: project(), path: null };

    const result = await handlers[IPC_CHANNELS.saveProject](doc);

    expect(deps.dialogs.showSaveProjectDialog).toHaveBeenCalledOnce();
    expect(deps.projectStore.write).toHaveBeenCalledWith('/tmp/chosen.lumachord', expect.any(Object));
    expect(result).toBe('/tmp/chosen.lumachord');
  });

  it('forces the save dialog when saveAs is set, even with an existing path', async () => {
    const deps = makeDeps({
      dialogs: { showSaveProjectDialog: vi.fn(async () => '/tmp/renamed.lumachord') },
    });
    const handlers = createIpcHandlers(deps);
    const doc = { project: project(), path: '/tmp/song.lumachord' };

    const result = await handlers[IPC_CHANNELS.saveProject](doc, { saveAs: true });

    expect(deps.dialogs.showSaveProjectDialog).toHaveBeenCalledOnce();
    expect(result).toBe('/tmp/renamed.lumachord');
  });

  it('returns null and does not write when the save dialog is cancelled', async () => {
    const deps = makeDeps();
    const handlers = createIpcHandlers(deps);
    const doc = { project: project(), path: null };

    const result = await handlers[IPC_CHANNELS.saveProject](doc);

    expect(result).toBeNull();
    expect(deps.projectStore.write).not.toHaveBeenCalled();
  });

  it('rejects a document whose project does not match the project schema', async () => {
    const deps = makeDeps();
    const handlers = createIpcHandlers(deps);

    await expect(
      handlers[IPC_CHANNELS.saveProject]({ project: { not: 'a project' }, path: '/tmp/x.lumachord' }),
    ).rejects.toThrow();
    expect(deps.projectStore.write).not.toHaveBeenCalled();
  });

  it('rejects a malformed envelope (missing path field)', async () => {
    const deps = makeDeps();
    const handlers = createIpcHandlers(deps);
    await expect(handlers[IPC_CHANNELS.saveProject]({ project: project() })).rejects.toThrow();
  });
});

describe('apps/chord createIpcHandlers: recentProjects / setDocumentState', () => {
  it('recentProjects delegates to the store', async () => {
    const list = [{ path: '/a', title: 'A', openedAt: '2026-01-01T00:00:00.000Z' }];
    const deps = makeDeps({ recentProjects: { list: vi.fn(async () => list) } });
    const handlers = createIpcHandlers(deps);

    await expect(handlers[IPC_CHANNELS.recentProjects]()).resolves.toEqual(list);
  });

  it('setDocumentState sets a plain title with no bullet when clean', async () => {
    const deps = makeDeps();
    const handlers = createIpcHandlers(deps);

    await handlers[IPC_CHANNELS.setDocumentState]({ title: 'My Song', path: '/tmp/x.lumachord', dirty: false });

    expect(deps.windowControl.setTitle).toHaveBeenCalledWith('My Song — LumaChord');
    expect(deps.windowControl.setDocumentEdited).toHaveBeenCalledWith(false);
    expect(deps.dirty.set).toHaveBeenCalledWith(false);
  });

  it('setDocumentState prefixes a bullet when dirty', async () => {
    const deps = makeDeps();
    const handlers = createIpcHandlers(deps);

    await handlers[IPC_CHANNELS.setDocumentState]({ title: 'My Song', path: null, dirty: true });

    expect(deps.windowControl.setTitle).toHaveBeenCalledWith('• My Song — LumaChord');
    expect(deps.windowControl.setDocumentEdited).toHaveBeenCalledWith(true);
    expect(deps.dirty.set).toHaveBeenCalledWith(true);
  });

  it('rejects a malformed document-state payload', async () => {
    const deps = makeDeps();
    const handlers = createIpcHandlers(deps);
    await expect(handlers[IPC_CHANNELS.setDocumentState]({ title: 'x' })).rejects.toThrow();
  });
});

describe('apps/chord createIpcHandlers: media', () => {
  it('importMedia opens a kind-filtered dialog then admits the chosen path', async () => {
    const deps = makeDeps({ dialogs: { showOpenMediaDialog: vi.fn(async () => '/music/song.mp3') } });
    const handlers = createIpcHandlers(deps);

    const result = await handlers[IPC_CHANNELS.importMedia]('audio');

    expect(deps.dialogs.showOpenMediaDialog).toHaveBeenCalledWith('audio');
    expect(deps.admissions.admit).toHaveBeenCalledWith('/music/song.mp3', 'audio');
    expect(result).toEqual(fakeAdmittedFile('/music/song.mp3', 'audio'));
  });

  it('importMedia returns null when the dialog is cancelled', async () => {
    const deps = makeDeps();
    const handlers = createIpcHandlers(deps);
    await expect(handlers[IPC_CHANNELS.importMedia]('image')).resolves.toBeNull();
    expect(deps.admissions.admit).not.toHaveBeenCalled();
  });

  it('importMedia rejects an unknown kind', async () => {
    const deps = makeDeps();
    const handlers = createIpcHandlers(deps);
    await expect(handlers[IPC_CHANNELS.importMedia]('not-a-kind')).rejects.toThrow();
  });

  it('admitFiles skips unsupported extensions and admits the rest', async () => {
    const deps = makeDeps();
    const handlers = createIpcHandlers(deps);

    const result = await handlers[IPC_CHANNELS.admitFiles]([
      '/music/song.mp3',
      '/random/file.exe',
      '/images/bg.png',
    ]);

    expect(deps.admissions.admit).toHaveBeenCalledWith('/music/song.mp3', 'audio');
    expect(deps.admissions.admit).toHaveBeenCalledWith('/images/bg.png', 'image');
    expect(deps.admissions.admit).not.toHaveBeenCalledWith('/random/file.exe', expect.anything());
    expect(result).toEqual([
      fakeAdmittedFile('/music/song.mp3', 'audio'),
      fakeAdmittedFile('/images/bg.png', 'image'),
    ]);
  });

  it('admitFiles skips a file whose admission throws (missing/oversized) rather than failing the batch', async () => {
    const deps = makeDeps({
      admissions: {
        admit: vi.fn(async (p: string, kind: ImportKind) => {
          if (p === '/music/bad.mp3') throw new Error('File does not exist');
          return fakeAdmittedFile(p, kind);
        }),
        isAdmitted: vi.fn(() => false),
      },
    });
    const handlers = createIpcHandlers(deps);

    const result = await handlers[IPC_CHANNELS.admitFiles](['/music/bad.mp3', '/music/good.mp3']);

    expect(result).toEqual([fakeAdmittedFile('/music/good.mp3', 'audio')]);
  });

  it('mediaUrl returns a scheme URL only for an admitted path', async () => {
    const deps = makeDeps({ admissions: { isAdmitted: vi.fn((p: string) => p === '/music/song.mp3') } });
    const handlers = createIpcHandlers(deps);

    await expect(handlers[IPC_CHANNELS.mediaUrl]('/music/song.mp3')).resolves.toBe(buildMediaUrl('/music/song.mp3'));
    await expect(handlers[IPC_CHANNELS.mediaUrl]('/music/other.mp3')).resolves.toBeNull();
  });

  it('readCueFile refuses an unadmitted path without touching the filesystem', async () => {
    const deps = makeDeps();
    const handlers = createIpcHandlers(deps);

    await expect(handlers[IPC_CHANNELS.readCueFile]('/lyrics.lrc')).rejects.toThrow(/unadmitted/);
    expect(deps.textFiles.readTextFileWithLimit).not.toHaveBeenCalled();
  });

  it('readCueFile reads an admitted path under the 10 MB limit', async () => {
    const deps = makeDeps({ admissions: { isAdmitted: vi.fn(() => true) } });
    const handlers = createIpcHandlers(deps);

    await expect(handlers[IPC_CHANNELS.readCueFile]('/lyrics.lrc')).resolves.toBe('file text');
    expect(deps.textFiles.readTextFileWithLimit).toHaveBeenCalledWith('/lyrics.lrc', MAX_CUE_FILE_BYTES);
  });
});

describe('apps/chord createIpcHandlers: cue export / general export / reveal', () => {
  it('exportCues shows a format-specific save dialog and writes the text', async () => {
    const deps = makeDeps({ dialogs: { showSaveCueDialog: vi.fn(async () => '/tmp/lyrics.srt') } });
    const handlers = createIpcHandlers(deps);

    const result = await handlers[IPC_CHANNELS.exportCues]('1\n00:00:01,000 --> 00:00:02,000\nHi\n', 'srt', 'lyrics');

    expect(deps.dialogs.showSaveCueDialog).toHaveBeenCalledWith('lyrics', 'srt');
    expect(deps.textFiles.writeTextFile).toHaveBeenCalledWith('/tmp/lyrics.srt', expect.stringContaining('Hi'));
    expect(result).toBe('/tmp/lyrics.srt');
  });

  it('exportCues returns null and writes nothing when cancelled', async () => {
    const deps = makeDeps();
    const handlers = createIpcHandlers(deps);
    await expect(handlers[IPC_CHANNELS.exportCues]('text', 'csv', 'lyrics')).resolves.toBeNull();
    expect(deps.textFiles.writeTextFile).not.toHaveBeenCalled();
  });

  it('exportCues rejects an unknown format', async () => {
    const deps = makeDeps();
    const handlers = createIpcHandlers(deps);
    await expect(handlers[IPC_CHANNELS.exportCues]('text', 'xml', 'lyrics')).rejects.toThrow();
  });

  it('chooseExportPath delegates to the save dialog', async () => {
    const deps = makeDeps({ dialogs: { showSaveExportDialog: vi.fn(async () => '/tmp/out.mp4') } });
    const handlers = createIpcHandlers(deps);

    await expect(handlers[IPC_CHANNELS.chooseExportPath]('out', 'mp4')).resolves.toBe('/tmp/out.mp4');
    expect(deps.dialogs.showSaveExportDialog).toHaveBeenCalledWith('out', 'mp4');
  });

  it('exportOpen/Write/Close/Abort delegate to the sink registry', async () => {
    const deps = makeDeps();
    const handlers = createIpcHandlers(deps);

    const sink = await handlers[IPC_CHANNELS.exportOpen]('/tmp/out.mp4');
    expect(sink).toEqual({ id: 'sink-1', path: '/tmp/out.mp4' });

    const bytes = new Uint8Array([1, 2, 3]);
    await handlers[IPC_CHANNELS.exportWrite]('sink-1', 10, bytes);
    expect(deps.exportSinks.write).toHaveBeenCalledWith('sink-1', 10, bytes);

    await handlers[IPC_CHANNELS.exportClose]('sink-1');
    expect(deps.exportSinks.close).toHaveBeenCalledWith('sink-1');

    await handlers[IPC_CHANNELS.exportAbort]('sink-1');
    expect(deps.exportSinks.abort).toHaveBeenCalledWith('sink-1');
  });

  it('exportWrite rejects a negative position or non-Uint8Array bytes', async () => {
    const deps = makeDeps();
    const handlers = createIpcHandlers(deps);
    await expect(handlers[IPC_CHANNELS.exportWrite]('sink-1', -1, new Uint8Array())).rejects.toThrow();
    await expect(handlers[IPC_CHANNELS.exportWrite]('sink-1', 0, [1, 2, 3])).rejects.toThrow();
    expect(deps.exportSinks.write).not.toHaveBeenCalled();
  });

  it('revealPath allows an admitted media path', async () => {
    const deps = makeDeps({ admissions: { isAdmitted: vi.fn(() => true) } });
    const handlers = createIpcHandlers(deps);

    await handlers[IPC_CHANNELS.revealPath]('/music/song.mp3');
    expect(deps.shellEffects.showItemInFolder).toHaveBeenCalledWith('/music/song.mp3');
  });

  it('revealPath allows a path chosen via chooseExportPath', async () => {
    const deps = makeDeps({ dialogs: { showSaveExportDialog: vi.fn(async () => '/tmp/out.mp4') } });
    const handlers = createIpcHandlers(deps);

    await handlers[IPC_CHANNELS.chooseExportPath]('out', 'mp4');
    await handlers[IPC_CHANNELS.revealPath]('/tmp/out.mp4');

    expect(deps.shellEffects.showItemInFolder).toHaveBeenCalledWith('/tmp/out.mp4');
  });

  it('revealPath allows a path opened via exportOpen even without chooseExportPath', async () => {
    const deps = makeDeps();
    const handlers = createIpcHandlers(deps);

    await handlers[IPC_CHANNELS.exportOpen]('/tmp/out.mp4');
    await handlers[IPC_CHANNELS.revealPath]('/tmp/out.mp4');

    expect(deps.shellEffects.showItemInFolder).toHaveBeenCalledWith('/tmp/out.mp4');
  });

  it('revealPath refuses a path that was never admitted or exported', async () => {
    const deps = makeDeps();
    const handlers = createIpcHandlers(deps);

    await expect(handlers[IPC_CHANNELS.revealPath]('/etc/passwd')).rejects.toThrow(/unrecognized/);
    expect(deps.shellEffects.showItemInFolder).not.toHaveBeenCalled();
  });
});

describe('apps/chord DocumentDirtyTracker', () => {
  it('starts clean and reflects set() calls', () => {
    const tracker = new DocumentDirtyTracker();
    expect(tracker.get()).toBe(false);
    tracker.set(true);
    expect(tracker.get()).toBe(true);
    tracker.set(false);
    expect(tracker.get()).toBe(false);
  });
});

describe('apps/chord admitProjectMedia', () => {
  function backgroundWith(kind: 'image' | 'video', media: ChordMediaRef): ChordBackground {
    return { kind, media, fit: 'cover', dim: 0, blur: 0, loop: false };
  }

  it('admits the audio path and an image/video background', async () => {
    const admit = vi.fn(async (p: string, kind: ImportKind) => fakeAdmittedFile(p, kind));
    const p = project({
      audio: { path: '/music/song.mp3', name: 'song.mp3', durationMs: 1000 },
      background: backgroundWith('video', { path: '/video/bg.mp4', name: 'bg.mp4', durationMs: 5000 }),
    });

    await admitProjectMedia({ admit, isAdmitted: vi.fn() }, p);

    expect(admit).toHaveBeenCalledWith('/music/song.mp3', 'audio');
    expect(admit).toHaveBeenCalledWith('/video/bg.mp4', 'video');
  });

  it('does nothing for a color background and a project with no audio', async () => {
    const admit = vi.fn(async (p: string, kind: ImportKind) => fakeAdmittedFile(p, kind));
    const p = project({ audio: null, background: { kind: 'color', color: '#000000' } });

    await admitProjectMedia({ admit, isAdmitted: vi.fn() }, p);

    expect(admit).not.toHaveBeenCalled();
  });

  it('swallows an admission failure so a project with moved/missing media still opens', async () => {
    const admit = vi.fn(async () => {
      throw new Error('File does not exist');
    });
    const p = project({ audio: { path: '/gone.mp3', name: 'gone.mp3', durationMs: null } });

    await expect(admitProjectMedia({ admit, isAdmitted: vi.fn() }, p)).resolves.toBeUndefined();
  });
});

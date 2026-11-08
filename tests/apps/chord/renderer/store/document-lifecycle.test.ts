import { describe, expect, it, vi } from 'vitest';
import type { ChordDesktopAPI } from '../../../../../apps/chord/shared/desktop-api';
import type { ChordMediaRef, ProjectDocument } from '../../../../../apps/chord/shared/project';
import { createEmptyProject } from '../../../../../apps/chord/shared/project-schema';
import { createMockApi } from '../../../../../apps/chord/renderer/mock-api';
import { createChordStore } from '../../../../../apps/chord/renderer/store/create-store';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function document(id: string, title = id): ProjectDocument {
  const project = createEmptyProject('2026-01-01T00:00:00.000Z', id);
  project.title = title;
  return { project, path: `/${id}.lumachord` };
}

const audio: ChordMediaRef = { path: '/song.wav', name: 'Song', durationMs: 1000 };
const image: ChordMediaRef = { path: '/image.png', name: 'Image', durationMs: null };

function setup(overrides: Partial<ChordDesktopAPI> = {}) {
  const api: ChordDesktopAPI = {
    ...createMockApi(),
    mediaUrl: vi.fn(async (path: string) => `lumachord://file${path}`),
    saveProject: vi.fn(async () => null),
    setDocumentState: vi.fn(async () => {}),
    ...overrides,
  };
  return { api, store: createChordStore(api) };
}

describe('Chord asynchronous saves', () => {
  it('preserves edits made while saving and adopts the saved path without clearing dirty', async () => {
    const saved = deferred<string | null>();
    const { api, store } = setup({ saveProject: vi.fn(() => saved.promise) });
    store.getState().setTitle('Persisted title');
    const saving = store.getState().saveDocument();
    await vi.waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1));
    store.getState().setTitle('Newer unsaved title');
    const newerProject = store.getState().document.project;

    saved.resolve('/saved.lumachord');
    await saving;

    expect(store.getState().document.project).toBe(newerProject);
    expect(store.getState().document.path).toBe('/saved.lumachord');
    expect(store.getState().dirty).toBe(true);
    expect(api.setDocumentState).toHaveBeenLastCalledWith({ title: 'Newer unsaved title', path: '/saved.lumachord', dirty: true });
  });

  it.each([false, true])('ignores save completion after loading another document session (same id: %s)', async (sameId) => {
    const saved = deferred<string | null>();
    const { api, store } = setup({ saveProject: vi.fn(() => saved.promise) });
    const originalId = store.getState().document.project.id;
    const saving = store.getState().saveDocument();
    await vi.waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1));
    const replacement = document(sameId ? originalId : 'replacement', 'Reopened document');
    store.getState().loadDocument(replacement);
    saved.resolve('/old-save.lumachord');
    await saving;

    expect(store.getState().document).toBe(replacement);
    expect(store.getState().dirty).toBe(false);
    expect(api.setDocumentState).toHaveBeenLastCalledWith({ title: 'Reopened document', path: replacement.path, dirty: false });
  });

  it('serializes invocation snapshots and propagates a successful Save As path to later normal saves', async () => {
    const first = deferred<string | null>();
    const { api, store } = setup({ saveProject: vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce('/chosen.lumachord') });
    store.getState().setTitle('First snapshot');
    const firstSave = store.getState().saveDocument(true);
    await vi.waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1));
    store.getState().setTitle('Second snapshot');
    const secondSave = store.getState().saveDocument(false);
    store.getState().setTitle('Third unsaved edit');
    await Promise.resolve();
    expect(api.saveProject).toHaveBeenCalledTimes(1);

    first.resolve('/chosen.lumachord');
    await Promise.all([firstSave, secondSave]);
    const calls = vi.mocked(api.saveProject).mock.calls;
    expect(calls.map(([snapshot]) => snapshot.project.title)).toEqual(['First snapshot', 'Second snapshot']);
    expect(calls[1]).toEqual([expect.objectContaining({ path: '/chosen.lumachord' }), { saveAs: false }]);
    expect(store.getState().document.project.title).toBe('Third unsaved edit');
    expect(store.getState().dirty).toBe(true);
  });

  it.each(['cancel', 'reject'] as const)('continues queued saves after a %s without inventing a saved path', async (outcome) => {
    const first = deferred<string | null>();
    const { api, store } = setup({ saveProject: vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce('/retry.lumachord') });
    store.getState().setTitle('First');
    const saving = store.getState().saveDocument();
    const settled = outcome === 'reject' ? expect(saving).rejects.toThrow('Disk full') : saving;
    await vi.waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1));
    store.getState().setTitle('Retry');
    const retry = store.getState().saveDocument();
    if (outcome === 'reject') first.reject(new Error('Disk full'));
    else first.resolve(null);
    await settled;
    await retry;

    expect(vi.mocked(api.saveProject).mock.calls[1][0].path).toBeNull();
    expect(store.getState().document.project.title).toBe('Retry');
    expect(store.getState().document.path).toBe('/retry.lumachord');
    expect(store.getState().dirty).toBe(false);
  });

  it('does not start queued saves belonging to a replaced document session', async () => {
    const first = deferred<string | null>();
    const { api, store } = setup({ saveProject: vi.fn(() => first.promise) });
    const saving = store.getState().saveDocument();
    await vi.waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1));
    const queued = store.getState().saveDocument();
    store.getState().loadDocument(document('replacement'));
    first.resolve('/old.lumachord');
    await Promise.all([saving, queued]);
    expect(api.saveProject).toHaveBeenCalledTimes(1);
    expect(store.getState().document.project.id).toBe('replacement');
  });
});

describe('Chord document request authority', () => {
  it('retains the latest opened document when earlier requests finish later', async () => {
    const first = deferred<ProjectDocument | null>();
    const second = deferred<ProjectDocument | null>();
    const { store } = setup({ openProject: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) });
    const olderOpen = store.getState().openDocument('/older.lumachord');
    const newerOpen = store.getState().openDocument('/newer.lumachord');
    second.resolve(document('newer'));
    await newerOpen;
    first.resolve(document('older'));
    await olderOpen;
    expect(store.getState().document.project.id).toBe('newer');
  });

  it('invalidates pending open requests when a document is loaded directly or created', async () => {
    const opening = deferred<ProjectDocument | null>();
    const { store } = setup({ openProject: () => opening.promise, newProject: async () => document('new') });
    const pending = store.getState().openDocument();
    await store.getState().newDocument();
    opening.resolve(document('older'));
    await pending;
    expect(store.getState().document.project.id).toBe('new');
  });
});

describe('Chord document media consistency', () => {
  it('clears removed audio immediately on undo and resolves it again on redo', async () => {
    const { store } = setup();
    store.getState().setAudio(audio, 'lumachord://file/song.wav');
    store.getState().undo();
    expect(store.getState().document.project.audio).toBeNull();
    expect(store.getState().media.audioUrl).toBeNull();
    store.getState().redo();
    await vi.waitFor(() => expect(store.getState().media.audioUrl).toBe('lumachord://file/song.wav'));
  });

  it('restores background media across removal, undo and redo', async () => {
    const { store } = setup();
    store.getState().setBackground({ kind: 'image', media: image, fit: 'cover', dim: 0, blur: 0, loop: false }, 'lumachord://file/image.png');
    store.getState().setBackground({ kind: 'color', color: '#000000' }, null);
    store.getState().undo();
    await vi.waitFor(() => expect(store.getState().media.backgroundUrl).toBe('lumachord://file/image.png'));
    store.getState().redo();
    expect(store.getState().media.backgroundUrl).toBeNull();
  });

  it('resolves channels independently when one media lookup fails', async () => {
    const { store } = setup({ mediaUrl: async (path) => { if (path === audio.path) throw new Error('Missing audio'); return 'lumachord://file/image.png'; } });
    const loaded = document('media');
    loaded.project.audio = audio;
    loaded.project.background = { kind: 'image', media: image, fit: 'cover', dim: 0, blur: 0, loop: false };
    store.getState().loadDocument(loaded);
    await vi.waitFor(() => expect(store.getState().media).toEqual({ audioUrl: null, backgroundUrl: 'lumachord://file/image.png' }));
  });

  it('ignores older media resolution after reopening the same project id', async () => {
    const older = deferred<string | null>();
    const newer = deferred<string | null>();
    const { store } = setup({ mediaUrl: vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise) });
    const first = document('same-id');
    first.project.audio = audio;
    const second = document('same-id');
    second.project.audio = { ...audio, path: '/new.wav' };
    store.getState().loadDocument(first);
    store.getState().loadDocument(second);
    newer.resolve('lumachord://file/new.wav');
    await vi.waitFor(() => expect(store.getState().media.audioUrl).toBe('lumachord://file/new.wav'));
    older.resolve('lumachord://file/song.wav');
    await older.promise;
    await Promise.resolve();
    expect(store.getState().media.audioUrl).toBe('lumachord://file/new.wav');
  });

  it('does not let a pending lookup replace an explicitly adopted URL for the same path', async () => {
    const pending = deferred<string | null>();
    const { store } = setup({ mediaUrl: () => pending.promise });
    const loaded = document('media');
    loaded.project.audio = audio;
    store.getState().loadDocument(loaded);
    store.getState().setAudio(audio, 'lumachord://file/adopted.wav');
    pending.resolve('lumachord://file/obsolete.wav');
    await pending.promise;
    await Promise.resolve();
    expect(store.getState().media.audioUrl).toBe('lumachord://file/adopted.wav');
  });

  it('keeps useful pending lookups across unrelated edits and drops them after media undo', async () => {
    const pending = deferred<string | null>();
    const { store } = setup({ mediaUrl: () => pending.promise });
    const loaded = document('media');
    loaded.project.audio = audio;
    store.getState().loadDocument(loaded);
    store.getState().setTitle('Unrelated edit');
    pending.resolve('lumachord://file/song.wav');
    await vi.waitFor(() => expect(store.getState().media.audioUrl).toBe('lumachord://file/song.wav'));

    store.getState().setAudio(null, null);
    expect(store.getState().media.audioUrl).toBeNull();
  });
});

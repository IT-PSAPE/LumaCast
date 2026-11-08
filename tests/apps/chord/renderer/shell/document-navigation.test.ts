import { describe, expect, it, vi } from 'vitest';
import { createChordStore } from '../../../../../apps/chord/renderer/store/create-store';
import { createMockApi } from '../../../../../apps/chord/renderer/mock-api';
import { createDocumentNavigation } from '../../../../../apps/chord/renderer/shell/document-navigation';
import { createEmptyProject } from '../../../../../apps/chord/shared/project-schema';
import type { ChordDesktopAPI } from '../../../../../apps/chord/shared/desktop-api';
import type { confirmChoice } from '../../../../../apps/chord/renderer/components/confirm-dialog';
import { WindowLifetime } from '../../../../../apps/chord/main/window-lifetime';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const documentFor = (id = 'target') => ({ project: createEmptyProject('2026-11-08T00:00:00Z', id), path: `/synthetic/${id}.lumachord` });
function setup(overrides: Partial<ChordDesktopAPI> = {}) {
  const api = { ...createMockApi(), newProject: vi.fn(async () => documentFor()), openProject: vi.fn(async () => documentFor()),
    requestWindowClose: vi.fn(async () => true), ...overrides };
  const store = createChordStore(api);
  store.getState().loadDocument(documentFor('source'));
  store.getState().setTitle('Unsaved');
  const confirm = vi.fn<typeof confirmChoice>().mockResolvedValue('cancel');
  const reportError = vi.fn();
  const navigation = createDocumentNavigation({ api, store, confirm, reportError });
  return { api, store, confirm, reportError, navigation };
}
function snapshot(store: ReturnType<typeof createChordStore>) {
  const state = store.getState();
  return { document: state.document, dirty: state.dirty, selection: state.selection, playback: state.playback,
    canUndo: state.canUndo, canRedo: state.canRedo, undo: state._undoStack, redo: state._redoStack };
}
function unload(navigation: ReturnType<typeof createDocumentNavigation>) {
  const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
  navigation.beforeUnload(event);
  return event.defaultPrevented;
}

describe('Chord protected document navigation with the actual store', () => {
  it.each(['new', 'open', 'path'] as const)('%s Cancel preserves the complete editor state', async (kind) => {
    const { store, navigation, api, confirm } = setup();
    const cue = store.getState().addCue(0, 'Synthetic lyric');
    store.getState().select([cue]);
    store.getState().togglePlay();
    const before = snapshot(store);
    const result = kind === 'new' ? navigation.newDocument() : navigation.openDocument(kind === 'path' ? '/synthetic/recent.lumachord' : undefined);
    expect(await result).toBe(false);
    expect(snapshot(store)).toEqual(before);
    expect(store.getState().document).toBe(before.document);
    expect(confirm).toHaveBeenCalledTimes(1);
    if (kind === 'path') expect(api.openProject).toHaveBeenCalledWith('/synthetic/recent.lumachord');
  });

  it('Discard loads only after consent and resets history on authorized replacement', async () => {
    const { navigation, confirm, store } = setup();
    confirm.mockResolvedValue('discard');
    expect(await navigation.newDocument()).toBe(true);
    expect(store.getState().document.project.id).toBe('target');
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().canUndo).toBe(false);
  });

  it.each(['cancel', 'failure'] as const)('a %s picker preserves document/history without prompting', async (kind) => {
    const openProject = vi.fn(async () => { if (kind === 'failure') throw new Error('read failed'); return null; });
    const { navigation, store, confirm, reportError } = setup({ openProject });
    const before = snapshot(store);
    expect(await navigation.openDocument()).toBe(false);
    expect(snapshot(store)).toEqual(before);
    expect(confirm).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledTimes(kind === 'failure' ? 1 : 0);
  });

  it('prompts a clean project edited while the picker is pending', async () => {
    const picked = deferred<ReturnType<typeof documentFor>>();
    const { navigation, store, confirm } = setup({ openProject: () => picked.promise });
    store.getState().loadDocument(documentFor('clean'));
    const result = navigation.openDocument();
    await flush();
    store.getState().setTitle('Edit during picker');
    picked.resolve(documentFor());
    expect(await result).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(store.getState().document.project.title).toBe('Edit during picker');
  });

  it('binds Discard to exact project revision and re-prompts edits made during confirmation', async () => {
    const choice = deferred<string>();
    const { navigation, store, confirm } = setup();
    confirm.mockReturnValueOnce(choice.promise).mockResolvedValue('cancel');
    const result = navigation.newDocument();
    await flush();
    store.getState().setTitle('Newer edit');
    choice.resolve('discard');
    expect(await result).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(store.getState().document.project.title).toBe('Newer edit');
  });

  it.each(['cancel', 'failure', 'new-edit'] as const)('Save %s cannot replace the source', async (kind) => {
    const saving = deferred<string | null>();
    const { navigation, store, confirm, reportError } = setup({ saveProject: () => saving.promise });
    confirm.mockResolvedValue('save');
    const result = navigation.newDocument();
    await flush();
    if (kind === 'new-edit') store.getState().setTitle('Edit during save');
    if (kind === 'failure') saving.reject(new Error('disk')); else saving.resolve(kind === 'cancel' ? null : '/synthetic/saved.lumachord');
    expect(await result).toBe(false);
    expect(store.getState().document.project.id).toBe('source');
    expect(store.getState().dirty).toBe(true);
    if (kind === 'new-edit') expect(store.getState().document.project.title).toBe('Edit during save');
    if (kind === 'failure') expect(reportError).toHaveBeenCalledWith('Could not save this project.');
  });

  it('Save replaces only after the current revision is saved successfully', async () => {
    const { navigation, confirm, store } = setup({ saveProject: async () => '/synthetic/saved.lumachord' });
    confirm.mockResolvedValue('save');
    expect(await navigation.newDocument()).toBe(true);
    expect(store.getState().document.project.id).toBe('target');
  });

  it('rejects competing navigation and save before opening another picker/dialog', async () => {
    const picked = deferred<ReturnType<typeof documentFor>>();
    const saveProject = vi.fn(async () => null);
    const { navigation, api } = setup({ openProject: () => picked.promise, saveProject });
    const first = navigation.openDocument();
    expect(await navigation.newDocument()).toBe(false);
    expect(await navigation.saveDocument()).toBe(false);
    expect(api.newProject).not.toHaveBeenCalled();
    expect(saveProject).not.toHaveBeenCalled();
    picked.resolve(documentFor());
    await first;
  });

  it.each(['read', 'prompt', 'save'] as const)('same-ID replacement invalidates an old %s action and suppresses stale errors', async (phase) => {
    const read = deferred<ReturnType<typeof documentFor>>();
    const choice = deferred<string>();
    const saved = deferred<string | null>();
    const { navigation, store, confirm, reportError } = setup({ openProject: () => read.promise, saveProject: () => saved.promise });
    confirm.mockReturnValue(choice.promise);
    const result = navigation.openDocument();
    await flush();
    if (phase !== 'read') { read.resolve(documentFor()); await flush(); }
    if (phase === 'save') { choice.resolve('save'); await flush(); }
    const replacement = documentFor('source');
    store.getState().loadDocument(replacement);
    if (phase === 'read') read.reject(new Error('stale read')); else if (phase === 'prompt') choice.resolve('discard'); else saved.reject(new Error('stale save'));
    expect(await result).toBe(false);
    expect(store.getState().document).toBe(replacement);
    expect(reportError).not.toHaveBeenCalled();
    if (phase !== 'read') expect(confirm.mock.calls[0]?.[3]?.signal?.aborted).toBe(true);
  });

  it('dispose cancels unsent work and its visible prompt', async () => {
    const choice = deferred<string>();
    const { navigation, confirm, store } = setup();
    confirm.mockReturnValue(choice.promise);
    const result = navigation.newDocument();
    await flush();
    navigation.dispose();
    expect(confirm.mock.calls[0]?.[3]?.signal?.aborted).toBe(true);
    choice.resolve('discard');
    expect(await result).toBe(false);
    expect(store.getState().document.project.id).toBe('source');
  });

  it('reports direct Save failure without an unhandled rejection', async () => {
    const { navigation, reportError } = setup({ saveProject: async () => { throw new Error('disk'); } });
    expect(await navigation.saveDocument()).toBe(false);
    expect(reportError).toHaveBeenCalledWith('Could not save this project.');
  });

  it('never sends an unsent Save against a synchronous same-ID successor', async () => {
    const saveProject = vi.fn(async () => '/synthetic/wrong-save.lumachord');
    const { navigation, store } = setup({ saveProject });
    const saving = navigation.saveDocument();
    const successor = documentFor('source');
    store.getState().loadDocument(successor);
    expect(await saving).toBe(false);
    expect(saveProject).not.toHaveBeenCalled();
    expect(store.getState().document).toBe(successor);
    expect(store.getState().dirty).toBe(false);
  });

  it('a mounted owner releases native close intent invalidated before its first microtask', async () => {
    let navigation!: ReturnType<typeof createDocumentNavigation>;
    let closing!: Promise<boolean>;
    const retire = vi.fn(async () => {});
    const onCloseSettled = vi.fn();
    const lifetime = new WindowLifetime({
      createSinks: () => ({ open: vi.fn(), write: vi.fn(), close: vi.fn(), abort: vi.fn(), retire }),
      sendCloseRequest: () => { closing = navigation.closeDocument(); }, replayClose: vi.fn(), onCloseSettled,
    });
    const requestWindowClose = vi.fn((approved: boolean) => lifetime.finishClose(approved));
    const context = setup({ requestWindowClose });
    navigation = context.navigation;
    await lifetime.rendererReady();
    lifetime.nativeClose({ preventDefault: vi.fn() });
    const successor = documentFor('source');
    context.store.getState().loadDocument(successor);
    expect(await closing).toBe(false);
    expect(requestWindowClose).toHaveBeenCalledExactlyOnceWith(false);
    expect(onCloseSettled).toHaveBeenCalledExactlyOnceWith(false);
    expect(retire).not.toHaveBeenCalled();
    expect(context.confirm).not.toHaveBeenCalled();
    expect(context.store.getState().document).toBe(successor);
    navigation.dispose();
  });

  it.each(['new', 'open', 'save', 'close'] as const)('dispose before the first microtask cancels unsent %s work', async (kind) => {
    const saveProject = vi.fn(async () => '/synthetic/never.lumachord');
    const { navigation, api, confirm, store } = setup({ saveProject });
    const before = snapshot(store);
    const result = kind === 'new' ? navigation.newDocument() : kind === 'open' ? navigation.openDocument()
      : kind === 'save' ? navigation.saveDocument() : navigation.closeDocument();
    navigation.dispose();
    expect(await navigation.closeDocument()).toBe(false);
    expect(await result).toBe(false);
    expect(api.newProject).not.toHaveBeenCalled();
    expect(api.openProject).not.toHaveBeenCalled();
    expect(saveProject).not.toHaveBeenCalled();
    expect(api.requestWindowClose).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(snapshot(store)).toEqual(before);
  });

  it.each(['cancel', 'save'] as const)('close %s never retires and Save keeps the window open', async (choice) => {
    const saving = vi.fn(async () => '/synthetic/saved.lumachord');
    const { navigation, api, confirm, store } = setup({ saveProject: saving });
    confirm.mockResolvedValue(choice);
    expect(await navigation.closeDocument()).toBe(false);
    expect(api.requestWindowClose).toHaveBeenCalledExactlyOnceWith(false);
    expect(saving).toHaveBeenCalledTimes(choice === 'save' ? 1 : 0);
    expect(store.getState().document.project.id).toBe('source');
  });

  it('checks dirty truth immediately without waiting for the title bridge', () => {
    const { navigation, store } = setup();
    store.getState().loadDocument(documentFor('clean'));
    expect(unload(navigation)).toBe(false);
    store.getState().setTitle('Immediate edit');
    expect(unload(navigation)).toBe(true);
  });

  it('a disposed close owner cannot cancel the native intent its successor is completing', async () => {
    const draining = deferred<void>();
    let mounted!: ReturnType<typeof createDocumentNavigation>;
    let latest!: Promise<boolean>;
    let generations = 0;
    const guards = new Set<ReturnType<typeof createDocumentNavigation>>();
    const replay = vi.fn(() => {
      const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
      for (const guard of guards) guard.beforeUnload(event);
      if (event.defaultPrevented) lifetime.unloadPrevented(); else void lifetime.closed();
    });
    const lifetime = new WindowLifetime({
      createSinks: () => ({ open: vi.fn(), write: vi.fn(), close: vi.fn(), abort: vi.fn(),
        retire: ++generations === 1 ? () => draining.promise : async () => {} }),
      sendCloseRequest: () => { latest = mounted.closeDocument(); }, replayClose: replay,
    });
    let approvals = 0;
    const requestWindowClose = vi.fn(async (approved: boolean) => {
      if (approved && ++approvals > 4) throw new Error('Repeated stale close approval');
      return lifetime.finishClose(approved);
    });
    const context = setup({ requestWindowClose });
    context.store.getState().loadDocument(documentFor('clean'));
    mounted = context.navigation;
    guards.add(mounted);
    await lifetime.rendererReady();
    lifetime.nativeClose({ preventDefault: vi.fn() });
    await flush();
    const old = mounted;
    const oldClose = latest;
    const pending = old.dispose();
    void pending?.finally(() => guards.delete(old));
    mounted = createDocumentNavigation({ api: context.api, store: context.store,
      confirm: context.confirm, reportError: context.reportError });
    guards.add(mounted);
    lifetime.nativeClose({ preventDefault: vi.fn() });
    await flush();
    const successorClose = latest;
    draining.resolve();
    expect(await oldClose).toBe(false);
    expect(await successorClose).toBe(true);
    expect(approvals).toBe(3); // old drain, successor coalescing, successor replay
    expect(requestWindowClose.mock.calls.some(([approved]) => !approved)).toBe(false);
    expect(replay).toHaveBeenCalledTimes(2);
    expect(generations).toBe(2);
    mounted.dispose();
  });

  it.each(['edit', 'same-id-dirty', 'same-id-clean'] as const)('vetoes %s during drain, then protects the latest owner', async (change) => {
    const draining = deferred<void>();
    let navigation!: ReturnType<typeof createDocumentNavigation>;
    let closeResult!: Promise<boolean>;
    let generations = 0;
    const replay = vi.fn(() => {
      const event = { preventDefault: vi.fn() };
      lifetime.nativeClose(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      if (unload(navigation)) lifetime.unloadPrevented(); else void lifetime.closed();
    });
    const lifetime = new WindowLifetime({
      createSinks: () => ({ open: vi.fn(), write: vi.fn(), close: vi.fn(), abort: vi.fn(),
        retire: ++generations === 1 ? () => draining.promise : async () => {} }),
      sendCloseRequest: () => { closeResult = navigation.closeDocument(); }, replayClose: replay,
    });
    const context = setup({ requestWindowClose: (approved) => lifetime.finishClose(approved) });
    navigation = context.navigation;
    context.confirm.mockResolvedValue('discard');
    await lifetime.rendererReady();
    lifetime.nativeClose({ preventDefault: vi.fn() });
    await flush();
    if (change === 'edit') context.store.getState().setTitle('During drain');
    else {
      context.store.getState().loadDocument(documentFor('source'));
      if (change === 'same-id-dirty') context.store.getState().setTitle('Replacement edit');
    }
    draining.resolve();
    await flush();
    if (change === 'edit') {
      expect(await closeResult).toBe(true);
      expect(context.confirm).toHaveBeenCalledTimes(2);
      expect(replay).toHaveBeenCalledTimes(2);
    } else {
      expect(await closeResult).toBe(false);
      expect(context.store.getState().document.project.id).toBe('source');
      expect(replay).toHaveBeenCalledTimes(1);
      lifetime.nativeClose({ preventDefault: vi.fn() });
      await flush();
      expect(await closeResult).toBe(true);
    }
    expect(generations).toBe(2);
  });
});

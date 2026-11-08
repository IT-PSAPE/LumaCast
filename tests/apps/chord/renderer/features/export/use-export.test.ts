import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../../../../../../apps/chord/renderer/mock-api';
import { createTestDocument } from '../../test-store';
import { useChordStore } from '../../../../../../apps/chord/renderer/store';
import { runExport } from '../../../../../../apps/chord/renderer/features/export/export-engine';
import { startExport, useExport } from '../../../../../../apps/chord/renderer/features/export/use-export';

vi.mock('../../../../../../apps/chord/renderer/features/export/export-engine', () => ({ runExport: vi.fn() }));

const settings = { kind: 'image', timeMs: 0 } as const;
const direct = { outputPath: '/synthetic.png' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  const api = {
    ...createMockApi(),
    chooseExportPath: vi.fn(async (): Promise<string | null> => '/synthetic.png'),
    exportOpen: vi.fn(async (path: string) => ({ id: 'sink', path })),
    exportWrite: vi.fn(async () => {}),
    exportClose: vi.fn(async () => {}),
    exportAbort: vi.fn(async () => {}),
  };
  window.lumachord = api;
  return api;
}

beforeEach(() => {
  vi.mocked(runExport).mockReset().mockResolvedValue(undefined);
  useChordStore.getState().loadDocument(createTestDocument());
});
afterEach(() => {
  useChordStore.getState().loadDocument(createTestDocument());
  vi.restoreAllMocks();
});

describe('export operation ownership', () => {
  it.each(['picker', 'open'] as const)('reports %s setup rejection and permits a retry', async (stage) => {
    const api = setup();
    if (stage === 'picker') api.chooseExportPath.mockRejectedValueOnce(new Error('picker unavailable'));
    else api.exportOpen.mockRejectedValueOnce(new Error('sink unavailable'));
    await expect(startExport(settings, new AbortController())).resolves.toBeUndefined();
    expect(useChordStore.getState().exportJob.status).toBe('failed');
    expect(useChordStore.getState().exportJob.error).toContain('unavailable');
    expect(api.exportAbort).not.toHaveBeenCalled();
    await startExport(settings, new AbortController(), direct);
    expect(useChordStore.getState().exportJob.status).toBe('done');
  });

  it('reserves before the picker and prevents same-document reentry', async () => {
    const api = setup();
    const chosen = deferred<string | null>();
    api.chooseExportPath.mockImplementation(() => chosen.promise);
    const first = startExport(settings, new AbortController());
    const second = startExport(settings, new AbortController());
    try {
      expect(api.chooseExportPath).toHaveBeenCalledTimes(1);
      expect(useChordStore.getState().exportJob.status).toBe('preparing');
    } finally {
      chosen.resolve(null);
      await Promise.all([first, second]);
    }
    expect(useChordStore.getState().exportJob.status).toBe('idle');
  });

  it('aborts a sink opened after cancellation without starting the encoder', async () => {
    const api = setup();
    const opened = deferred<{ id: string; path: string }>();
    api.exportOpen.mockImplementation(() => opened.promise);
    const controller = new AbortController();
    const running = startExport(settings, controller, direct);
    controller.abort();
    opened.resolve({ id: 'late-sink', path: direct.outputPath });
    await running;
    expect(runExport).not.toHaveBeenCalled();
    expect(api.exportAbort).toHaveBeenCalledExactlyOnceWith('late-sink');
    expect(useChordStore.getState().exportJob.status).toBe('cancelled');
  });

  it('classifies an aborted picker separately from a plain dismissal', async () => {
    const api = setup();
    const chosen = deferred<string | null>();
    api.chooseExportPath.mockImplementation(() => chosen.promise);
    const controller = new AbortController();
    const running = startExport(settings, controller);
    controller.abort();
    chosen.resolve(null);
    await running;
    expect(useChordStore.getState().exportJob.status).toBe('cancelled');
    expect(api.exportOpen).not.toHaveBeenCalled();
  });

  it('retains invocation settings and project while ordinary edits continue', async () => {
    const api = setup();
    const chosen = deferred<string | null>();
    api.chooseExportPath.mockImplementation(() => chosen.promise);
    const selected = { kind: 'image' as const, timeMs: 0 };
    const originalProject = useChordStore.getState().document.project;
    const running = startExport(selected, new AbortController());
    selected.timeMs = 1000;
    useChordStore.getState().setTitle('Later edit');
    chosen.resolve('/snapshot.png');
    await running;
    expect(vi.mocked(runExport).mock.calls[0][0]).toMatchObject({ project: originalProject, settings: { kind: 'image', timeMs: 0 } });
    expect(useChordStore.getState().document.project.title).toBe('Later edit');
  });

  it('uses the captured API to clean a cancelled operation', async () => {
    const api = setup();
    const engine = deferred<void>();
    vi.mocked(runExport).mockImplementation(() => engine.promise);
    const controller = new AbortController();
    const running = startExport(settings, controller, direct);
    await vi.waitFor(() => expect(runExport).toHaveBeenCalledTimes(1));
    const replacementApi = setup();
    controller.abort();
    engine.resolve();
    await running;
    expect(api.exportAbort).toHaveBeenCalledExactlyOnceWith('sink');
    expect(replacementApi.exportAbort).not.toHaveBeenCalled();
  });

  it.each([false, true])('retires replaced document requests and ignores stale progress/completion (same id: %s)', async (sameId) => {
    setup();
    const oldRun = deferred<void>();
    const newRun = deferred<void>();
    vi.mocked(runExport).mockImplementationOnce(() => oldRun.promise).mockImplementationOnce(() => newRun.promise);
    const oldController = new AbortController();
    const old = startExport(settings, oldController, direct);
    await vi.waitFor(() => expect(runExport).toHaveBeenCalledTimes(1));
    const oldInput = vi.mocked(runExport).mock.calls[0][0];
    const originalId = useChordStore.getState().document.project.id;
    useChordStore.getState().loadDocument(createTestDocument({ id: sameId ? originalId : 'replacement' }));
    const current = startExport(settings, new AbortController(), direct);
    await vi.waitFor(() => expect(runExport).toHaveBeenCalledTimes(2));
    try {
      expect(oldController.signal.aborted).toBe(true);
      oldInput.onProgress({ stage: 'rendering', percent: 99, etaMs: 1 });
      expect(useChordStore.getState().exportJob.percent).toBe(0);
      oldRun.resolve();
      await old;
      expect(useChordStore.getState().exportJob.status).toBe('preparing');
    } finally {
      oldRun.resolve();
      newRun.resolve();
      await Promise.all([old, current]);
    }
    expect(useChordStore.getState().exportJob.status).toBe('done');
  });

  it('keeps the replacement hook controller when an old request finally settles', async () => {
    setup();
    const oldRun = deferred<void>();
    const newRun = deferred<void>();
    vi.mocked(runExport).mockImplementationOnce(() => oldRun.promise).mockImplementationOnce(() => newRun.promise);
    const hook = renderHook(() => useExport());
    let old!: Promise<void>;
    act(() => { old = hook.result.current.start(settings); });
    await vi.waitFor(() => expect(runExport).toHaveBeenCalledTimes(1));
    act(() => useChordStore.getState().loadDocument(createTestDocument()));
    let current!: Promise<void>;
    act(() => { current = hook.result.current.start(settings); });
    await vi.waitFor(() => expect(runExport).toHaveBeenCalledTimes(2));
    try {
      await act(async () => { oldRun.resolve(); await old; });
      act(() => hook.result.current.cancel());
      expect(vi.mocked(runExport).mock.calls[1][0].signal.aborted).toBe(true);
    } finally {
      oldRun.resolve(); newRun.resolve();
      await act(async () => { await Promise.all([old, current]); });
      hook.unmount();
    }
  });

  it('keeps cancellation authority during same-session hook reentry', async () => {
    setup();
    const engine = deferred<void>();
    vi.mocked(runExport).mockImplementation(() => engine.promise);
    const hook = renderHook(() => useExport());
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = hook.result.current.start(settings); });
    await vi.waitFor(() => expect(runExport).toHaveBeenCalledTimes(1));
    const firstSignal = vi.mocked(runExport).mock.calls[0][0].signal;
    act(() => { second = hook.result.current.start(settings); });
    act(() => hook.result.current.cancel());
    try {
      expect(firstSignal.aborted).toBe(true);
      expect(runExport).toHaveBeenCalledTimes(1);
    } finally {
      engine.resolve();
      await act(async () => { await Promise.all([first, second]); });
      hook.unmount();
    }
  });

  it('preserves successful close once publication has been sealed', async () => {
    const api = setup();
    const closed = deferred<void>();
    api.exportClose.mockImplementation(() => closed.promise);
    const controller = new AbortController();
    const running = startExport(settings, controller, direct);
    await vi.waitFor(() => expect(api.exportClose).toHaveBeenCalledTimes(1));
    controller.abort();
    closed.resolve();
    await running;
    expect(api.exportAbort).not.toHaveBeenCalled();
    expect(useChordStore.getState().exportJob.status).toBe('done');
  });

  it('preserves close failure while retrying only cleanup', async () => {
    const api = setup();
    api.exportClose.mockRejectedValue(new Error('publish failed'));
    api.exportAbort.mockRejectedValue(new Error('cleanup failed'));
    await startExport(settings, new AbortController(), direct);
    expect(api.exportClose).toHaveBeenCalledTimes(1);
    expect(api.exportAbort).toHaveBeenCalledTimes(1);
    expect(useChordStore.getState().exportJob).toMatchObject({ status: 'failed', error: 'publish failed\nCleanup failed: cleanup failed' });
  });

  it('cancels its active request on hook unmount', async () => {
    setup();
    const engine = deferred<void>();
    vi.mocked(runExport).mockImplementation(() => engine.promise);
    const hook = renderHook(() => useExport());
    let running!: Promise<void>;
    act(() => { running = hook.result.current.start(settings); });
    await vi.waitFor(() => expect(runExport).toHaveBeenCalledTimes(1));
    const input = vi.mocked(runExport).mock.calls[0][0];
    hook.unmount();
    try { expect(input.signal.aborted).toBe(true); }
    finally { engine.resolve(); await running; }
  });
});

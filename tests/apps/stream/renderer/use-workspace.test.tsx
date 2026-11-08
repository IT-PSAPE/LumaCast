import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkspace } from '../../../../apps/stream/renderer/features/workspace/use-workspace';
import { createDefaultProject, type StreamAPI, type StreamWorkspace } from '../../../../apps/stream/shared/desktop-api';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function workspace(collectionId = 'collection-a', profileId = 'profile-a'): StreamWorkspace {
  return { activeCollectionId: collectionId, collections: [{ id: collectionId, name: collectionId }], activeProfileId: profileId, profiles: [{ id: profileId, name: profileId }], project: createDefaultProject() };
}
function fixture(initial = workspace()) {
  let close: ((closing: boolean) => Promise<void>) | undefined;
  const api = {
    loadProject: vi.fn().mockResolvedValue(initial), saveProject: vi.fn().mockResolvedValue(undefined),
    onProjectFlush: vi.fn((listener) => { close = listener; return () => { close = undefined; }; }),
    activateCollection: vi.fn().mockResolvedValue(workspace('collection-b')),
  };
  const params = { api: api as unknown as StreamAPI, setActionError: vi.fn(), working: false, setWorking: vi.fn(), isOutputActive: () => false, onWorkspaceChanging: vi.fn() };
  return { api, params, close: (closing = true) => close!(closing) };
}
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('workspace persistence ownership', () => {
  it('captures an edit and flushes before React effects or the autosave delay', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const { result } = renderHook(() => useWorkspace(f.params));
    await act(async () => {});
    await act(async () => {
      result.current.setProjectValue((project) => ({ ...project, studioMode: true }));
      await f.close();
    });
    expect(f.api.saveProject).toHaveBeenCalledExactlyOnceWith('collection-a', 'profile-a', expect.objectContaining({ studioMode: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(f.api.saveProject).toHaveBeenCalledTimes(1);
  });

  it('drains the newest revision queued while a write is pending in order', async () => {
    const f = fixture();
    const write = deferred<void>();
    f.api.saveProject.mockImplementationOnce(() => write.promise);
    const { result } = renderHook(() => useWorkspace(f.params));
    await act(async () => {});
    let flushing!: Promise<void>;
    act(() => result.current.setProjectValue((project) => ({ ...project, studioMode: true })));
    // An ordinary autosave may be in flight before shutdown starts.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 260)); });
    act(() => result.current.setProjectValue((project) => ({ ...project, studioMode: false })));
    await act(async () => { flushing = f.close(); await Promise.resolve(); });
    expect(f.api.saveProject).toHaveBeenCalledTimes(1);
    await act(async () => { write.resolve(); await flushing; });
    expect(f.api.saveProject.mock.calls.map((call) => call[2].studioMode)).toEqual([true, false]);
  });

  it('retains a failed final revision and resumes editing for a second close attempt', async () => {
    const f = fixture();
    f.api.saveProject.mockRejectedValueOnce(new Error('Disk unavailable'));
    const { result } = renderHook(() => useWorkspace(f.params));
    await act(async () => {});
    act(() => result.current.setProjectValue((project) => ({ ...project, studioMode: true })));
    await act(async () => { await expect(f.close()).rejects.toThrow('Disk unavailable'); });
    expect(f.params.setActionError).toHaveBeenCalledWith('Could not save project settings: Disk unavailable');
    await act(async () => {
      result.current.setProjectValue((project) => ({ ...project, studioMode: false }));
      await f.close();
    });
    expect(f.api.saveProject.mock.calls.map((call) => call[2].studioMode)).toEqual([true, false]);
  });

  it('holds revisions stable after close ACK until close cancellation resumes edits', async () => {
    const f = fixture();
    const { result } = renderHook(() => useWorkspace(f.params));
    await act(async () => {});
    await act(async () => { await f.close(); });
    act(() => result.current.setProjectValue((project) => ({ ...project, studioMode: true })));
    expect(result.current.project?.studioMode).toBe(false);
    await act(async () => { await f.close(false); });
    act(() => result.current.setProjectValue((project) => ({ ...project, studioMode: true })));
    expect(result.current.project?.studioMode).toBe(true);
  });

  it('flushes old collection before switching and blocks edits during the ownership transition', async () => {
    const f = fixture();
    const switching = deferred<StreamWorkspace>();
    f.api.activateCollection.mockImplementationOnce(() => switching.promise);
    const { result } = renderHook(() => useWorkspace(f.params));
    await act(async () => {});
    act(() => result.current.setProjectValue((project) => ({ ...project, studioMode: true })));
    let activation!: Promise<void>;
    await act(async () => { activation = result.current.activateCollection('collection-b'); });
    expect(f.api.saveProject).toHaveBeenCalledExactlyOnceWith('collection-a', 'profile-a', expect.objectContaining({ studioMode: true }));
    act(() => result.current.setProjectValue((project) => ({ ...project, studioMode: false })));
    expect(result.current.project?.studioMode).toBe(true);
    await act(async () => { switching.resolve(workspace('collection-b')); await activation; });
    await act(async () => {
      result.current.setProjectValue((project) => ({ ...project, studioMode: true }));
      await f.close();
    });
    expect(f.api.saveProject).toHaveBeenLastCalledWith('collection-b', 'profile-a', expect.objectContaining({ studioMode: true }));
    expect(f.params.onWorkspaceChanging).toHaveBeenCalledTimes(1);
  });

  it('submits pending teardown work to its original API and ignores late save errors', async () => {
    const old = fixture();
    const next = fixture(workspace('new-session', 'new-profile'));
    const write = deferred<void>();
    old.api.saveProject.mockImplementationOnce(() => write.promise);
    const { result, rerender, unmount } = renderHook((params) => useWorkspace(params), { initialProps: old.params });
    await act(async () => {});
    act(() => result.current.setProjectValue((project) => ({ ...project, studioMode: true })));
    rerender(next.params);
    await act(async () => {});
    expect(old.api.saveProject).toHaveBeenCalledWith('collection-a', 'profile-a', expect.objectContaining({ studioMode: true }));
    await act(async () => { write.reject(new Error('Old session failure')); });
    expect(next.params.setActionError).not.toHaveBeenCalled();
    expect(old.params.setActionError).not.toHaveBeenCalled();
    expect(result.current.activeCollectionId).toBe('new-session');
    unmount();
  });

  it('rejects retained edit callbacks from an API session replaced during async work', async () => {
    const old = fixture();
    const next = fixture(workspace('new-session'));
    const { result, rerender } = renderHook((params) => useWorkspace(params), { initialProps: old.params });
    await act(async () => {});
    const oldEdit = result.current.setProjectValue;
    rerender(next.params);
    await act(async () => {});
    act(() => oldEdit((project) => ({ ...project, studioMode: true })));
    expect(result.current.project?.studioMode).toBe(false);
    expect(old.api.saveProject).not.toHaveBeenCalled();
  });

  it('delegates native DOM unload to the main persistence authority and removes its gate on unmount', async () => {
    const f = fixture();
    const { unmount } = renderHook(() => useWorkspace(f.params));
    await act(async () => {});
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    unmount();
    const afterUnmount = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(afterUnmount);
    expect(afterUnmount.defaultPrevented).toBe(false);
  });

  it('best-effort flushes an ordinary React unmount before the timer fires', async () => {
    const f = fixture();
    const { result, unmount } = renderHook(() => useWorkspace(f.params));
    await act(async () => {});
    act(() => result.current.setProjectValue((project) => ({ ...project, studioMode: true })));
    unmount();
    await act(async () => {});
    expect(f.api.saveProject).toHaveBeenCalledWith('collection-a', 'profile-a', expect.objectContaining({ studioMode: true }));
  });
});

describe('workspace load recovery', () => {
  it('clears the error while retrying and recovers without restarting', async () => {
    const f = fixture();
    const retry = deferred<StreamWorkspace>();
    f.api.loadProject.mockRejectedValueOnce(new Error('Temporary read failure')).mockImplementationOnce(() => retry.promise);
    const { result } = renderHook(() => useWorkspace(f.params));
    await act(async () => {});
    expect(result.current.loadingError).toBe('Temporary read failure');
    act(() => result.current.retryLoad());
    expect(result.current.loadingError).toBe('');
    expect(result.current.project).toBeNull();
    await act(async () => { retry.resolve(workspace()); });
    expect(result.current.project).not.toBeNull();
    expect(f.api.saveProject).not.toHaveBeenCalled();
  });

  it('ignores superseded, replaced-session, and unmounted load responses', async () => {
    const f = fixture();
    const first = deferred<StreamWorkspace>();
    const second = deferred<StreamWorkspace>();
    f.api.loadProject.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const next = fixture(workspace('current-session'));
    const { result, rerender, unmount } = renderHook((params) => useWorkspace(params), { initialProps: f.params });
    act(() => result.current.retryLoad());
    await act(async () => { first.reject(new Error('Stale failure')); });
    expect(result.current.loadingError).toBe('');
    rerender(next.params);
    await act(async () => {});
    await act(async () => { second.resolve(workspace('stale-session')); });
    expect(result.current.activeCollectionId).toBe('current-session');
    unmount();
    expect(f.params.setActionError).not.toHaveBeenCalled();
  });
});

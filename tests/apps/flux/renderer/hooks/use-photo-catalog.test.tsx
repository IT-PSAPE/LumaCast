import { StrictMode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '@lumacast/photo-model';
import type { DesktopAPI } from '../../../../../apps/flux/shared/desktop-api';
import type { PhotoCommand } from '../../../../../apps/flux/shared/photo-command';
import { usePhotoCatalog } from '../../../../../apps/flux/renderer/hooks/use-photo-catalog';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function snapshot(...selection: string[]): AppState {
  return { photos: [], selection, jobs: [], activity: [] };
}

function fakeApi() {
  const command = vi.fn<PhotoCommand>().mockResolvedValue(snapshot());
  const listeners = new Set<() => void>();
  const unsubscribe = vi.fn();
  const settings = { enabled: false, roots: [], configPath: '', clientConfig: '' };
  const api: DesktopAPI = {
    platform: 'darwin',
    command,
    chooseImport: vi.fn(async () => []),
    chooseDirectory: vi.fn(async () => null),
    chooseRelink: vi.fn(async () => null),
    preview: vi.fn(async () => ''),
    assetUrl: () => '',
    pathsForFiles: () => [],
    onChange: vi.fn((listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); unsubscribe(); };
    }),
    onMenuCommand: () => () => {},
    settings: async () => settings,
    updateSettings: async () => settings,
  };
  return {
    api, command, unsubscribe,
    change: () => { for (const listener of listeners) listener(); },
    readCount: () => command.mock.calls.filter(([name]) => name === 'get_app_state').length,
  };
}

afterEach(cleanup);

describe('usePhotoCatalog', () => {
  it('recovers initial failure and retains a useful snapshot when a later read fails', async () => {
    const fake = fakeApi();
    const initial = deferred<AppState>();
    fake.command.mockReturnValueOnce(initial.promise);
    const { result } = renderHook(() => usePhotoCatalog(fake.api));
    expect(result.current.status).toBe('loading');
    expect(result.current.getSnapshot()).toBeNull();
    await act(async () => initial.reject(new Error('Library unavailable')));
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Library unavailable');

    const recovered = snapshot('recovered');
    fake.command.mockResolvedValueOnce(recovered);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.state).toBe(recovered);
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
    fake.command.mockRejectedValueOnce(new Error('Refresh unavailable'));
    await act(async () => { await expect(result.current.refresh()).rejects.toThrow('Refresh unavailable'); });
    expect(result.current.state).toBe(recovered);
    expect(result.current.getSnapshot()).toBe(recovered);
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBe('Refresh unavailable');
    fake.command.mockResolvedValueOnce(snapshot('retry'));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.state.selection).toEqual(['retry']);
    expect(result.current.error).toBeNull();
  });

  it.each(['resolve', 'reject'] as const)('ignores an obsolete initial %s after a newer successful read', async (outcome) => {
    const fake = fakeApi();
    const old = deferred<AppState>();
    fake.command.mockReturnValueOnce(old.promise);
    const { result } = renderHook(() => usePhotoCatalog(fake.api));
    const latest = snapshot('latest');
    fake.command.mockResolvedValueOnce(latest);
    act(() => fake.change());
    await waitFor(() => expect(result.current.state).toBe(latest));
    await act(async () => {
      if (outcome === 'resolve') old.resolve(snapshot('obsolete'));
      else old.reject(new Error('Obsolete failure'));
    });
    expect(result.current.state).toBe(latest);
    expect(result.current.getSnapshot()).toBe(latest);
    expect(result.current.error).toBeNull();
  });

  it('keeps the latest failure authoritative when an older read succeeds afterward', async () => {
    const fake = fakeApi();
    const old = deferred<AppState>();
    fake.command.mockReturnValueOnce(old.promise);
    const { result } = renderHook(() => usePhotoCatalog(fake.api));
    fake.command.mockRejectedValueOnce(new Error('Latest failure'));
    act(() => fake.change());
    await waitFor(() => expect(result.current.error).toBe('Latest failure'));
    await act(async () => old.resolve(snapshot('obsolete')));
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Latest failure');
    expect(result.current.getSnapshot()).toBeNull();
  });

  it('rejects stale imperative refresh results and keeps only the canonical snapshot available', async () => {
    const fake = fakeApi();
    const { result } = renderHook(() => usePhotoCatalog(fake.api));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const old = deferred<AppState>();
    fake.command.mockReturnValueOnce(old.promise);
    let oldResult!: Promise<AppState | Error>;
    act(() => { oldResult = result.current.refresh().catch((error: Error) => error); });
    const latest = snapshot('latest');
    fake.command.mockResolvedValueOnce(latest);
    await act(async () => { await result.current.refresh(); });
    await act(async () => old.resolve(snapshot('obsolete')));
    expect(await oldResult).toBeInstanceOf(Error);
    expect(result.current.getSnapshot()).toBe(latest);
    expect(result.current.state).toBe(latest);
    expect(result.current.error).toBeNull();
  });

  it('retires old callbacks and pending reads even when the same API returns after replacement', async () => {
    const first = fakeApi();
    const replacement = fakeApi();
    const pending = deferred<AppState>();
    first.command.mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(({ api }) => usePhotoCatalog(api), { initialProps: { api: first.api } });
    const old = result.current;
    const oldListener = vi.mocked(first.api.onChange).mock.calls[0][0];
    rerender({ api: replacement.api });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    first.command.mockResolvedValueOnce(snapshot('new-session'));
    rerender({ api: first.api });
    await waitFor(() => expect(result.current.state.selection).toEqual(['new-session']));
    const calls = first.command.mock.calls.length;
    await act(async () => {
      oldListener();
      await expect(old.refresh()).rejects.toThrow('no longer active');
      await expect(old.run('set_selection', { ids: ['obsolete'] })).rejects.toThrow('no longer active');
      pending.reject(new Error('Old session failure'));
    });
    expect(first.command).toHaveBeenCalledTimes(calls);
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(old.getSnapshot()).toBeNull();
    expect(result.current.state.selection).toEqual(['new-session']);
    expect(result.current.error).toBeNull();
  });

  it('isolates StrictMode effect lifetimes and unsubscribes when unmounted', async () => {
    const fake = fakeApi();
    const old = deferred<AppState>();
    const current = deferred<AppState>();
    fake.command.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const { result, unmount } = renderHook(() => usePhotoCatalog(fake.api), { wrapper: StrictMode });
    expect(fake.readCount()).toBe(2);
    await act(async () => current.resolve(snapshot('current')));
    await act(async () => old.resolve(snapshot('obsolete')));
    expect(result.current.state.selection).toEqual(['current']);
    const callbacks = result.current;
    unmount();
    expect(fake.unsubscribe).toHaveBeenCalledTimes(2);
    const calls = fake.command.mock.calls.length;
    await expect(callbacks.refresh()).rejects.toThrow('no longer active');
    await expect(callbacks.run('set_selection', { ids: [] })).rejects.toThrow('no longer active');
    expect(callbacks.getSnapshot()).toBeNull();
    expect(fake.command).toHaveBeenCalledTimes(calls);
  });

  it('does not let an old mutation completion refresh or alter echo suppression in a replacement session', async () => {
    const first = fakeApi();
    const replacement = fakeApi();
    const { result, rerender } = renderHook(({ api }) => usePhotoCatalog(api), { initialProps: { api: first.api } });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const mutation = deferred<void>();
    first.command.mockReturnValueOnce(mutation.promise);
    let oldRun!: Promise<void>;
    act(() => { oldRun = result.current.run('set_selection', { ids: ['old'] }); });
    rerender({ api: replacement.api });
    await waitFor(() => expect(replacement.readCount()).toBe(1));
    await act(async () => { mutation.resolve(); await oldRun; });
    expect(first.readCount()).toBe(1);
    act(() => replacement.change());
    await waitFor(() => expect(replacement.readCount()).toBe(2));
    expect(result.current.error).toBeNull();
  });

  it('suppresses command echoes, awaits its read, and accepts external changes during that read', async () => {
    const fake = fakeApi();
    const { result } = renderHook(() => usePhotoCatalog(fake.api));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const mutation = deferred<void>();
    const followup = deferred<AppState>();
    fake.command.mockReturnValueOnce(mutation.promise).mockReturnValueOnce(followup.promise);
    let settled = false;
    let run!: Promise<void>;
    act(() => { run = result.current.run('set_selection', { ids: ['local'] }).then(() => { settled = true; }); });
    act(() => fake.change());
    expect(fake.readCount()).toBe(1);
    await act(async () => mutation.resolve());
    expect(fake.readCount()).toBe(2);
    expect(settled).toBe(false);
    const external = snapshot('external');
    fake.command.mockResolvedValueOnce(external);
    act(() => fake.change());
    await waitFor(() => expect(result.current.state).toBe(external));
    await act(async () => { followup.resolve(snapshot('stale-local')); await run; });
    expect(settled).toBe(true);
    expect(fake.readCount()).toBe(3);
    expect(result.current.getSnapshot()).toBe(external);
    expect(result.current.error).toBeNull();
  });

  it('keeps echoes suppressed while another local mutation is still pending', async () => {
    const fake = fakeApi();
    const { result } = renderHook(() => usePhotoCatalog(fake.api));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const first = deferred<void>();
    const second = deferred<void>();
    fake.command.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    let runFirst!: Promise<void>;
    let runSecond!: Promise<void>;
    act(() => {
      runFirst = result.current.run('set_selection', { ids: ['one'] });
      runSecond = result.current.run('set_selection', { ids: ['two'] });
    });
    await act(async () => { first.resolve(); await runFirst; });
    expect(fake.readCount()).toBe(2);
    act(() => fake.change());
    expect(fake.readCount()).toBe(2);
    await act(async () => { second.resolve(); await runSecond; });
    expect(fake.readCount()).toBe(3);
    act(() => fake.change());
    await waitFor(() => expect(fake.readCount()).toBe(4));
  });

  it.each(['success', 'failure'] as const)('preserves the original mutation %s when the follow-up refresh fails', async (outcome) => {
    const fake = fakeApi();
    const { result } = renderHook(() => usePhotoCatalog(fake.api));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const mutationError = new Error('Original mutation failure');
    const imported = { imported: ['one'], errors: [] };
    if (outcome === 'success') fake.command.mockResolvedValueOnce(imported);
    else fake.command.mockRejectedValueOnce(mutationError);
    fake.command.mockRejectedValueOnce(new Error('Follow-up read failure'));
    await act(async () => {
      const run = result.current.run('import_photos', { paths: ['/photos/one.jpg'] });
      if (outcome === 'success') expect(await run).toBe(imported);
      else await expect(run).rejects.toBe(mutationError);
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBe('Follow-up read failure');
  });
});

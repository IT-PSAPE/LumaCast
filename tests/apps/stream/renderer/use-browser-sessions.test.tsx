import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toRuntimeSource, type RuntimeSource } from '../../../../apps/stream/renderer/source-runtime';
import { useBrowserSessions } from '../../../../apps/stream/renderer/features/capture/use-browser-sessions';
import type { StreamAPI, StreamSource } from '../../../../apps/stream/shared/desktop-api';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function browserSource(id: string, url = 'https://example.test', overrides: Partial<StreamSource> = {}): StreamSource {
  return {
    id,
    name: id,
    kind: 'browser',
    url,
    visible: true,
    muted: false,
    volume: 1,
    transform: { x: 0, y: 0, width: 100, height: 100 },
    ...overrides,
  } as StreamSource;
}

function runtimeSource(source: StreamSource, viewport = { width: 1280, height: 720 }): RuntimeSource {
  return toRuntimeSource(source, viewport);
}

function makeApi(overrides: Partial<Pick<StreamAPI, 'createBrowserSource' | 'closeBrowserSource' | 'setBrowserSourceActivity'>> = {}): StreamAPI {
  return {
    createBrowserSource: vi.fn(async () => undefined),
    closeBrowserSource: vi.fn(async () => undefined),
    setBrowserSourceActivity: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as StreamAPI;
}

function params(api: StreamAPI, sources: readonly RuntimeSource[], options: {
  active?: ReadonlySet<string>;
  playback?: ReadonlySet<string>;
  onError?: (message: string) => void;
  onSourceStatus?: (id: string, status: { state: 'starting' | 'ready' | 'unavailable'; message?: string }) => void;
} = {}) {
  return {
    api,
    sources,
    activeSourceIds: options.active ?? new Set<string>(),
    playbackSourceIds: options.playback ?? new Set<string>(),
    defaultViewport: { width: 1920, height: 1080 },
    onError: options.onError ?? vi.fn(),
    onSourceStatus: options.onSourceStatus,
  };
}

afterEach(() => cleanup());

describe('useBrowserSessions', () => {
  it('creates one session for canonical URL aliases and binds the historical viewport', async () => {
    const api = makeApi();
    const first = runtimeSource(browserSource('browser-one', 'HTTPS://EXAMPLE.TEST:443/'));
    const alias = runtimeSource(browserSource('browser-two', 'https://example.test/'));
    expect(first.id).toBe(alias.id);
    const { result } = renderHook(() => useBrowserSessions(params(api, [first, alias], { active: new Set([first.id]) })));

    await waitFor(() => expect(api.createBrowserSource).toHaveBeenCalledOnce());
    expect(api.createBrowserSource).toHaveBeenCalledWith(first.id, 'https://example.test/', 1280, 720);
    expect(api.closeBrowserSource).not.toHaveBeenCalled();
    expect(result.current.reset).toBeTypeOf('function');
  });

  it('does not create an inactive graph resource, then creates and retains it through hide and deletion', async () => {
    const api = makeApi();
    const source = runtimeSource(browserSource('lazy-browser'));
    const sources = [source];
    const { rerender } = renderHook(({ current }) => useBrowserSessions(current), {
      initialProps: { current: params(api, sources) },
    });

    expect(api.createBrowserSource).not.toHaveBeenCalled();
    expect(api.setBrowserSourceActivity).not.toHaveBeenCalled();

    rerender({ current: params(api, sources, { active: new Set([source.id]) }) });
    await waitFor(() => expect(api.createBrowserSource).toHaveBeenCalledOnce());
    await waitFor(() => expect(api.setBrowserSourceActivity).toHaveBeenLastCalledWith(source.id, {
      active: true, programActive: false, resetOnEntry: false,
    }));

    rerender({ current: params(api, sources) });
    await waitFor(() => expect(api.setBrowserSourceActivity).toHaveBeenLastCalledWith(source.id, {
      active: false, programActive: false, resetOnEntry: false,
    }));
    expect(api.closeBrowserSource).not.toHaveBeenCalled();

    rerender({ current: params(api, []) });
    await waitFor(() => expect(api.closeBrowserSource).toHaveBeenCalledOnce());
  });

  it('keeps an inactive graph reference alive and updates activity for view throttling', async () => {
    const api = makeApi();
    const source = runtimeSource(browserSource('staged-browser'));
    const { rerender } = renderHook(({ current }) => useBrowserSessions(current), {
      initialProps: { current: params(api, [source], { active: new Set([source.id]) }) },
    });
    await waitFor(() => expect(api.createBrowserSource).toHaveBeenCalledOnce());

    rerender({ current: params(api, [source], { active: new Set<string>() }) });

    await waitFor(() => expect(api.setBrowserSourceActivity).toHaveBeenLastCalledWith(source.id, {
      active: false, programActive: false, resetOnEntry: false,
    }));
    expect(api.closeBrowserSource).not.toHaveBeenCalled();
    expect(api.createBrowserSource).toHaveBeenCalledOnce();
  });

  it('keeps a matching resource through an outgoing-to-Program handoff', async () => {
    const api = makeApi();
    const outgoing = runtimeSource(browserSource('outgoing-browser'));
    const program = runtimeSource(browserSource('program-browser'));
    expect(program.id).toBe(outgoing.id);
    const { rerender } = renderHook(({ current }) => useBrowserSessions(current), {
      initialProps: {
        current: params(api, [outgoing], { active: new Set([outgoing.id]), playback: new Set([outgoing.id]) }),
      },
    });
    await waitFor(() => expect(api.createBrowserSource).toHaveBeenCalledOnce());
    const callsBeforeHandoff = vi.mocked(api.setBrowserSourceActivity).mock.calls.length;

    rerender({ current: params(api, [program], { active: new Set([program.id]), playback: new Set([program.id]) }) });

    expect(api.closeBrowserSource).not.toHaveBeenCalled();
    expect(api.createBrowserSource).toHaveBeenCalledOnce();
    expect(api.setBrowserSourceActivity).toHaveBeenCalledTimes(callsBeforeHandoff);
  });

  it('closes a page when its last graph reference is removed', async () => {
    const api = makeApi();
    const source = runtimeSource(browserSource('removed-browser'));
    const { rerender } = renderHook(({ current }) => useBrowserSessions(current), {
      initialProps: { current: params(api, [source], { active: new Set([source.id]) }) },
    });
    await waitFor(() => expect(api.createBrowserSource).toHaveBeenCalledOnce());

    rerender({ current: params(api, []) });

    await waitFor(() => expect(api.closeBrowserSource).toHaveBeenCalledOnce());
    expect(api.closeBrowserSource).toHaveBeenCalledWith(source.id);
  });

  it('forwards reset-on-entry with Program activity', async () => {
    const api = makeApi();
    const source = runtimeSource(browserSource('reset-browser', undefined, { restartPlaybackWhenActive: true }));
    const { rerender } = renderHook(({ current }) => useBrowserSessions(current), {
      initialProps: { current: params(api, [source], { active: new Set([source.id]) }) },
    });
    await waitFor(() => expect(api.createBrowserSource).toHaveBeenCalledOnce());

    rerender({ current: params(api, [source], { active: new Set([source.id]), playback: new Set([source.id]) }) });

    await waitFor(() => expect(api.setBrowserSourceActivity).toHaveBeenLastCalledWith(source.id, {
      active: true, programActive: true, resetOnEntry: true,
    }));
  });

  it('closes a browser whose create completes after teardown', async () => {
    const create = deferred<void>();
    const api = makeApi({ createBrowserSource: vi.fn(() => create.promise) });
    const source = runtimeSource(browserSource('late-browser'));
    const onSourceStatus = vi.fn();
    const { unmount } = renderHook(() => useBrowserSessions(params(api, [source], { active: new Set([source.id]), onSourceStatus })));
    await waitFor(() => expect(api.createBrowserSource).toHaveBeenCalledOnce());

    unmount();
    await act(async () => { create.resolve(); await create.promise; });

    await waitFor(() => expect(api.closeBrowserSource).toHaveBeenCalledOnce());
    expect(api.setBrowserSourceActivity).not.toHaveBeenCalled();
    expect(onSourceStatus).not.toHaveBeenCalledWith(source.id, { state: 'ready' });
  });

  it('closes a pending page immediately when graph ownership is released', async () => {
    const create = deferred<void>();
    const api = makeApi({ createBrowserSource: vi.fn(() => create.promise) });
    const source = runtimeSource(browserSource('pending-release-browser'));
    const { rerender } = renderHook(({ current }) => useBrowserSessions(current), {
      initialProps: { current: params(api, [source], { active: new Set([source.id]) }) },
    });
    await waitFor(() => expect(api.createBrowserSource).toHaveBeenCalledOnce());

    rerender({ current: params(api, []) });

    expect(api.closeBrowserSource).toHaveBeenCalledOnce();
    expect(api.closeBrowserSource).toHaveBeenCalledWith(source.id);
    expect(api.setBrowserSourceActivity).not.toHaveBeenCalled();
    create.resolve();
  });

  it('waits for pending-create cancellation before recreating a hidden and reshown same ID', async () => {
    const firstCreate = deferred<void>();
    const close = deferred<void>();
    const source = runtimeSource(browserSource('reshown-browser'));
    const sources = [source];
    const activeSourceIds = new Set([source.id]);
    const createBrowserSource = vi.fn()
      .mockImplementationOnce(() => firstCreate.promise)
      .mockResolvedValue(undefined);
    const api = makeApi({
      createBrowserSource,
      closeBrowserSource: vi.fn(() => close.promise),
    });
    const { rerender } = renderHook(({ current }) => useBrowserSessions(current), {
      initialProps: { current: params(api, sources, { active: activeSourceIds }) },
    });
    await waitFor(() => expect(api.createBrowserSource).toHaveBeenCalledOnce());

    rerender({ current: params(api, []) });
    expect(api.closeBrowserSource).toHaveBeenCalledOnce();

    rerender({ current: params(api, sources, { active: activeSourceIds }) });
    firstCreate.resolve();
    await act(async () => { await firstCreate.promise; });
    expect(api.createBrowserSource).toHaveBeenCalledOnce();

    await act(async () => { close.resolve(); await close.promise; });
    await waitFor(() => expect(api.createBrowserSource).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.setBrowserSourceActivity).toHaveBeenLastCalledWith(source.id, {
      active: true, programActive: false, resetOnEntry: false,
    }));
    expect(api.closeBrowserSource).toHaveBeenCalledOnce();
  });

  it('closes the old API session before recreating after an API switch', async () => {
    const firstApi = makeApi();
    const nextApi = makeApi();
    const source = runtimeSource(browserSource('api-switch-browser'));
    const { rerender } = renderHook(({ current }) => useBrowserSessions(current), {
      initialProps: { current: params(firstApi, [source], { active: new Set([source.id]) }) },
    });
    await waitFor(() => expect(firstApi.createBrowserSource).toHaveBeenCalledOnce());

    rerender({ current: params(nextApi, [source], { active: new Set([source.id]) }) });

    await waitFor(() => expect(firstApi.closeBrowserSource).toHaveBeenCalledOnce());
    await waitFor(() => expect(nextApi.createBrowserSource).toHaveBeenCalledOnce());
    expect(firstApi.closeBrowserSource).toHaveBeenCalledWith(source.id);
  });

  it('reports only an actual create failure and marks a successful main load ready', async () => {
    const source = runtimeSource(browserSource('status-browser'));
    const loadFailure = new Error('The browser source could not load.');
    const failureApi = makeApi({ createBrowserSource: vi.fn(async () => { throw loadFailure; }) });
    const onError = vi.fn();
    const onSourceStatus = vi.fn();
    renderHook(() => useBrowserSessions(params(failureApi, [source], { active: new Set([source.id]), onError, onSourceStatus })));

    await waitFor(() => expect(onSourceStatus).toHaveBeenCalledWith(source.id, {
      state: 'unavailable', message: loadFailure.message,
    }));
    expect(onError).toHaveBeenCalledWith(loadFailure.message);

    cleanup();
    const successApi = makeApi();
    const readyStatus = vi.fn();
    renderHook(() => useBrowserSessions(params(successApi, [source], { active: new Set([source.id]), onSourceStatus: readyStatus })));
    await waitFor(() => expect(readyStatus).toHaveBeenCalledWith(source.id, { state: 'ready' }));
  });

  it('releases sessions when explicitly reset for workspace teardown', async () => {
    const api = makeApi();
    const source = runtimeSource(browserSource('workspace-browser'));
    const { result } = renderHook(() => useBrowserSessions(params(api, [source], { active: new Set([source.id]) })));
    await waitFor(() => expect(api.createBrowserSource).toHaveBeenCalledOnce());

    act(() => result.current.reset());

    await waitFor(() => expect(api.closeBrowserSource).toHaveBeenCalledOnce());
  });

  it('closes the previous generation before recreating the same ID after reset', async () => {
    const close = deferred<void>();
    const api = makeApi({ closeBrowserSource: vi.fn(() => close.promise) });
    const source = runtimeSource(browserSource('reset-same-id-browser'));
    const sources = [source];
    const activeSourceIds = new Set([source.id]);
    const { result, rerender } = renderHook(({ current }) => useBrowserSessions(current), {
      initialProps: { current: params(api, sources, { active: activeSourceIds }) },
    });
    await waitFor(() => expect(api.createBrowserSource).toHaveBeenCalledOnce());

    act(() => result.current.reset());
    rerender({ current: params(api, sources, { active: activeSourceIds }) });
    await waitFor(() => expect(api.closeBrowserSource).toHaveBeenCalledOnce());
    expect(api.createBrowserSource).toHaveBeenCalledOnce();

    await act(async () => { close.resolve(); await close.promise; });

    await waitFor(() => expect(api.createBrowserSource).toHaveBeenCalledTimes(2));
    expect(api.closeBrowserSource).toHaveBeenCalledOnce();
    await waitFor(() => expect(api.setBrowserSourceActivity).toHaveBeenLastCalledWith(source.id, {
      active: true, programActive: false, resetOnEntry: false,
    }));
  });
});

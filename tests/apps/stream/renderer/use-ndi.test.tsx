import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNdi } from '../../../../apps/stream/renderer/application/use-ndi';
import { createDefaultProject, type StreamSource } from '../../../../apps/stream/shared/desktop-api';
import type { NdiFrame, StreamNdiAPI } from '../../../../apps/stream/shared/ndi';
import type { UseCaptureResult } from '../../../../apps/stream/renderer/features/capture/use-capture';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
class Track { stop = vi.fn(); }
class Stream {
  tracks = [new Track()];
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks; }
  addTrack(track: Track) { this.tracks.push(track); }
}
const contexts: FakeContext[] = [];
const nodes: FakeNode[] = [];
class FakeNode {
  connect = vi.fn(); disconnect = vi.fn();
  port = { close: vi.fn(), onmessage: null as null | ((event: { data: unknown }) => void) };
  constructor() { nodes.push(this); }
}
class FakeContext {
  currentTime = 0;
  destination = {};
  audioWorklet = { addModule: vi.fn(async () => {}) };
  close = vi.fn(async () => {});
  resume = vi.fn(async () => {});
  createMediaStreamSource = vi.fn(() => new FakeNode());
  createMediaStreamDestination = vi.fn(() => ({ stream: new Stream() }));
  constructor() { contexts.push(this); }
}
const drawing = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(16) })),
  putImageData: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
const streams: Stream[] = [];
beforeEach(() => {
  contexts.length = 0; nodes.length = 0; streams.length = 0;
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('AudioWorkletNode', FakeNode);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(drawing as never);
  Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', { configurable: true, value: vi.fn(() => {
    const stream = new Stream(); streams.push(stream); return stream as unknown as MediaStream;
  }) });
});
afterEach(() => { cleanup(); Reflect.deleteProperty(HTMLCanvasElement.prototype, 'captureStream'); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const api: StreamNdiAPI = {
    discover: vi.fn(async () => []), startReceive: vi.fn(async () => 'receive'),
    readFrame: vi.fn(() => new Promise<NdiFrame | null>(() => {})), stopReceive: vi.fn(async () => {}),
    startSend: vi.fn(async () => 'send'), sendVideo: vi.fn(async () => {}),
    sendAudio: vi.fn(async () => {}), stopSend: vi.fn(async () => {}),
  };
  const capture = { attachRuntime: vi.fn(async () => {}), stopRuntime: vi.fn(),
    ensureMixer: vi.fn(() => ({ destinationFor: vi.fn(() => ({ stream: new Stream() })) })) } as unknown as UseCaptureResult;
  const source = { id: 'ndi-runtime', kind: 'ndi', name: 'Camera', ndiSourceName: 'Camera', captureAudioEnabled: false } as StreamSource;
  const options = { api, capture, sources: [source], activeIds: new Set([source.id]),
    programCanvas: { current: document.createElement('canvas') }, project: createDefaultProject(), onError: vi.fn() };
  return { api, capture, source, options };
}

describe('NDI resource lifecycle', () => {
  it('closes a late receiver without attaching it after the source is removed', async () => {
    const { api, capture, options } = setup();
    const pending = deferred<string>(); vi.mocked(api.startReceive).mockReturnValue(pending.promise);
    const view = renderHook((props) => useNdi(props), { initialProps: options });
    expect(api.startReceive).toHaveBeenCalledWith({ name: 'Camera', urlAddress: undefined }, false);
    view.rerender({ ...options, activeIds: new Set() });
    await act(async () => { pending.resolve('late'); await pending.promise; });
    expect(api.stopReceive).toHaveBeenCalledWith('late');
    expect(capture.attachRuntime).not.toHaveBeenCalled();
  });

  it('waits for an obsolete native receiver to stop before starting its replacement', async () => {
    const { api, capture, source, options } = setup();
    vi.mocked(api.startReceive).mockResolvedValueOnce('old-receiver').mockResolvedValueOnce('new-receiver');
    const stop = deferred<void>();
    vi.mocked(api.stopReceive).mockReturnValueOnce(stop.promise);
    const view = renderHook((props) => useNdi(props), { initialProps: options });
    await waitFor(() => expect(capture.attachRuntime).toHaveBeenCalledTimes(1));

    const replacement = { ...source, id: 'replacement-runtime', ndiSourceName: 'Camera 2' };
    view.rerender({ ...options, sources: [replacement], activeIds: new Set([replacement.id]) });
    expect(api.stopReceive).toHaveBeenCalledWith('old-receiver');
    expect(api.startReceive).toHaveBeenCalledTimes(1);

    await act(async () => { stop.resolve(); await stop.promise; });
    await waitFor(() => expect(api.startReceive).toHaveBeenCalledTimes(2));
    expect(api.startReceive).toHaveBeenNthCalledWith(2, { name: 'Camera 2', urlAddress: undefined }, false);
  });

  it('waits for a pending native receiver creation and its teardown before replacement', async () => {
    const { api, capture, source, options } = setup();
    const creation = deferred<string>();
    const stop = deferred<void>();
    vi.mocked(api.startReceive).mockReturnValueOnce(creation.promise).mockResolvedValueOnce('new-receiver');
    vi.mocked(api.stopReceive).mockReturnValueOnce(stop.promise);
    const view = renderHook((props) => useNdi(props), { initialProps: options });

    const replacement = { ...source, id: 'replacement-runtime', ndiSourceName: 'Camera 2' };
    view.rerender({ ...options, sources: [replacement], activeIds: new Set([replacement.id]) });
    expect(api.startReceive).toHaveBeenCalledTimes(1);
    expect(api.stopReceive).not.toHaveBeenCalled();

    await act(async () => { creation.resolve('old-receiver'); await creation.promise; });
    await waitFor(() => expect(api.stopReceive).toHaveBeenCalledWith('old-receiver'));
    expect(api.startReceive).toHaveBeenCalledTimes(1);
    await act(async () => { stop.resolve(); await stop.promise; });
    await waitFor(() => expect(api.startReceive).toHaveBeenCalledTimes(2));
    expect(capture.attachRuntime).toHaveBeenCalledTimes(1);
  });

  it('keeps failed receivers idle until retry and clears errors when removed', async () => {
    const { api, capture, options } = setup();
    vi.mocked(api.readFrame).mockRejectedValueOnce(new Error('Native host stopped'));
    const view = renderHook((props) => useNdi(props), { initialProps: options });
    await waitFor(() => expect(view.result.current.sourceErrors['ndi-runtime']).toContain('Native host stopped'));
    expect(streams[0].tracks[0].stop).toHaveBeenCalled();
    expect(capture.stopRuntime).toHaveBeenCalledWith('ndi-runtime');
    view.rerender({ ...options, sources: [...options.sources] });
    expect(api.startReceive).toHaveBeenCalledTimes(1);
    act(() => view.result.current.retrySource('ndi-runtime'));
    await waitFor(() => expect(api.startReceive).toHaveBeenCalledTimes(2));
    view.rerender({ ...options, activeIds: new Set() });
    await waitFor(() => expect(view.result.current.sourceErrors).toEqual({}));
  });

  it('waits for a cancelled pending output before permitting another output', async () => {
    const { api, options } = setup(); options.sources = [];
    const pending = deferred<string>();
    vi.mocked(api.startSend).mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useNdi(options));
    let old!: Promise<void>;
    act(() => { old = result.current.startSending('Old', 1); });
    let stopped!: Promise<void>;
    act(() => { stopped = result.current.stopSending(); });
    expect(result.current.stopping).toBe(true);
    await act(async () => { await result.current.startSending('Too early', 2); });
    expect(api.startSend).toHaveBeenCalledTimes(1);
    await act(async () => { pending.reject(new Error('old failure')); await old; await stopped; });
    await act(async () => { await result.current.startSending('New', 2); });
    expect(result.current.sending).toBe(true);
    expect(api.stopSend).not.toHaveBeenCalledWith('send');
    expect(options.onError).not.toHaveBeenCalled();
  });

  it('bounds audio and video submissions while a native send is pending and cleans up on stop', async () => {
    const { api, options } = setup(); options.sources = [];
    const video = deferred<void>(); const audio = deferred<void>();
    vi.mocked(api.sendVideo).mockReturnValue(video.promise);
    vi.mocked(api.sendAudio).mockReturnValue(audio.promise);
    const { result, unmount } = renderHook(() => useNdi(options));
    await act(async () => { await result.current.startSending('Program', 3); });
    expect(api.sendVideo).toHaveBeenCalledTimes(1);
    const worklet = nodes[nodes.length - 1];
    act(() => { worklet.port.onmessage!({ data: { samples: 1 } }); worklet.port.onmessage!({ data: { samples: 2 } }); });
    expect(api.sendAudio).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.stopSending(); video.resolve(); audio.resolve(); });
    expect(result.current.sending).toBe(false);
    expect(worklet.disconnect).toHaveBeenCalled();
    expect(worklet.port.close).toHaveBeenCalled();
    expect(contexts[0].close).toHaveBeenCalled();
    expect(api.stopSend).toHaveBeenCalledWith('send');
    unmount();
    expect(api.stopSend).toHaveBeenCalledTimes(1);
  });

  it('keeps restart locked until native sender teardown finishes', async () => {
    const { api, options } = setup(); options.sources = [];
    const pending = deferred<void>();
    vi.mocked(api.stopSend).mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useNdi(options));
    await act(async () => { await result.current.startSending('First', 1); });
    let stopped!: Promise<void>;
    act(() => { stopped = result.current.stopSending(); });
    await act(async () => { await result.current.startSending('Too soon', 1); });
    expect(result.current.stopping).toBe(true);
    expect(api.startSend).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(); await stopped; });
    await act(async () => { await result.current.startSending('Second', 1); });
    expect(result.current.sending).toBe(true);
    expect(api.startSend).toHaveBeenCalledTimes(2);
  });
});

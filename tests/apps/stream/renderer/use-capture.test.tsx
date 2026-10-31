import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCapture, type UseCaptureParams } from '../../../../apps/stream/renderer/features/capture/use-capture';
import { createDefaultProject, type DesktopSourceOption, type StreamAPI, type StreamProject, type StreamSource } from '../../../../apps/stream/shared/desktop-api';
import { toRuntimeProject } from '../../../../apps/stream/renderer/source-runtime';
import type { RuntimeSource } from '../../../../apps/stream/renderer/source-runtime';

const mixerMock = vi.hoisted(() => {
  const instances: any[] = [];
  class FakeAudioMixerEngine {
    private ids = new Set<string>();
    add = vi.fn(async (id: string) => { this.ids.add(id); return true; });
    addMediaElement = vi.fn(async (id: string) => { this.ids.add(id); return true; });
    setSettings = vi.fn();
    setBalance = vi.fn();
    setProgramActive = vi.fn();
    setAudioMonitoring = vi.fn();
    setAudioTracks = vi.fn();
    setAudioFilters = vi.fn(() => true);
    setNoiseSuppression = vi.fn(async () => true);
    resume = vi.fn(async () => undefined);
    remove = vi.fn((id: string) => { this.ids.delete(id); });
    sourceIds = vi.fn(() => [...this.ids]);
    level = vi.fn(() => 0.4);
    setMonitoringDevice = vi.fn(async () => undefined);
    close = vi.fn(async () => undefined);

    constructor() { instances.push(this); }
  }
  return { instances, FakeAudioMixerEngine };
});

vi.mock('../../../../apps/stream/renderer/audio-mixer', () => ({
  AudioMixerEngine: mixerMock.FakeAudioMixerEngine,
}));

class FakeTrack extends EventTarget {
  readyState: MediaStreamTrackState = 'live';
  readonly stop = vi.fn(() => {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  });
  readonly clone = vi.fn(() => new FakeTrack(this.kind, this.label));

  constructor(readonly kind: 'audio' | 'video', readonly label = `${kind} track`) { super(); }
}

class FakeMediaStream {
  constructor(private readonly tracks: FakeTrack[]) {}
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio'); }
}

function fakeStream(...tracks: FakeTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((track) => track.kind === 'video'),
    getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
  } as unknown as MediaStream;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeSource(kind: 'camera' | 'media', overrides: Partial<StreamSource> = {}): StreamSource {
  return {
    id: `source-${kind}`,
    name: kind,
    kind,
    visible: true,
    muted: false,
    volume: 1,
    transform: { x: 0, y: 0, width: 100, height: 100 },
    ...(kind === 'media' ? { mediaKind: 'video' as const, assetId: 'asset-video', assetExtension: 'mp4' } : {}),
    ...overrides,
  } as StreamSource;
}

function makeProject(source: StreamSource | null): StreamProject {
  const project = createDefaultProject('darwin');
  project.scenes = [{ id: 'scene', name: 'Scene', sources: source ? [source] : [] }];
  project.activeSceneId = 'scene';
  project.liveSceneId = 'scene';
  project.studioMode = true;
  return project;
}

function makeBrowserSource(audioEnabled: boolean): StreamSource {
  return {
    id: 'browser-source',
    name: 'Browser',
    kind: 'browser',
    visible: true,
    muted: false,
    volume: 1,
    url: 'https://example.test',
    browserAudioEnabled: audioEnabled,
    transform: { x: 0, y: 0, width: 100, height: 100 },
  };
}

function makeApi(): StreamAPI {
  return {
    platform: 'darwin',
    loadAudioSettings: vi.fn(async () => ({ monitoringDeviceId: '' })),
    saveAudioSettings: vi.fn(async () => undefined),
    onApplicationAudioFrame: vi.fn(() => () => undefined),
    onBrowserSourceFrame: vi.fn(() => () => undefined),
    stopApplicationAudioCapture: vi.fn(async () => undefined),
  } as unknown as StreamAPI;
}

function installMediaDevices(getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>, devices: MediaDeviceInfo[] = []) {
  const mediaDevices = new EventTarget() as EventTarget & {
    enumerateDevices: ReturnType<typeof vi.fn>;
    getUserMedia: ReturnType<typeof vi.fn>;
  };
  mediaDevices.enumerateDevices = vi.fn(async () => devices);
  mediaDevices.getUserMedia = vi.fn(getUserMedia);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
  return mediaDevices;
}

function makeHookParams(source: StreamSource, options: {
  allSources?: RuntimeSource[];
  activeSourceIds?: Set<string>;
  programSourceIds?: Set<string>;
  runtimeProgramProject?: StreamProject;
  draftProject?: StreamProject;
  api?: StreamAPI;
} = {}): UseCaptureParams {
  const draftProject = options.draftProject ?? makeProject(source);
  const runtimeDraftProject = toRuntimeProject(draftProject);
  const runtimeSource = runtimeDraftProject.scenes[0]!.sources[0]!;
  const programProject = options.runtimeProgramProject ?? runtimeDraftProject;
  const allSources = options.allSources ?? [runtimeSource];
  const activeSourceIds = options.activeSourceIds ?? new Set([runtimeSource.id]);
  return {
    api: options.api ?? makeApi(),
    project: runtimeDraftProject,
    projectRef: { current: runtimeDraftProject },
    allSources,
    allSourcesRef: { current: allSources },
    programProject,
    programSourceIds: options.programSourceIds ?? new Set([runtimeSource.id]),
    retainedSourceIds: new Set(),
    liveScene: runtimeDraftProject.scenes[0]!,
    activeSourceIds,
    activeSourceIdsRef: { current: activeSourceIds },
    setActionError: vi.fn(),
    working: false,
    setWorking: vi.fn(),
    displayCaptureSystemAudio: false,
    imageElements: { current: new Map() },
    closeSourceMenu: vi.fn(),
    addToActiveScene: vi.fn((next) => next),
    updateSource: vi.fn(),
  };
}

describe('useCapture runtime ownership and Program audio routing', () => {
  let mediaDevices: ReturnType<typeof installMediaDevices> | null = null;
  let originalMediaDevices: PropertyDescriptor | undefined;

  beforeEach(() => {
    mixerMock.instances.length = 0;
    originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
    else Reflect.deleteProperty(navigator, 'mediaDevices');
    mediaDevices = null;
  });

  it('lazily restores a visible camera and publishes its ready status', async () => {
    const source = makeSource('camera');
    const params = makeHookParams(source);
    const runtimeSource = params.allSources[0]!;
    const track = new FakeTrack('video', 'Camera 1');
    const stream = fakeStream(track);
    mediaDevices = installMediaDevices(async () => stream);

    const { result } = renderHook(() => useCapture(params));

    await waitFor(() => expect(result.current.runtimes.current.get(runtimeSource.id)).toBe(stream));
    expect(result.current.sourceStatuses[runtimeSource.id]).toEqual({ state: 'ready' });
    expect(mixerMock.instances).toHaveLength(0);
    expect(mediaDevices.getUserMedia).toHaveBeenCalledOnce();
  });

  it('restores a camera with its explicitly selected audio input and registers the combined route', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const source = makeSource('camera', { captureAudioEnabled: true, audioDeviceId: 'audio-usb-1' });
    const params = makeHookParams(source);
    const runtimeSource = params.allSources[0]!;
    const video = fakeStream(new FakeTrack('video', 'Webcam'));
    const audio = fakeStream(new FakeTrack('audio', 'Webcam microphone'));
    mediaDevices = installMediaDevices(async () => mediaDevices!.getUserMedia.mock.calls.length === 1 ? video : audio);
    const { result } = renderHook(() => useCapture(params));

    await waitFor(() => expect(result.current.runtimes.current.get(runtimeSource.id)?.getAudioTracks()).toHaveLength(1));
    const stream = result.current.runtimes.current.get(runtimeSource.id)!;
    expect(stream.getVideoTracks()).toHaveLength(1);
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    expect(mediaDevices.getUserMedia.mock.calls[1]?.[0]).toEqual({
      video: false,
      audio: { deviceId: { exact: 'audio-usb-1' }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    expect(mixerMock.instances[0]?.add).toHaveBeenCalledWith(runtimeSource.id, stream, expect.objectContaining({ programActive: false }));
    await waitFor(() => expect(mixerMock.instances[0]?.setProgramActive).toHaveBeenCalledWith(runtimeSource.id, true));
  });

  it('keeps camera video ready and reports a denied audio input without creating an audio route', async () => {
    const source = makeSource('camera', { captureAudioEnabled: true, audioDeviceId: 'audio-usb-1' });
    const setActionError = vi.fn();
    const params = { ...makeHookParams(source), setActionError };
    const runtimeSource = params.allSources[0]!;
    const video = fakeStream(new FakeTrack('video', 'Webcam'));
    mediaDevices = installMediaDevices(async () => video);
    mediaDevices.getUserMedia.mockResolvedValueOnce(video).mockRejectedValueOnce(new Error('Audio input permission denied'));
    const { result } = renderHook(() => useCapture(params));

    await waitFor(() => expect(result.current.runtimes.current.get(runtimeSource.id)).toBe(video));
    expect(result.current.sourceStatuses[runtimeSource.id]).toEqual({ state: 'ready' });
    expect(mixerMock.instances).toHaveLength(0);
    await waitFor(() => expect(setActionError).toHaveBeenCalledWith(expect.stringContaining('Video remains active')));
  });

  it('drops the camera audio route when audio is disabled while keeping the video runtime', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const source = makeSource('camera', { captureAudioEnabled: true, audioDeviceId: 'audio-usb-1' });
    const api = makeApi();
    const params = makeHookParams(source, { api, programSourceIds: new Set<string>() });
    const oldRuntimeSource = params.allSources[0]!;
    const video = fakeStream(new FakeTrack('video', 'Webcam'));
    const audio = fakeStream(new FakeTrack('audio', 'Webcam microphone'));
    mediaDevices = installMediaDevices(async () => mediaDevices!.getUserMedia.mock.calls.length === 1 ? video : audio);
    const { result, rerender } = renderHook(({ current }: { current: UseCaptureParams }) => useCapture(current), { initialProps: { current: params } });

    await waitFor(() => expect(result.current.runtimes.current.get(oldRuntimeSource.id)?.getAudioTracks()).toHaveLength(1));
    const oldStream = result.current.runtimes.current.get(oldRuntimeSource.id)!;
    const audioTrack = oldStream.getAudioTracks()[0] as unknown as FakeTrack;
    const editedSource = { ...source, captureAudioEnabled: false };
    await act(async () => {
      await result.current.updateCameraAudioSettings(oldRuntimeSource, { captureAudioEnabled: false, audioDeviceId: source.audioDeviceId });
    });
    const nextParams = makeHookParams(editedSource, { api, programSourceIds: new Set<string>() });
    const nextRuntimeSource = nextParams.allSources[0]!;
    expect(result.current.runtimes.current.get(nextRuntimeSource.id)?.getVideoTracks()).toHaveLength(1);
    expect(mixerMock.instances[0]?.sourceIds()).toContain(oldRuntimeSource.id);

    rerender({ current: nextParams });
    await waitFor(() => expect(audioTrack.stop).toHaveBeenCalledOnce());
    expect(result.current.runtimes.current.get(nextRuntimeSource.id)?.getAudioTracks()).toHaveLength(0);
    expect(mixerMock.instances[0]?.sourceIds()).not.toContain(oldRuntimeSource.id);
  });

  it('disables window system audio by cloning its video track and removing the route after commit', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const source: StreamSource = {
      id: 'window-source', name: 'Window', kind: 'window', visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: 320, height: 240 }, captureId: 'window:1', cursorMode: 'motion', captureAudioEnabled: true,
    };
    const api = makeApi();
    const params = makeHookParams(source, { api, programSourceIds: new Set<string>() });
    const oldRuntimeSource = params.allSources[0]!;
    const videoTrack = new FakeTrack('video', 'Window video');
    const audioTrack = new FakeTrack('audio', 'System audio');
    const stream = fakeStream(videoTrack, audioTrack);
    mediaDevices = installMediaDevices(async () => fakeStream());
    const { result, rerender } = renderHook(({ current }: { current: UseCaptureParams }) => useCapture(current), { initialProps: { current: params } });

    await act(async () => { await result.current.attachRuntime(oldRuntimeSource, stream); });
    await act(async () => { await result.current.toggleDesktopCaptureAudio(oldRuntimeSource, false); });
    const nextSource = { ...source, captureAudioEnabled: false };
    const nextParams = makeHookParams(nextSource, { api, programSourceIds: new Set<string>() });
    const nextRuntimeSource = nextParams.allSources[0]!;
    expect(result.current.runtimes.current.get(nextRuntimeSource.id)?.getVideoTracks()).toHaveLength(1);
    expect(result.current.runtimes.current.get(nextRuntimeSource.id)?.getAudioTracks()).toHaveLength(0);

    rerender({ current: nextParams });
    await waitFor(() => expect(audioTrack.stop).toHaveBeenCalledOnce());
    expect(mixerMock.instances[0]?.sourceIds()).not.toContain(oldRuntimeSource.id);
    expect(result.current.runtimes.current.get(nextRuntimeSource.id)?.getVideoTracks()).toHaveLength(1);
  });

  it('requests system audio by default for a new window capture', async () => {
    const option: DesktopSourceOption = { id: 'window:1', name: 'Editor', kind: 'window', thumbnail: '' };
    const api = {
      ...makeApi(),
      listDesktopSources: vi.fn(async () => [option]),
      prepareDesktopCapture: vi.fn(async () => undefined),
    } as unknown as StreamAPI;
    const params = { ...makeHookParams(makeSource('media'), { api }), displayCaptureSystemAudio: true };
    const videoTrack = new FakeTrack('video', 'Editor');
    const audioTrack = new FakeTrack('audio', 'System audio');
    const stream = fakeStream(videoTrack, audioTrack);
    mediaDevices = installMediaDevices(async () => fakeStream());
    const getDisplayMedia = vi.fn(async () => stream);
    Object.assign(mediaDevices, { getDisplayMedia });
    const { result } = renderHook(() => useCapture(params));

    await act(async () => { await result.current.openCapturePicker('window'); });
    await act(async () => { await result.current.addDesktopCapture(option); });

    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: true }));
    expect(api.prepareDesktopCapture).toHaveBeenCalledWith(option.id, true);
    const capturedSource = (params.addToActiveScene as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as StreamSource;
    expect(capturedSource).toMatchObject({ kind: 'window', captureAudioEnabled: true });
    expect(mixerMock.instances[0]?.add).toHaveBeenCalledWith(expect.any(String), stream, expect.any(Object));
  });

  it('requires an explicit audio input when no unique camera pair exists', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const source = makeSource('media');
    const params = makeHookParams(source);
    const permissionStream = fakeStream(new FakeTrack('video', 'Permission camera'));
    const cameraStream = fakeStream(new FakeTrack('video', 'Webcam'));
    const audioStream = fakeStream(new FakeTrack('audio', 'USB microphone'));
    const devices = [
      { kind: 'videoinput', deviceId: 'video-usb-1', label: 'Webcam', groupId: 'video-group' },
      { kind: 'audioinput', deviceId: 'default', label: 'Default microphone', groupId: '' },
      { kind: 'audioinput', deviceId: 'audio-usb-1', label: 'USB microphone', groupId: 'audio-group' },
    ] as MediaDeviceInfo[];
    mediaDevices = installMediaDevices(async () => permissionStream, devices);
    mediaDevices.getUserMedia.mockResolvedValueOnce(permissionStream)
      .mockResolvedValueOnce(cameraStream)
      .mockResolvedValueOnce(audioStream);
    const { result } = renderHook(() => useCapture(params));

    await act(async () => { await result.current.openInputDevicePicker('camera'); });
    expect(result.current.cameraAudioEnabled).toBe(true);
    const camera = result.current.inputDeviceOptions.camera[0]!;
    await act(async () => { await result.current.chooseInputDevice(camera); });
    expect(mediaDevices.getUserMedia).toHaveBeenCalledOnce();
    expect(params.addToActiveScene).not.toHaveBeenCalled();

    act(() => result.current.setCameraAudioDeviceId('audio-usb-1'));
    await act(async () => { await result.current.chooseInputDevice(camera); });
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(3);
    expect(mediaDevices.getUserMedia.mock.calls[2]?.[0]).toEqual({
      video: false,
      audio: { deviceId: { exact: 'audio-usb-1' }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    expect((params.addToActiveScene as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      captureAudioEnabled: true,
      audioDeviceId: 'audio-usb-1',
    });
  });

  it('keeps the camera picker usable when audio input enumeration fails', async () => {
    const params = makeHookParams(makeSource('media'));
    const permissionStream = fakeStream(new FakeTrack('video', 'Permission camera'));
    const cameraStream = fakeStream(new FakeTrack('video', 'Webcam'));
    const devices = [{ kind: 'videoinput', deviceId: 'video-usb-1', label: 'Webcam', groupId: 'video-group' }] as MediaDeviceInfo[];
    mediaDevices = installMediaDevices(async () => permissionStream, devices);
    mediaDevices.enumerateDevices.mockResolvedValueOnce([])
      .mockResolvedValueOnce(devices)
      .mockRejectedValueOnce(new Error('Audio input enumeration failed'));
    mediaDevices.getUserMedia.mockResolvedValueOnce(permissionStream).mockResolvedValueOnce(cameraStream);
    const { result } = renderHook(() => useCapture(params));

    await act(async () => { await result.current.openInputDevicePicker('camera'); });
    expect(result.current.inputDevicePicker).toBe('camera');
    expect(result.current.inputDeviceOptions.camera).toHaveLength(1);
    await act(async () => { await result.current.chooseInputDevice(result.current.inputDeviceOptions.camera[0]!); });
    expect(mediaDevices.getUserMedia).toHaveBeenCalledOnce();

    act(() => result.current.setCameraAudioEnabled(false));
    await act(async () => { await result.current.chooseInputDevice(result.current.inputDeviceOptions.camera[0]!); });
    expect((params.addToActiveScene as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({ captureAudioEnabled: false });
  });

  it('keeps a window video capture active and reports when requested system audio is missing', async () => {
    const option: DesktopSourceOption = { id: 'window:1', name: 'Editor', kind: 'window', thumbnail: '' };
    const api = {
      ...makeApi(),
      listDesktopSources: vi.fn(async () => [option]),
      prepareDesktopCapture: vi.fn(async () => undefined),
    } as unknown as StreamAPI;
    const setActionError = vi.fn();
    const params = { ...makeHookParams(makeSource('media'), { api }), displayCaptureSystemAudio: true, setActionError };
    const videoTrack = new FakeTrack('video', 'Editor');
    const stream = fakeStream(videoTrack);
    mediaDevices = installMediaDevices(async () => fakeStream());
    Object.assign(mediaDevices, { getDisplayMedia: vi.fn(async () => stream) });
    const { result } = renderHook(() => useCapture(params));

    await act(async () => { await result.current.openCapturePicker('window'); });
    await act(async () => { await result.current.addDesktopCapture(option); });

    const capturedSource = (params.addToActiveScene as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as StreamSource;
    expect(capturedSource).toMatchObject({ kind: 'window', captureAudioEnabled: true });
    expect(capturedSource).toBeDefined();
    expect(videoTrack.stop).not.toHaveBeenCalled();
    expect(result.current.runtimes.current.has(toRuntimeProject(makeProject(capturedSource)).scenes[0]!.sources[0]!.id)).toBe(true);
    expect(setActionError).toHaveBeenCalledWith('System audio was not provided. Video capture is still active.');
  });

  it('keeps an owned camera warm when hidden, then stops it after its final owner is removed', async () => {
    const source = makeSource('camera');
    const setActionError = vi.fn();
    const params = { ...makeHookParams(source), setActionError };
    const runtimeSource = params.allSources[0]!;
    const track = new FakeTrack('video');
    const stream = fakeStream(track);
    mediaDevices = installMediaDevices(async () => stream);
    const { result, rerender } = renderHook(({ current }: { current: UseCaptureParams }) => useCapture(current), { initialProps: { current: params } });

    await waitFor(() => expect(result.current.runtimes.current.get(runtimeSource.id)).toBe(stream));
    const hidden = new Set<string>();
    const hiddenParams = { ...params, activeSourceIds: hidden, activeSourceIdsRef: { current: hidden } };
    rerender({ current: hiddenParams });

    expect(result.current.runtimes.current.get(runtimeSource.id)).toBe(stream);
    expect(track.stop).not.toHaveBeenCalled();

    const emptyProject = toRuntimeProject(makeProject(null));
    const emptyParams = {
      ...hiddenParams,
      project: emptyProject,
      projectRef: { current: emptyProject },
      allSources: [],
      allSourcesRef: { current: [] },
      programProject: emptyProject,
      programSourceIds: new Set<string>(),
    };
    rerender({ current: emptyParams });

    await waitFor(() => expect(track.stop).toHaveBeenCalledOnce());
    expect(result.current.runtimes.current.has(runtimeSource.id)).toBe(false);
    expect(setActionError).not.toHaveBeenCalled();
  });

  it('stops a late camera permission result after workspace reset without attaching it', async () => {
    const pending = deferred<MediaStream>();
    const source = makeSource('camera');
    const params = makeHookParams(source);
    const runtimeId = params.allSources[0]!.id;
    const track = new FakeTrack('video');
    const stream = fakeStream(track);
    const installedMediaDevices = installMediaDevices(() => pending.promise);
    mediaDevices = installedMediaDevices;
    const { result } = renderHook(() => useCapture(params));

    await waitFor(() => expect(installedMediaDevices.getUserMedia).toHaveBeenCalledOnce());
    act(() => result.current.resetForWorkspaceChange());
    await act(async () => { pending.resolve(stream); await pending.promise; });

    await waitFor(() => expect(track.stop).toHaveBeenCalledOnce());
    expect(result.current.runtimes.current.has(runtimeId)).toBe(false);
    expect(result.current.sourceStatuses[runtimeId]).toBeUndefined();
  });

  it('retries an unavailable camera after devicechange and reports ready after recovery', async () => {
    const source = makeSource('camera', { name: 'Camera 1' });
    const setActionError = vi.fn();
    const params = { ...makeHookParams(source), setActionError };
    const runtimeId = params.allSources[0]!.id;
    const track = new FakeTrack('video');
    const stream = fakeStream(track);
    mediaDevices = installMediaDevices(async () => { throw new Error('camera unavailable'); });
    mediaDevices.getUserMedia.mockRejectedValueOnce(new Error('camera unavailable'))
      .mockRejectedValueOnce(new Error('camera unavailable'))
      .mockResolvedValueOnce(stream);
    const { result, rerender } = renderHook(({ current }: { current: UseCaptureParams }) => useCapture(current), { initialProps: { current: params } });

    await waitFor(() => expect(result.current.sourceStatuses[runtimeId]?.state).toBe('unavailable'));
    await waitFor(() => expect(setActionError).toHaveBeenCalledOnce());
    expect(setActionError).toHaveBeenCalledWith('Camera 1 is unavailable.');
    rerender({ current: params });
    expect(setActionError).toHaveBeenCalledOnce();

    act(() => mediaDevices!.dispatchEvent(new Event('devicechange')));
    await waitFor(() => expect(mediaDevices!.getUserMedia).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(setActionError).toHaveBeenCalledTimes(2));
    expect(setActionError).toHaveBeenLastCalledWith('Camera 1 is unavailable.');

    act(() => mediaDevices!.dispatchEvent(new Event('devicechange')));

    await waitFor(() => expect(result.current.sourceStatuses[runtimeId]?.state).toBe('ready'));
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(3);
    expect(setActionError).toHaveBeenCalledTimes(2);
    expect(result.current.runtimes.current.get(runtimeId)).toBe(stream);
  });

  it('warns once when an attached runtime track ends unexpectedly', async () => {
    const source = makeSource('camera', { name: 'Camera 1' });
    const activeSourceIds = new Set<string>();
    const setActionError = vi.fn();
    const params = {
      ...makeHookParams(source, { activeSourceIds }),
      activeSourceIdsRef: { current: activeSourceIds },
      setActionError,
    };
    mediaDevices = installMediaDevices(async () => fakeStream());
    const { result } = renderHook(() => useCapture(params));
    const runtimeSource = params.allSources[0]!;
    const track = new FakeTrack('video');
    const stream = fakeStream(track);

    await act(async () => { await result.current.attachRuntime(runtimeSource, stream); });
    expect(result.current.sourceStatuses[runtimeSource.id]).toEqual({ state: 'ready' });
    expect(setActionError).not.toHaveBeenCalled();

    act(() => track.stop());

    await waitFor(() => expect(result.current.sourceStatuses[runtimeSource.id]).toEqual({ state: 'unavailable', message: 'Capture ended.' }));
    expect(setActionError).toHaveBeenCalledOnce();
    expect(setActionError).toHaveBeenCalledWith('Camera 1 disconnected.');
  });

  it('inserts media routes closed and applies the latest Program policy after async completion', async () => {
    const source = makeSource('media');
    const params = makeHookParams(source);
    const runtimeSource = params.allSources[0]!;
    mediaDevices = installMediaDevices(async () => fakeStream());
    const { result, rerender } = renderHook(({ current }: { current: UseCaptureParams }) => useCapture(current), { initialProps: { current: params } });
    act(() => { result.current.ensureMixer(); });
    const mixer = mixerMock.instances[0];
    const pending = deferred<boolean>();
    mixer.addMediaElement.mockImplementation((id: string) => {
      // Simulate a route that becomes live as soon as the mixer resolves it.
      mixer.ids.add(id);
      return pending.promise;
    });
    const element = document.createElement('video');
    let connectPromise!: Promise<void>;
    act(() => { connectPromise = result.current.connectMediaElement(runtimeSource, element); });

    expect(mixer.addMediaElement).toHaveBeenCalledOnce();
    expect(mixer.addMediaElement.mock.calls[0]![2].programActive).toBe(false);

    const noLongerProgram = { ...params, programSourceIds: new Set<string>() };
    rerender({ current: noLongerProgram });
    await act(async () => { pending.resolve(true); await connectPromise; });

    expect(mixer.setProgramActive).toHaveBeenLastCalledWith(runtimeSource.id, false);
    expect(result.current.sourceStatuses[runtimeSource.id]).toEqual({ state: 'ready' });
  });

  it('keeps browser audio staged until Transition and disables only the audio route after commit', async () => {
    const disabledProject = toRuntimeProject(makeProject(makeBrowserSource(false)));
    const enabledDraftProject = toRuntimeProject(makeProject(makeBrowserSource(true)));
    const disabledSource = disabledProject.scenes[0]!.sources[0]!;
    const enabledSource = enabledDraftProject.scenes[0]!.sources[0]!;
    expect(enabledSource.id).toBe(disabledSource.id);

    const api = {
      ...makeApi(),
      createBrowserSource: vi.fn(async () => undefined),
      closeBrowserSource: vi.fn(async () => undefined),
      getBrowserSourceAudioCaptureId: vi.fn(async () => '12345678-1234-4234-8234-123456789abc'),
    } as unknown as StreamAPI;
    const track = new FakeTrack('audio', 'Browser tab audio');
    const stream = fakeStream(track);
    mediaDevices = installMediaDevices(async () => stream);
    const initialParams = makeHookParams(makeBrowserSource(false), {
      draftProject: makeProject(makeBrowserSource(false)),
      api,
    });
    const runtimeId = disabledSource.id;
    const { result, rerender } = renderHook(({ current }: { current: UseCaptureParams }) => useCapture(current), { initialProps: { current: initialParams } });

    await waitFor(() => expect(api.createBrowserSource).toHaveBeenCalledOnce());
    expect(api.createBrowserSource).toHaveBeenCalledWith(runtimeId, 'https://example.test', expect.any(Number), expect.any(Number));
    expect(api.getBrowserSourceAudioCaptureId).not.toHaveBeenCalled();
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();

    const stagedEnable = {
      ...initialParams,
      project: enabledDraftProject,
      projectRef: { current: enabledDraftProject },
      // Program config wins in the merged owner set until Transition.
      allSources: [disabledSource],
      allSourcesRef: { current: [disabledSource] },
    };
    rerender({ current: stagedEnable });
    expect(api.createBrowserSource).toHaveBeenCalledOnce();
    expect(api.getBrowserSourceAudioCaptureId).not.toHaveBeenCalled();
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();

    const committedEnable = {
      ...stagedEnable,
      allSources: [enabledSource],
      allSourcesRef: { current: [enabledSource] },
      programProject: enabledDraftProject,
      programSourceIds: new Set([runtimeId]),
    };
    rerender({ current: committedEnable });
    await waitFor(() => expect(result.current.runtimes.current.get(runtimeId)).toBe(stream));
    const mixer = mixerMock.instances[0]!;
    expect(api.getBrowserSourceAudioCaptureId).toHaveBeenCalledOnce();
    expect(mediaDevices.getUserMedia).toHaveBeenCalledOnce();
    expect(mixer.add.mock.calls[0]![2].programActive).toBe(false);
    await waitFor(() => expect(mixer.setProgramActive).toHaveBeenLastCalledWith(runtimeId, true));

    const stagedDisable = {
      ...committedEnable,
      project: disabledProject,
      projectRef: { current: disabledProject },
      // Keep the committed enabled config until the second Transition.
      allSources: [enabledSource],
      allSourcesRef: { current: [enabledSource] },
    };
    rerender({ current: stagedDisable });
    expect(track.stop).not.toHaveBeenCalled();
    expect(mixer.remove).not.toHaveBeenCalled();

    const committedDisable = {
      ...stagedDisable,
      allSources: [disabledSource],
      allSourcesRef: { current: [disabledSource] },
      programProject: disabledProject,
      programSourceIds: new Set([runtimeId]),
    };
    rerender({ current: committedDisable });
    await waitFor(() => expect(track.stop).toHaveBeenCalledOnce());
    expect(mixer.remove).toHaveBeenCalledWith(runtimeId);
    expect(result.current.runtimes.current.has(runtimeId)).toBe(false);
    expect(api.createBrowserSource).toHaveBeenCalledOnce();
    expect(api.closeBrowserSource).not.toHaveBeenCalled();
  });
});

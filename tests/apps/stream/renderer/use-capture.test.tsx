import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCapture, type ApplicationAudioInput, type UseCaptureParams } from '../../../../apps/stream/renderer/features/capture/use-capture';
import { createDefaultProject, type DesktopSourceOption, type StreamAPI, type StreamProject, type StreamSource } from '../../../../apps/stream/shared/desktop-api';
import { toRuntimeProject } from '../../../../apps/stream/renderer/source-runtime';
import type { RuntimeSource } from '../../../../apps/stream/renderer/source-runtime';
import { DEFAULT_AUDIO_FILTERS } from '../../../../apps/stream/renderer/shared/source-factory';

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
    createApplicationAudioInput = vi.fn(async () => createFakeApplicationAudioInput());
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

function createFakeApplicationAudioInput(): ApplicationAudioInput {
  const stream = fakeStream(new FakeTrack('audio', 'Native helper audio'));
  return {
    stream,
    node: { port: { postMessage: vi.fn() } } as unknown as AudioWorkletNode,
    close: vi.fn(() => stream.getTracks().forEach((track) => track.stop())),
  };
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

function makeSource(kind: 'camera' | 'media' | 'window' | 'display', overrides: Partial<StreamSource> = {}): StreamSource {
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
    resolveDesktopCapture: vi.fn(async () => null),
    prepareDesktopCapture: vi.fn(async () => undefined),
    stopApplicationAudioCapture: vi.fn(async () => undefined),
    listAudioApplications: vi.fn(async () => []),
    startApplicationAudioCapture: vi.fn(async () => undefined),
    startSystemAudioCapture: vi.fn(async () => undefined),
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

    const { result } = renderHook(({ current }: { current: UseCaptureParams }) => useCapture(current), { initialProps: { current: params } });

    await waitFor(() => expect(result.current.runtimes.current.get(runtimeSource.id)).toBe(stream));
    expect(result.current.sourceStatuses[runtimeSource.id]).toEqual({ state: 'ready' });
    expect(mixerMock.instances).toHaveLength(0);
    expect(mediaDevices.getUserMedia).toHaveBeenCalledOnce();
  });

  it('duplicates only visible scene runtimes through the Capture capability', async () => {
    const source = makeSource('camera', { id: 'camera-origin' });
    const params = makeHookParams(source, { activeSourceIds: new Set() });
    mediaDevices = installMediaDevices(async () => fakeStream());
    const { result } = renderHook(() => useCapture(params));
    const track = new FakeTrack('video', 'Original camera');
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
      getAudioTracks: () => [],
      clone: vi.fn(() => fakeStream(new FakeTrack('video', 'Cloned camera'))),
    } as unknown as MediaStream;
    const originalRuntimeId = params.allSources[0]!.id;
    result.current.runtimes.current.set(originalRuntimeId, stream);
    const visibleClone = { ...source, id: 'camera-clone-visible' };
    const hiddenClone = { ...source, id: 'camera-clone-hidden' };
    const hiddenSource = { ...source, id: 'camera-origin-hidden' };
    const port = result.current.createSceneRuntimePort(new Set([source.id]));

    await act(async () => {
      const lease = await port.duplicateSceneRuntimes([
        { source, duplicate: visibleClone },
        { source: hiddenSource, duplicate: hiddenClone },
      ]);
      lease.commit();
    });

    const visibleRuntimeId = toRuntimeProject(makeProject(visibleClone)).scenes[0]!.sources[0]!.id;
    const hiddenRuntimeId = toRuntimeProject(makeProject(hiddenClone)).scenes[0]!.sources[0]!.id;
    expect(stream.clone).toHaveBeenCalledOnce();
    expect(result.current.runtimes.current.has(visibleRuntimeId)).toBe(true);
    expect(result.current.runtimes.current.has(hiddenRuntimeId)).toBe(false);
  });

  it('preserves output viewport identity when duplicating a browser capture runtime', async () => {
    const source = makeBrowserSource(true);
    const params = makeHookParams(source, { activeSourceIds: new Set() });
    mediaDevices = installMediaDevices(async () => fakeStream());
    const { result } = renderHook(() => useCapture(params));
    const track = new FakeTrack('video', 'Browser capture');
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
      getAudioTracks: () => [],
      clone: vi.fn(() => fakeStream(new FakeTrack('video', 'Browser clone'))),
    } as unknown as MediaStream;
    result.current.runtimes.current.set(params.allSources[0]!.id, stream);
    const duplicate = { ...source, id: 'browser-clone' };
    const port = result.current.createSceneRuntimePort(new Set([source.id]));

    await act(async () => {
      const lease = await port.duplicateSceneRuntimes([{ source, duplicate }]);
      lease.commit();
    });

    const duplicateRuntimeId = toRuntimeProject(makeProject(duplicate)).scenes[0]!.sources[0]!.id;
    expect(result.current.runtimes.current.has(duplicateRuntimeId)).toBe(true);
  });

  it('restarts application and system audio through Capture when duplicating a scene', async () => {
    const applicationPath = '/Applications/Editor.app/Contents/MacOS/Editor';
    const applicationSource: StreamSource = {
      id: 'application-audio-origin', name: 'Editor audio', kind: 'application-audio', visible: true,
      muted: false, volume: 1, applicationPath, transform: { x: 0, y: 0, width: 100, height: 100 },
    };
    const systemSource: StreamSource = {
      id: 'system-audio-origin', name: 'System audio', kind: 'desktop-audio', visible: true,
      muted: false, volume: 1, transform: { x: 0, y: 0, width: 100, height: 100 },
    };
    const api = makeApi();
    const params = makeHookParams(applicationSource, { api, activeSourceIds: new Set(), programSourceIds: new Set() });
    mediaDevices = installMediaDevices(async () => fakeStream());
    const { result } = renderHook(() => useCapture(params));
    const applicationRuntimeId = params.allSources[0]!.id;
    const systemRuntimeId = toRuntimeProject(makeProject(systemSource)).scenes[0]!.sources[0]!.id;
    const applicationInput = createFakeApplicationAudioInput();
    const systemInput = createFakeApplicationAudioInput();
    result.current.runtimes.current.set(applicationRuntimeId, applicationInput.stream);
    result.current.runtimes.current.set(systemRuntimeId, systemInput.stream);
    result.current.applicationAudioInputs.current.set(applicationRuntimeId, applicationInput);
    result.current.applicationAudioSessions.current.set(applicationRuntimeId, { pid: 42, path: applicationPath });
    result.current.applicationAudioInputs.current.set(systemRuntimeId, systemInput);
    const applicationDuplicate = { ...applicationSource, id: 'application-audio-copy' };
    const systemDuplicate = { ...systemSource, id: 'system-audio-copy' };
    const port = result.current.createSceneRuntimePort(new Set([applicationSource.id, systemSource.id]));

    await act(async () => {
      const lease = await port.duplicateSceneRuntimes([
        { source: applicationSource, duplicate: applicationDuplicate },
        { source: systemSource, duplicate: systemDuplicate },
      ]);
      lease.commit();
    });

    const applicationDuplicateRuntimeId = toRuntimeProject(makeProject(applicationDuplicate)).scenes[0]!.sources[0]!.id;
    const systemDuplicateRuntimeId = toRuntimeProject(makeProject(systemDuplicate)).scenes[0]!.sources[0]!.id;
    expect(api.startApplicationAudioCapture).toHaveBeenCalledWith(applicationDuplicateRuntimeId, 42, applicationPath);
    expect(api.startSystemAudioCapture).toHaveBeenCalledWith(systemDuplicateRuntimeId);
    expect(result.current.applicationAudioSessions.current.get(applicationDuplicateRuntimeId)).toEqual({ pid: 42, path: applicationPath });
    expect(result.current.applicationAudioInputs.current.has(systemDuplicateRuntimeId)).toBe(true);
  });

  it('cleans up earlier runtime clones when a later native audio clone fails', async () => {
    const cameraSource = makeSource('camera', { id: 'camera-before-native-audio' });
    const applicationSource: StreamSource = {
      id: 'application-audio-without-session', name: 'Missing session', kind: 'application-audio', visible: true,
      muted: false, volume: 1, applicationPath: '/Applications/Editor.app',
      transform: { x: 0, y: 0, width: 100, height: 100 },
    };
    const params = makeHookParams(cameraSource, { activeSourceIds: new Set(), programSourceIds: new Set() });
    mediaDevices = installMediaDevices(async () => fakeStream());
    const { result } = renderHook(() => useCapture(params));
    const cameraRuntimeId = params.allSources[0]!.id;
    const applicationRuntimeId = toRuntimeProject(makeProject(applicationSource)).scenes[0]!.sources[0]!.id;
    const clonedTrack = new FakeTrack('video', 'Cloned camera');
    const cameraStream = {
      getTracks: () => [new FakeTrack('video', 'Original camera')],
      getVideoTracks: () => [new FakeTrack('video', 'Original camera')],
      getAudioTracks: () => [],
      clone: vi.fn(() => fakeStream(clonedTrack)),
    } as unknown as MediaStream;
    result.current.runtimes.current.set(cameraRuntimeId, cameraStream);
    result.current.runtimes.current.set(applicationRuntimeId, fakeStream(new FakeTrack('audio', 'App audio')));
    result.current.applicationAudioInputs.current.set(applicationRuntimeId, createFakeApplicationAudioInput());
    const cameraDuplicate = { ...cameraSource, id: 'camera-duplicate-before-failure' };
    const applicationDuplicate = { ...applicationSource, id: 'application-duplicate-failing' };
    const port = result.current.createSceneRuntimePort(new Set([cameraSource.id, applicationSource.id]));

    await act(async () => {
      await expect(port.duplicateSceneRuntimes([
        { source: cameraSource, duplicate: cameraDuplicate },
        { source: applicationSource, duplicate: applicationDuplicate },
      ])).rejects.toThrow('capture for Missing session is no longer active');
    });

    const cameraDuplicateRuntimeId = toRuntimeProject(makeProject(cameraDuplicate)).scenes[0]!.sources[0]!.id;
    expect(result.current.runtimes.current.has(cameraDuplicateRuntimeId)).toBe(false);
    expect(clonedTrack.stop).toHaveBeenCalledOnce();
  });

  it('automatically rebinds a saved window on its committed runtime and persists the fresh capture ID', async () => {
    const oldTarget = { kind: 'window' as const, name: 'Untitled - Editor', appIconHash: 'a'.repeat(64) };
    const source = makeSource('window', {
      id: 'saved-window', name: 'Editor', captureId: 'window:4425:0', captureTarget: oldTarget, cursorMode: 'never', captureAudioEnabled: false,
    });
    const option: DesktopSourceOption = {
      id: 'window:4425:1', name: 'Edited document - Editor', kind: 'window', thumbnail: '', appIconHash: oldTarget.appIconHash,
    };
    const api = {
      ...makeApi(),
      resolveDesktopCapture: vi.fn(async () => option),
      prepareDesktopCapture: vi.fn(async () => undefined),
    } as unknown as StreamAPI;
    const params = makeHookParams(source, { api });
    const committedRuntimeId = params.allSources[0]!.id;
    const track = new FakeTrack('video', 'Editor');
    const stream = fakeStream(track);
    mediaDevices = installMediaDevices(async () => stream);
    const { result } = renderHook(() => useCapture(params));

    await waitFor(() => expect(api.prepareDesktopCapture).toHaveBeenCalledWith(option.id, false, 'automatic-restore'));
    await waitFor(() => expect(result.current.runtimes.current.get(committedRuntimeId)).toBe(stream));

    expect(api.resolveDesktopCapture).toHaveBeenCalledWith('window', source.captureId, oldTarget, undefined);
    expect(mediaDevices.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({
      video: expect.objectContaining({ mandatory: expect.objectContaining({ chromeMediaSourceId: option.id }) }),
      audio: false,
    }));
    expect(params.updateSource).toHaveBeenCalledWith('saved-window', expect.any(Function));
    const update = (params.updateSource as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as (current: StreamSource) => StreamSource;
    const updatedSource = update(source);
    expect(updatedSource).toMatchObject({ captureId: option.id, captureTarget: { kind: 'window', name: option.name, appIconHash: oldTarget.appIconHash } });
    const restoredRuntimeId = toRuntimeProject(makeProject({ ...source, captureId: option.id, captureTarget: { ...oldTarget, name: option.name } })).scenes[0]!.sources[0]!.id;
    expect(restoredRuntimeId).toBe(committedRuntimeId);
    expect(params.programSourceIds).toContain(committedRuntimeId);
    await waitFor(() => expect(result.current.sourceStatuses[committedRuntimeId]).toEqual({ state: 'ready' }));
  });

  it('restores the requested Program variant without rebinding a staged alternate target', async () => {
    const programTarget = { kind: 'window' as const, name: 'Program document', appIconHash: 'a'.repeat(64) };
    const previewTarget = { kind: 'window' as const, name: 'Preview document', appIconHash: 'b'.repeat(64) };
    const programSource = makeSource('window', {
      id: 'studio-window', name: 'Editor', captureId: 'window:program-old:0', captureTarget: programTarget,
      cursorMode: 'never', captureAudioEnabled: false,
    });
    const previewSource = { ...programSource, captureId: 'window:preview:0', captureTarget: previewTarget };
    const option: DesktopSourceOption = {
      id: 'window:program-refreshed:8', name: 'Program document', kind: 'window', thumbnail: '', appIconHash: programTarget.appIconHash,
    };
    const api = {
      ...makeApi(),
      resolveDesktopCapture: vi.fn(async () => option),
      prepareDesktopCapture: vi.fn(async () => undefined),
    } as unknown as StreamAPI;
    const draftProject = makeProject(previewSource);
    const programProject = toRuntimeProject(makeProject(programSource));
    const draftRuntimeProject = toRuntimeProject(draftProject);
    const programRuntimeSource = programProject.scenes[0]!.sources[0]!;
    const previewRuntimeSource = draftRuntimeProject.scenes[0]!.sources[0]!;
    const activeSourceIds = new Set([programRuntimeSource.id]);
    const allSources = [previewRuntimeSource, programRuntimeSource];
    const params = {
      ...makeHookParams(previewSource, { api, draftProject }),
      allSources,
      allSourcesRef: { current: allSources },
      programProject,
      programSourceIds: new Set([programRuntimeSource.id]),
      activeSourceIds,
      activeSourceIdsRef: { current: activeSourceIds },
      updateSource: vi.fn(),
    };
    const stream = fakeStream(new FakeTrack('video', 'Program window'));
    mediaDevices = installMediaDevices(async () => stream);
    const { result } = renderHook(() => useCapture(params));

    await waitFor(() => expect(result.current.runtimes.current.get(programRuntimeSource.id)).toBe(stream));

    expect(api.resolveDesktopCapture).toHaveBeenCalledWith('window', programSource.captureId, programTarget, undefined);
    expect(params.updateSource).not.toHaveBeenCalled();
    expect(draftProject.scenes[0]!.sources[0]).toMatchObject({
      captureId: previewSource.captureId,
      captureTarget: previewTarget,
    });
    expect(params.programSourceIds).toContain(programRuntimeSource.id);
    expect(result.current.sourceStatuses[programRuntimeSource.id]).toEqual({ state: 'ready' });
  });

  it('restores same-origin Program and staged windows independently when their runtime bindings differ', async () => {
    const target = { kind: 'window' as const, name: 'Untitled', appIconHash: 'c'.repeat(64) };
    const programSource = makeSource('window', {
      id: 'same-origin-window-variants',
      name: 'Editor',
      captureId: 'window:program:0',
      captureTarget: target,
      captureBindingId: '11111111-1111-4111-8111-111111111111',
      captureAudioEnabled: false,
    });
    const stagedSource = {
      ...programSource,
      captureId: 'window:staged:0',
      captureBindingId: '22222222-2222-4222-8222-222222222222',
    };
    const draftProject = makeProject(stagedSource);
    const programProject = toRuntimeProject(makeProject(programSource));
    const stagedRuntimeSource = toRuntimeProject(draftProject).scenes[0]!.sources[0]!;
    const programRuntimeSource = programProject.scenes[0]!.sources[0]!;
    expect(stagedRuntimeSource.id).not.toBe(programRuntimeSource.id);
    const allSources = [stagedRuntimeSource, programRuntimeSource];
    const api = {
      ...makeApi(),
      resolveDesktopCapture: vi.fn(async (kind, captureId) => ({
        id: captureId!, name: 'Untitled', kind, thumbnail: '', appIconHash: target.appIconHash,
      })),
      prepareDesktopCapture: vi.fn(async () => undefined),
    } as unknown as StreamAPI;
    const params = {
      ...makeHookParams(stagedSource, {
        api,
        draftProject,
        runtimeProgramProject: programProject,
        allSources,
        activeSourceIds: new Set(allSources.map((source) => source.id)),
        programSourceIds: new Set([programRuntimeSource.id]),
      }),
      allSources,
      allSourcesRef: { current: allSources },
      programProject,
      programSourceOriginIds: new Set([programSource.id]),
    };
    let streamCount = 0;
    mediaDevices = installMediaDevices(async () => fakeStream(new FakeTrack('video', `Window ${++streamCount}`)));
    const { result } = renderHook(() => useCapture(params));

    await waitFor(() => expect(result.current.runtimes.current.has(stagedRuntimeSource.id)).toBe(true));
    await waitFor(() => expect(result.current.runtimes.current.has(programRuntimeSource.id)).toBe(true));

    expect(api.resolveDesktopCapture).toHaveBeenCalledTimes(2);
    expect(api.prepareDesktopCapture).toHaveBeenCalledWith(stagedSource.captureId, false, 'automatic-restore');
    expect(api.prepareDesktopCapture).toHaveBeenCalledWith(programSource.captureId, false, 'automatic-restore');
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('routes shared media audio from the explicitly visible Program alias', async () => {
    const hiddenAlias = makeSource('media', {
      id: 'shared-hidden-first', name: 'Hidden alias', mediaKind: 'video', assetId: 'shared-audio-asset', assetExtension: 'mp4',
      visible: false, volume: 0.2, muted: true, balance: -0.5,
    });
    const visibleAlias = makeSource('media', {
      id: 'shared-visible-frontmost', name: 'Visible alias', mediaKind: 'video', assetId: 'shared-audio-asset', assetExtension: 'mp4',
      visible: true, volume: 0.85, muted: false, balance: 0.35,
    });
    const project = makeProject(hiddenAlias);
    project.scenes[0]!.sources = [hiddenAlias, visibleAlias];
    const programProject = toRuntimeProject(project);
    const [hiddenRuntimeSource, visibleRuntimeSource] = programProject.scenes[0]!.sources;
    expect(hiddenRuntimeSource!.id).toBe(visibleRuntimeSource!.id);
    const api = makeApi();
    const allSources = [hiddenRuntimeSource!, visibleRuntimeSource!];
    const params = {
      ...makeHookParams(visibleAlias, {
        api,
        draftProject: project,
        runtimeProgramProject: programProject,
        allSources,
        programSourceIds: new Set([visibleRuntimeSource!.id]),
      }),
      allSources,
      allSourcesRef: { current: allSources },
      programProject,
      programSourceOriginIds: new Set([visibleAlias.id]),
    };
    const audioTrack = new FakeTrack('audio', 'Shared media audio');
    const stream = fakeStream(audioTrack);
    mediaDevices = installMediaDevices(async () => fakeStream());
    const { result } = renderHook(() => useCapture(params));

    await act(async () => { await result.current.attachRuntime(visibleRuntimeSource!, stream); });

    const mixer = mixerMock.instances[0]!;
    expect(mixer.add).toHaveBeenCalledWith(visibleRuntimeSource!.id, stream, expect.objectContaining({
      volume: visibleAlias.volume,
      muted: visibleAlias.muted,
      balance: visibleAlias.balance,
      programActive: false,
    }));
    await waitFor(() => expect(mixer.setSettings).toHaveBeenLastCalledWith(visibleRuntimeSource!.id, expect.objectContaining({
      volume: visibleAlias.volume,
      muted: visibleAlias.muted,
      balance: visibleAlias.balance,
    })));
    expect(mixer.setProgramActive).toHaveBeenLastCalledWith(visibleRuntimeSource!.id, true);
  });

  it('falls back to the frontmost visible alias when Program origin IDs are omitted', async () => {
    const backAlias = makeSource('media', {
      id: 'shared-visible-back', mediaKind: 'video', assetId: 'shared-visible-asset', assetExtension: 'mp4',
      visible: true, volume: 0.3,
    });
    const hiddenFrontAlias = makeSource('media', {
      id: 'shared-hidden-front', mediaKind: 'video', assetId: 'shared-visible-asset', assetExtension: 'mp4',
      visible: false, volume: 0.9,
    });
    const frontAlias = makeSource('media', {
      id: 'shared-visible-front', mediaKind: 'video', assetId: 'shared-visible-asset', assetExtension: 'mp4',
      visible: true, volume: 0.7,
    });
    const project = makeProject(backAlias);
    project.scenes[0]!.sources = [backAlias, hiddenFrontAlias, frontAlias];
    const programProject = toRuntimeProject(project);
    const runtimeSource = programProject.scenes[0]!.sources[2]!;
    const allSources = [runtimeSource];
    const params = {
      ...makeHookParams(frontAlias, {
        draftProject: project,
        runtimeProgramProject: programProject,
        allSources,
        programSourceIds: new Set([runtimeSource.id]),
      }),
      allSources,
      allSourcesRef: { current: allSources },
      programProject,
      programSourceOriginIds: undefined,
    };
    const stream = fakeStream(new FakeTrack('audio', 'Shared media audio'));
    mediaDevices = installMediaDevices(async () => fakeStream());
    const { result } = renderHook(() => useCapture(params));

    await act(async () => { await result.current.attachRuntime(runtimeSource, stream); });

    const mixer = mixerMock.instances[0]!;
    await waitFor(() => expect(mixer.setSettings).toHaveBeenLastCalledWith(runtimeSource.id, expect.objectContaining({
      volume: frontAlias.volume,
    })));
    expect(mixer.setProgramActive).toHaveBeenLastCalledWith(runtimeSource.id, true);
  });

  it('keeps a legacy capture binding through a changed handle and default cursor metadata', async () => {
    const source = makeSource('window', {
      id: 'legacy-window-binding', name: 'Legacy Editor', captureId: 'window:legacy-old:0', captureAudioEnabled: false,
    });
    const option: DesktopSourceOption = {
      id: 'window:legacy-new:7', name: 'Legacy Editor', kind: 'window', thumbnail: '', appIconHash: 'c'.repeat(64),
    };
    const api = {
      ...makeApi(),
      resolveDesktopCapture: vi.fn(async () => option),
      prepareDesktopCapture: vi.fn(async () => undefined),
    } as unknown as StreamAPI;
    const params = makeHookParams(source, { api });
    const runtimeId = params.allSources[0]!.id;
    const stream = fakeStream(new FakeTrack('video', 'Legacy Editor'));
    mediaDevices = installMediaDevices(async () => stream);
    const { result } = renderHook(() => useCapture(params));

    await waitFor(() => expect(result.current.runtimes.current.get(runtimeId)).toBe(stream));
    expect(api.resolveDesktopCapture).toHaveBeenCalledWith('window', source.captureId, undefined, source.name);
    const update = (params.updateSource as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as (current: StreamSource) => StreamSource;
    const updated = update(source);
    expect(updated).toMatchObject({
      captureId: option.id,
      cursorMode: 'motion',
      captureTarget: { kind: 'window', name: option.name, appIconHash: option.appIconHash },
    });
    expect(toRuntimeProject(makeProject(updated)).scenes[0]!.sources[0]!.id).toBe(runtimeId);
  });

  it('allocates a separate runtime variant for an explicitly selected new target', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const firstTarget = { kind: 'window' as const, name: 'First Editor', appIconHash: 'd'.repeat(64) };
    const source = makeSource('window', {
      id: 'manual-window-binding', name: 'First Editor', captureId: 'window:first:0', captureTarget: firstTarget,
      cursorMode: 'motion', captureAudioEnabled: false,
    });
    const option: DesktopSourceOption = {
      id: 'window:second:0', name: 'Second Editor', kind: 'window', thumbnail: '', appIconHash: 'e'.repeat(64),
    };
    const api = {
      ...makeApi(),
      listDesktopSources: vi.fn(async () => [option]),
      prepareDesktopCapture: vi.fn(async () => undefined),
    } as unknown as StreamAPI;
    const params = makeHookParams(source, { api, activeSourceIds: new Set(), programSourceIds: new Set() });
    const programRuntimeId = params.allSources[0]!.id;
    const stream = fakeStream(new FakeTrack('video', 'Second Editor'));
    mediaDevices = installMediaDevices(async () => fakeStream());
    Object.assign(mediaDevices, { getDisplayMedia: vi.fn(async () => stream) });
    const { result } = renderHook(() => useCapture(params));

    await act(async () => { await result.current.openCapturePicker('window', source.id); });
    await act(async () => { await result.current.addDesktopCapture(option); });

    const update = (params.updateSource as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as (current: StreamSource) => StreamSource;
    const selectedSource = update(source);
    const selectedRuntimeId = toRuntimeProject(makeProject(selectedSource)).scenes[0]!.sources[0]!.id;
    expect(selectedRuntimeId).not.toBe(programRuntimeId);
    expect(result.current.runtimes.current.get(selectedRuntimeId)).toBe(stream);
    expect(result.current.runtimes.current.has(programRuntimeId)).toBe(false);
  });

  it('does not surface a restore failure after a manual capture picker supersedes it', async () => {
    const target = { kind: 'window' as const, name: 'Editor', appIconHash: 'f'.repeat(64) };
    const source = makeSource('window', {
      id: 'cancelled-window-binding', name: 'Editor', captureId: 'window:cancelled:0', captureTarget: target,
    });
    const pendingStream = deferred<MediaStream>();
    const api = {
      ...makeApi(),
      listDesktopSources: vi.fn(async () => []),
      resolveDesktopCapture: vi.fn(async () => ({ id: 'window:cancelled:1', name: 'Editor', kind: 'window', thumbnail: '' } as DesktopSourceOption)),
    } as unknown as StreamAPI;
    const params = { ...makeHookParams(source, { api }), setActionError: vi.fn() };
    mediaDevices = installMediaDevices(() => pendingStream.promise);
    const { result } = renderHook(() => useCapture(params));
    const runtimeId = params.allSources[0]!.id;

    await waitFor(() => expect(mediaDevices!.getUserMedia).toHaveBeenCalledOnce());
    await act(async () => { await result.current.openCapturePicker('window'); });
    (params.setActionError as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => { pendingStream.reject(new Error('capture request failed')); await Promise.resolve(); });

    await waitFor(() => expect(result.current.sourceStatuses[runtimeId]).toBeUndefined());
    expect(params.setActionError).not.toHaveBeenCalled();
  });

  it('cleans up native audio if video ends while desktop audio startup is pending', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const target = { kind: 'screen' as const, name: 'Display', displayId: 'display-1' };
    const application = { pid: 42, name: 'Editor', path: '/Applications/Editor.app/Contents/MacOS/Editor' };
    const source = makeSource('display', {
      id: 'ended-video-binding', name: 'Display', captureId: 'screen:ended:0', captureTarget: target,
      captureAudioEnabled: true, captureAudioMode: 'application', captureAudioApplicationPath: application.path,
    });
    const option: DesktopSourceOption = { id: 'screen:ended:1', name: 'Display', kind: 'screen', thumbnail: '', displayId: target.displayId };
    const nativeStart = deferred<void>();
    const api = {
      ...makeApi(),
      resolveDesktopCapture: vi.fn(async () => option),
      prepareDesktopCapture: vi.fn(async () => undefined),
      listAudioApplications: vi.fn(async () => [application]),
      startApplicationAudioCapture: vi.fn(() => nativeStart.promise),
    } as unknown as StreamAPI;
    const params = makeHookParams(source, { api });
    const runtimeId = params.allSources[0]!.id;
    const videoTrack = new FakeTrack('video', 'Editor');
    mediaDevices = installMediaDevices(async () => fakeStream(videoTrack));
    const { result } = renderHook(() => useCapture(params));

    await waitFor(() => expect(api.startApplicationAudioCapture).toHaveBeenCalledOnce());
    act(() => videoTrack.stop());
    await act(async () => { nativeStart.resolve(); await nativeStart.promise; });

    await waitFor(() => expect(result.current.sourceStatuses[runtimeId]?.state).toBe('unavailable'));
    expect(result.current.runtimes.current.has(runtimeId)).toBe(false);
    expect(api.stopApplicationAudioCapture).toHaveBeenCalledWith(runtimeId);
    const input = await mixerMock.instances[0]!.createApplicationAudioInput.mock.results[0]!.value;
    expect(input.close).toHaveBeenCalledOnce();
    expect(input.stream.getAudioTracks()[0]?.readyState).toBe('ended');
  });

  it('suppresses legacy enabled window audio on restore and preserves the video capture', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const target = { kind: 'window' as const, name: 'Editor', appIconHash: 'a'.repeat(64) };
    const source = makeSource('window', {
      id: 'saved-window', name: 'Editor', captureId: 'window:1:0', captureTarget: target, captureAudioEnabled: true,
    });
    const option: DesktopSourceOption = { id: 'window:1:0', name: 'Editor', kind: 'window', thumbnail: '', appIconHash: target.appIconHash };
    const api = {
      ...makeApi(), platform: 'win32',
      resolveDesktopCapture: vi.fn(async () => option),
      prepareDesktopCapture: vi.fn(async () => undefined),
    } as unknown as StreamAPI;
    const setActionError = vi.fn();
    const params = { ...makeHookParams(source, { api }), setActionError };
    const videoTrack = new FakeTrack('video', 'Editor');
    const unexpectedAudioTrack = new FakeTrack('audio', 'System loopback');
    const stream = fakeStream(videoTrack, unexpectedAudioTrack);
    mediaDevices = installMediaDevices(async () => stream);
    const { result } = renderHook(() => useCapture(params));

    const runtimeId = params.allSources[0]!.id;
    await waitFor(() => expect(result.current.runtimes.current.get(runtimeId)?.getVideoTracks()).toHaveLength(1));
    expect(api.prepareDesktopCapture).toHaveBeenCalledWith(option.id, false, 'automatic-restore');
    expect(mediaDevices.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
    expect(result.current.runtimes.current.get(runtimeId)?.getAudioTracks()).toHaveLength(0);
    expect(unexpectedAudioTrack.stop).toHaveBeenCalledOnce();
    expect(api.startSystemAudioCapture).not.toHaveBeenCalled();
    expect(api.startApplicationAudioCapture).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.sourceStatuses[runtimeId]).toMatchObject({ state: 'warning', message: expect.stringContaining('Window-only audio is unavailable') }));
    expect(setActionError).toHaveBeenCalledWith(expect.stringContaining('Video capture is still active'));
  });

  it('leaves an ambiguous or missing saved window unavailable with a reconnect action', async () => {
    const source = makeSource('window', {
      id: 'saved-window', name: 'Editor', captureId: 'window:1:0',
      captureTarget: { kind: 'window', name: 'Untitled - Editor', appIconHash: 'a'.repeat(64) },
    });
    const setActionError = vi.fn();
    const api = { ...makeApi(), resolveDesktopCapture: vi.fn(async () => null) } as unknown as StreamAPI;
    const params = { ...makeHookParams(source, { api }), setActionError };
    mediaDevices = installMediaDevices(async () => fakeStream(new FakeTrack('video')));
    const { result } = renderHook(() => useCapture(params));
    const runtimeId = params.allSources[0]!.id;

    await waitFor(() => expect(result.current.sourceStatuses[runtimeId]).toMatchObject({ state: 'unavailable', message: expect.stringContaining('matched safely') }));
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(setActionError).toHaveBeenCalledWith('Editor could not be restored. Use Reconnect Capture to choose it.');
  });

  it('automatically retries once when a restored window track ends', async () => {
    const target = { kind: 'window' as const, name: 'Editor', appIconHash: 'a'.repeat(64) };
    const source = makeSource('window', { id: 'saved-window', name: 'Editor', captureId: 'window:1:0', captureTarget: target, captureAudioEnabled: false });
    const option: DesktopSourceOption = { id: 'window:1:0', name: 'Editor', kind: 'window', thumbnail: '', appIconHash: target.appIconHash };
    const activeIds = new Set<string>();
    const updateSource = vi.fn((sourceId: string, update: (current: StreamSource) => StreamSource) => {
      const currentProject = params.projectRef.current!;
      const scenes = currentProject.scenes.map((scene) => ({
        ...scene,
        sources: scene.sources.map((candidate) => candidate.id === sourceId || ('originSourceId' in candidate && candidate.originSourceId === sourceId)
          ? update(candidate) : candidate),
      }));
      params.projectRef.current = { ...currentProject, scenes };
      const nextSource = scenes[0]!.sources[0]!;
      activeIds.clear();
      activeIds.add(toRuntimeProject(makeProject(nextSource)).scenes[0]!.sources[0]!.id);
      params.activeSourceIdsRef.current = activeIds;
    });
    const api = {
      ...makeApi(),
      resolveDesktopCapture: vi.fn(async () => option),
      prepareDesktopCapture: vi.fn(async () => undefined),
    } as unknown as StreamAPI;
    const params = makeHookParams(source, { api, activeSourceIds: activeIds });
    activeIds.add(params.allSources[0]!.id);
    params.activeSourceIdsRef.current = activeIds;
    params.updateSource = updateSource;
    const firstTrack = new FakeTrack('video', 'Editor 1');
    const secondTrack = new FakeTrack('video', 'Editor 2');
    const firstStream = fakeStream(firstTrack);
    const secondStream = fakeStream(secondTrack);
    mediaDevices = installMediaDevices(async () => mediaDevices!.getUserMedia.mock.calls.length === 1 ? firstStream : secondStream);
    const { result } = renderHook(() => useCapture(params));
    const runtimeId = toRuntimeProject(makeProject({ ...source, captureId: option.id, cursorMode: 'motion' })).scenes[0]!.sources[0]!.id;

    await waitFor(() => expect(api.prepareDesktopCapture).toHaveBeenCalled());
    await waitFor(() => expect(result.current.runtimes.current.get(runtimeId)).toBe(firstStream));
    act(() => firstTrack.stop());
    await waitFor(() => expect(result.current.runtimes.current.get(runtimeId)).toBe(secondStream));
    expect(api.resolveDesktopCapture).toHaveBeenCalledTimes(2);
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    expect(result.current.sourceStatuses[runtimeId]).toEqual({ state: 'ready' });
  });

  it('re-arms a runtime restore budget after an explicit manual reconnect succeeds', async () => {
    const target = { kind: 'window' as const, name: 'Editor', appIconHash: 'a'.repeat(64) };
    const source = makeSource('window', {
      id: 'manual-rearm-window', name: 'Editor', captureId: 'window:rearm:0', captureTarget: target,
      cursorMode: 'motion', captureAudioEnabled: false,
    });
    const option: DesktopSourceOption = { id: source.captureId!, name: 'Editor', kind: 'window', thumbnail: '', appIconHash: target.appIconHash };
    let resolveCount = 0;
    const api = {
      ...makeApi(),
      listDesktopSources: vi.fn(async () => [option]),
      resolveDesktopCapture: vi.fn(async () => ++resolveCount === 2 ? null : option),
      prepareDesktopCapture: vi.fn(async () => undefined),
    } as unknown as StreamAPI;
    const params = makeHookParams(source, { api });
    const runtimeId = params.allSources[0]!.id;
    const firstTrack = new FakeTrack('video', 'First capture');
    const manualTrack = new FakeTrack('video', 'Manual capture');
    const restoredTrack = new FakeTrack('video', 'Restored capture');
    const firstStream = fakeStream(firstTrack);
    const manualStream = fakeStream(manualTrack);
    const restoredStream = fakeStream(restoredTrack);
    mediaDevices = installMediaDevices(async () => mediaDevices!.getUserMedia.mock.calls.length === 1 ? firstStream : restoredStream);
    Object.assign(mediaDevices, { getDisplayMedia: vi.fn(async () => manualStream) });
    const { result } = renderHook(() => useCapture(params));

    await waitFor(() => expect(result.current.runtimes.current.get(runtimeId)).toBe(firstStream));
    act(() => firstTrack.stop());
    await waitFor(() => expect(api.resolveDesktopCapture).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.sourceStatuses[runtimeId]?.state).toBe('unavailable'));

    await act(async () => { await result.current.openCapturePicker('window', source.id); });
    await act(async () => { await result.current.addDesktopCapture(option); });
    await waitFor(() => expect(result.current.runtimes.current.get(runtimeId)).toBe(manualStream));

    act(() => manualTrack.stop());
    await waitFor(() => expect(result.current.runtimes.current.get(runtimeId)).toBe(restoredStream));
    expect(api.resolveDesktopCapture).toHaveBeenCalledTimes(3);
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('suppresses explicitly saved application audio on window restore', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const target = { kind: 'window' as const, name: 'Editor', appIconHash: 'a'.repeat(64) };
    const source = makeSource('window', {
      id: 'saved-window', name: 'Editor', captureId: 'window:1:0', captureTarget: target,
      captureAudioEnabled: true, captureAudioMode: 'application', captureAudioApplicationPath: '/Applications/Editor.app/Contents/MacOS/Editor',
    });
    const option: DesktopSourceOption = { id: 'window:1:0', name: 'Editor', kind: 'window', thumbnail: '', appIconHash: target.appIconHash };
    const api = {
      ...makeApi(),
      resolveDesktopCapture: vi.fn(async () => option),
      prepareDesktopCapture: vi.fn(async () => undefined),
    } as unknown as StreamAPI;
    const params = makeHookParams(source, { api });
    const videoTrack = new FakeTrack('video', 'Editor');
    const unexpectedAudioTrack = new FakeTrack('audio', 'Application audio');
    const videoStream = fakeStream(videoTrack, unexpectedAudioTrack);
    mediaDevices = installMediaDevices(async () => videoStream);
    const { result } = renderHook(() => useCapture(params));

    const runtimeId = params.allSources[0]!.id;
    await waitFor(() => expect(result.current.runtimes.current.get(runtimeId)?.getVideoTracks()).toHaveLength(1));

    expect(api.prepareDesktopCapture).toHaveBeenCalledWith(option.id, false, 'automatic-restore');
    expect(mediaDevices.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
    expect(api.listAudioApplications).not.toHaveBeenCalled();
    expect(api.startApplicationAudioCapture).not.toHaveBeenCalled();
    expect(api.startSystemAudioCapture).not.toHaveBeenCalled();
    expect(result.current.runtimes.current.get(runtimeId)?.getAudioTracks()).toHaveLength(0);
    expect(unexpectedAudioTrack.stop).toHaveBeenCalledOnce();
    await waitFor(() => expect(result.current.sourceStatuses[runtimeId]).toMatchObject({ state: 'warning', message: expect.stringContaining('Window-only audio is unavailable') }));
  });

  it('does not fall back to system audio when a saved screen application path matches multiple processes', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const target = { kind: 'screen' as const, name: 'Editor', displayId: 'display-1' };
    const application = { pid: 42, name: 'Editor', path: '/Applications/Editor.app/Contents/MacOS/Editor' };
    const source = makeSource('display', {
      id: 'saved-screen', name: 'Editor', captureId: 'screen:1:0', captureTarget: target,
      captureAudioEnabled: true, captureAudioMode: 'application', captureAudioApplicationPath: application.path,
    });
    const option: DesktopSourceOption = { id: 'screen:1:0', name: 'Editor', kind: 'screen', thumbnail: '', displayId: target.displayId };
    const api = {
      ...makeApi(),
      resolveDesktopCapture: vi.fn(async () => option),
      prepareDesktopCapture: vi.fn(async () => undefined),
      listAudioApplications: vi.fn(async () => [application, { ...application, pid: 43 }]),
    } as unknown as StreamAPI;
    const params = makeHookParams(source, { api });
    const setActionError = params.setActionError as ReturnType<typeof vi.fn>;
    const videoTrack = new FakeTrack('video', 'Editor');
    const videoStream = fakeStream(videoTrack);
    mediaDevices = installMediaDevices(async () => videoStream);
    const { result } = renderHook(() => useCapture(params));
    const runtimeId = params.allSources[0]!.id;

    await waitFor(() => expect(result.current.runtimes.current.get(runtimeId)).toBeDefined());
    expect(api.startApplicationAudioCapture).not.toHaveBeenCalled();
    expect(api.startSystemAudioCapture).not.toHaveBeenCalled();
    expect(result.current.runtimes.current.get(runtimeId)?.getVideoTracks()).toEqual([videoTrack]);
    expect(result.current.runtimes.current.get(runtimeId)?.getAudioTracks()).toHaveLength(0);
    await waitFor(() => expect(result.current.sourceStatuses[runtimeId]?.state).toBe('warning'));
    expect(setActionError).toHaveBeenCalledWith(expect.stringContaining('matches multiple running instances'));
  });

  it('rearms automatic capture restoration after an API identity change cleans up the runtime', async () => {
    const target = { kind: 'window' as const, name: 'Editor', appIconHash: 'a'.repeat(64) };
    const source = makeSource('window', {
      id: 'saved-window', name: 'Editor', captureId: 'window:1:0', captureTarget: target, captureAudioEnabled: false,
    });
    const option: DesktopSourceOption = { id: 'window:1:0', name: 'Editor', kind: 'window', thumbnail: '', appIconHash: target.appIconHash };
    const api1 = {
      ...makeApi(), platform: 'win32',
      resolveDesktopCapture: vi.fn(async () => option),
    } as unknown as StreamAPI;
    const api2 = {
      ...makeApi(), platform: 'win32',
      resolveDesktopCapture: vi.fn(async () => option),
    } as unknown as StreamAPI;
    const params = makeHookParams(source, { api: api1 });
    const firstTrack = new FakeTrack('video', 'Editor 1');
    const secondTrack = new FakeTrack('video', 'Editor 2');
    mediaDevices = installMediaDevices(async () => mediaDevices!.getUserMedia.mock.calls.length === 1
      ? fakeStream(firstTrack)
      : fakeStream(secondTrack));
    const { result, rerender } = renderHook(({ current }: { current: UseCaptureParams }) => useCapture(current), { initialProps: { current: params } });
    const runtimeId = params.allSources[0]!.id;

    await waitFor(() => expect(result.current.runtimes.current.get(runtimeId)?.getVideoTracks()[0]).toBe(firstTrack));
    rerender({ current: { ...params, api: api2 } });
    await waitFor(() => expect(result.current.runtimes.current.get(runtimeId)?.getVideoTracks()[0]).toBe(secondTrack));

    expect(firstTrack.stop).toHaveBeenCalledOnce();
    expect(api1.resolveDesktopCapture).toHaveBeenCalledOnce();
    expect(api2.resolveDesktopCapture).toHaveBeenCalledOnce();
  });

  it('stops a late desktop permission result after workspace reset without attaching it', async () => {
    const pending = deferred<MediaStream>();
    const target = { kind: 'window' as const, name: 'Editor', appIconHash: 'a'.repeat(64) };
    const source = makeSource('window', {
      id: 'saved-window', name: 'Editor', captureId: 'window:1:0', captureTarget: target, captureAudioEnabled: false,
    });
    const option: DesktopSourceOption = { id: 'window:1:0', name: 'Editor', kind: 'window', thumbnail: '', appIconHash: target.appIconHash };
    const api = {
      ...makeApi(),
      resolveDesktopCapture: vi.fn(async () => option),
      prepareDesktopCapture: vi.fn(async () => undefined),
    } as unknown as StreamAPI;
    const params = makeHookParams(source, { api });
    const runtimeId = params.allSources[0]!.id;
    const track = new FakeTrack('video', 'Editor');
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

  it('keeps camera video active with a warning when an explicitly selected audio input is denied', async () => {
    const source = makeSource('camera', { captureAudioEnabled: true, audioDeviceId: 'audio-usb-1' });
    const setActionError = vi.fn();
    const params = { ...makeHookParams(source), setActionError };
    const runtimeSource = params.allSources[0]!;
    const video = fakeStream(new FakeTrack('video', 'Webcam'));
    mediaDevices = installMediaDevices(async () => video);
    mediaDevices.getUserMedia.mockResolvedValueOnce(video).mockRejectedValueOnce(new Error('Audio input permission denied'));
    const { result } = renderHook(() => useCapture(params));

    await waitFor(() => expect(result.current.runtimes.current.get(runtimeSource.id)).toBe(video));
    expect(result.current.sourceStatuses[runtimeSource.id]).toMatchObject({ state: 'warning', message: expect.stringContaining('Audio input permission denied') });
    expect(mixerMock.instances).toHaveLength(0);
    expect(setActionError).toHaveBeenCalledWith(expect.stringContaining('Video remains active'));
  });

  it('clears a camera audio warning when an explicit input later recovers', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const source = makeSource('camera', { captureAudioEnabled: true });
    const params = makeHookParams(source, { programSourceIds: new Set<string>() });
    const runtimeSource = params.allSources[0]!;
    const videoTrack = new FakeTrack('video', 'Webcam');
    const videoStream = fakeStream(videoTrack);
    const audioStream = fakeStream(new FakeTrack('audio', 'USB microphone'));
    mediaDevices = installMediaDevices(async () => videoStream);
    const { result } = renderHook(() => useCapture(params));

    await waitFor(() => expect(result.current.sourceStatuses[runtimeSource.id]?.state).toBe('warning'));
    expect(result.current.runtimes.current.get(runtimeSource.id)?.getVideoTracks()).toEqual([videoTrack]);
    expect(result.current.runtimes.current.get(runtimeSource.id)?.getAudioTracks()).toHaveLength(0);

    mediaDevices.getUserMedia.mockResolvedValueOnce(audioStream);
    await act(async () => {
      await result.current.updateCameraAudioSettings(runtimeSource, { captureAudioEnabled: true, audioDeviceId: 'audio-usb-1' });
    });

    const recoveredSource = { ...source, captureAudioEnabled: true, audioDeviceId: 'audio-usb-1' };
    const recoveredRuntimeId = toRuntimeProject(makeProject(recoveredSource)).scenes[0]!.sources[0]!.id;
    const recoveredRuntime = result.current.runtimes.current.get(recoveredRuntimeId)!;
    expect(recoveredRuntime.getVideoTracks()).toHaveLength(1);
    expect(recoveredRuntime.getAudioTracks()).toHaveLength(1);
    expect(result.current.sourceStatuses[recoveredRuntimeId]).toEqual({ state: 'ready' });
  });

  it('upgrades a retained Program camera runtime when audio recovers with the same device settings', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const source = makeSource('camera', { captureAudioEnabled: true, audioDeviceId: 'audio-usb-1' });
    const params = makeHookParams(source);
    const programSource = params.allSources[0]!;
    const programRuntimeId = programSource.id;
    const programSourceIds = new Set([programRuntimeId]);
    const videoTrack = new FakeTrack('video', 'Webcam');
    const recoveredAudio = fakeStream(new FakeTrack('audio', 'USB microphone'));
    const initialVideo = fakeStream(videoTrack);
    mediaDevices = installMediaDevices(async () => initialVideo);
    mediaDevices.getUserMedia.mockResolvedValueOnce(initialVideo).mockRejectedValueOnce(new Error('Audio input permission denied'));
    const { result, rerender } = renderHook(({ current }: { current: UseCaptureParams }) => useCapture(current), { initialProps: { current: params } });

    await waitFor(() => expect(result.current.sourceStatuses[programRuntimeId]?.state).toBe('warning'));
    expect(result.current.runtimes.current.get(programRuntimeId)?.getAudioTracks()).toHaveLength(0);

    await act(async () => {
      await result.current.updateCameraAudioSettings(programSource, { captureAudioEnabled: false, audioDeviceId: 'audio-usb-1' });
    });
    const previewOffSource = { ...source, captureAudioEnabled: false };
    const previewOffParams = makeHookParams(previewOffSource, {
      api: params.api,
      runtimeProgramProject: params.programProject!,
      programSourceIds,
    });
    const previewOffRuntime = previewOffParams.allSources[0]!;
    const previewOffRuntimeId = previewOffRuntime.id;
    rerender({ current: previewOffParams });
    await waitFor(() => expect(result.current.runtimes.current.get(previewOffRuntimeId)?.getVideoTracks()).toHaveLength(1));
    expect(result.current.runtimes.current.get(programRuntimeId)?.getVideoTracks()).toHaveLength(1);
    expect(programSourceIds).toContain(programRuntimeId);

    mediaDevices.getUserMedia.mockResolvedValueOnce(recoveredAudio);
    await act(async () => {
      await result.current.updateCameraAudioSettings(previewOffRuntime, { captureAudioEnabled: true, audioDeviceId: 'audio-usb-1' });
    });

    const recoveredRuntime = result.current.runtimes.current.get(programRuntimeId)!;
    expect(recoveredRuntime.getVideoTracks()).toHaveLength(1);
    expect(recoveredRuntime.getAudioTracks()).toHaveLength(1);
    expect(recoveredRuntime.getAudioTracks()[0]?.readyState).toBe('live');
    expect(result.current.sourceStatuses[programRuntimeId]).toEqual({ state: 'ready' });

    const recoveredSource = { ...source, captureAudioEnabled: true };
    const recoveredParams = makeHookParams(recoveredSource, {
      api: params.api,
      runtimeProgramProject: params.programProject!,
      programSourceIds,
    });
    rerender({ current: recoveredParams });
    await waitFor(() => expect(mixerMock.instances[0]?.setProgramActive).toHaveBeenLastCalledWith(programRuntimeId, true));
  });

  it('keeps an ordinary duplicate camera stream when both runtimes already have audio', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const source = makeSource('camera', { captureAudioEnabled: true, audioDeviceId: 'audio-usb-1' });
    const params = makeHookParams(source, { activeSourceIds: new Set<string>() });
    const runtimeSource = params.allSources[0]!;
    const existingVideo = new FakeTrack('video', 'Existing webcam');
    const existingAudio = new FakeTrack('audio', 'Existing microphone');
    const duplicateVideo = new FakeTrack('video', 'Duplicate webcam');
    const duplicateAudio = new FakeTrack('audio', 'Duplicate microphone');
    mediaDevices = installMediaDevices(async () => fakeStream());
    const { result } = renderHook(() => useCapture(params));

    await act(async () => { await result.current.attachRuntime(runtimeSource, fakeStream(existingVideo, existingAudio)); });
    await act(async () => { await result.current.attachRuntime(runtimeSource, fakeStream(duplicateVideo, duplicateAudio)); });

    expect(result.current.runtimes.current.get(runtimeSource.id)?.getTracks()).toEqual([existingVideo, existingAudio]);
    expect(existingVideo.stop).not.toHaveBeenCalled();
    expect(existingAudio.stop).not.toHaveBeenCalled();
    expect(duplicateVideo.stop).toHaveBeenCalledOnce();
    expect(duplicateAudio.stop).toHaveBeenCalledOnce();
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
    expect(mixerMock.instances[0]?.sourceIds() ?? []).not.toContain(oldRuntimeSource.id);
  });

  it('disables window system audio by cloning its video track and removing the route after commit', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const source: StreamSource = {
      id: 'window-source', name: 'Window', kind: 'window', visible: true, muted: false, volume: 1,
      transform: { x: 0, y: 0, width: 320, height: 240 }, captureId: 'window:1', cursorMode: 'motion', captureAudioEnabled: true,
    };
    const api = makeApi();
    const params = makeHookParams(source, { api, programSourceIds: new Set<string>(), activeSourceIds: new Set<string>() });
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
    expect(mixerMock.instances[0]?.sourceIds() ?? []).not.toContain(oldRuntimeSource.id);
    expect(result.current.runtimes.current.get(nextRuntimeSource.id)?.getVideoTracks()).toHaveLength(1);
  });

  it('defaults new window capture to video only without an explicit audio selection', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
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

    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
    expect(api.prepareDesktopCapture).toHaveBeenCalledWith(option.id, false);
    const capturedSource = (params.addToActiveScene as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as StreamSource;
    expect(capturedSource).toMatchObject({ kind: 'window', captureAudioEnabled: false });
    expect(capturedSource.captureAudioMode).toBeUndefined();
    expect(audioTrack.stop).toHaveBeenCalledOnce();
    expect(mixerMock.instances).toHaveLength(0);
  });

  it('ignores a stale audio-mode override and blocks application enumeration for window pickers', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const target = { kind: 'window' as const, name: 'Editor', appIconHash: 'a'.repeat(64) };
    const source = makeSource('window', {
      id: 'window-reconnect', name: 'Editor', captureId: 'window:old', captureTarget: target,
      captureAudioEnabled: true, captureAudioMode: 'application', captureAudioApplicationPath: '/Applications/Editor.app',
    });
    const option: DesktopSourceOption = { id: 'window:new', name: 'Editor', kind: 'window', thumbnail: '', appIconHash: target.appIconHash };
    const api = {
      ...makeApi(),
      listDesktopSources: vi.fn(async () => [option]),
    } as unknown as StreamAPI;
    const params = makeHookParams(source, { api, activeSourceIds: new Set<string>(), programSourceIds: new Set<string>() });
    const setActionError = params.setActionError as ReturnType<typeof vi.fn>;
    mediaDevices = installMediaDevices(async () => fakeStream());
    const videoTrack = new FakeTrack('video', 'Editor video');
    const getDisplayMedia = vi.fn(async () => fakeStream(videoTrack));
    Object.assign(mediaDevices, { getDisplayMedia });
    const { result } = renderHook(() => useCapture(params));

    await act(async () => { await result.current.openCapturePicker('window', source.id, 'application'); });
    act(() => result.current.onLoadCaptureAudioApplications());

    expect(result.current.captureAudioMode).toBe('off');
    expect(api.listAudioApplications).not.toHaveBeenCalled();
    expect(api.listDesktopSources).toHaveBeenCalledWith('window');

    const unrelatedApplication = { pid: 42, name: 'Meeting app', path: '/Applications/Meeting.app' };
    act(() => result.current.setCaptureAudioMode('application'));
    act(() => result.current.onSelectCaptureAudioApplication(unrelatedApplication));
    await act(async () => { await result.current.addDesktopCapture(option); });

    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
    expect(api.prepareDesktopCapture).toHaveBeenCalledWith(option.id, false);
    expect(api.listAudioApplications).not.toHaveBeenCalled();
    expect(api.startApplicationAudioCapture).not.toHaveBeenCalled();
    expect(api.startSystemAudioCapture).not.toHaveBeenCalled();
    const [, updateSource] = (params.updateSource as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(updateSource(source)).toMatchObject({ captureId: option.id, captureAudioEnabled: false });
    expect(updateSource(source).captureAudioMode).toBeUndefined();
    expect(updateSource(source).captureAudioApplicationPath).toBeUndefined();
    expect(videoTrack.readyState).toBe('live');
    expect(setActionError).toHaveBeenCalledWith(expect.stringContaining('Window-only audio is unavailable'));
  });

  it('does not reopen capture to enable window audio when called directly', async () => {
    const source = makeSource('window', { id: 'window-direct-toggle', captureAudioEnabled: false });
    const api = {
      ...makeApi(),
      listDesktopSources: vi.fn(async () => []),
    } as unknown as StreamAPI;
    const setActionError = vi.fn();
    const params = {
      ...makeHookParams(source, { api, activeSourceIds: new Set<string>(), programSourceIds: new Set<string>() }),
      setActionError,
    };
    mediaDevices = installMediaDevices(async () => fakeStream());
    const runtimeSource = params.allSources[0]!;
    const { result } = renderHook(() => useCapture(params));

    await act(async () => { await result.current.toggleDesktopCaptureAudio(runtimeSource, true); });

    expect(api.listDesktopSources).not.toHaveBeenCalled();
    expect(api.listAudioApplications).not.toHaveBeenCalled();
    expect(params.updateSource).not.toHaveBeenCalled();
    expect(result.current.sourceStatuses[runtimeSource.id]).toMatchObject({ state: 'warning', message: expect.stringContaining('Window-only audio is unavailable') });
    expect(setActionError).toHaveBeenCalledWith(expect.stringContaining('Window-only audio is unavailable'));
  });

  it('strips an already attached broad audio track from a window runtime while keeping video', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const source = makeSource('window', { id: 'window-composite', captureAudioEnabled: false });
    const params = makeHookParams(source, { activeSourceIds: new Set<string>(), programSourceIds: new Set<string>() });
    const runtimeSource = params.allSources[0]!;
    mediaDevices = installMediaDevices(async () => fakeStream());
    const videoTrack = new FakeTrack('video', 'Window video');
    const broadAudioTrack = new FakeTrack('audio', 'System mix');
    const { result } = renderHook(() => useCapture(params));

    await act(async () => { await result.current.attachRuntime(runtimeSource, fakeStream(videoTrack)); });
    const previousRuntime = result.current.runtimes.current.get(runtimeSource.id)!;
    const mixer = result.current.ensureMixer();
    await act(async () => { await mixer.add(runtimeSource.id, previousRuntime, {} as never); });
    await act(async () => { await result.current.attachRuntime(runtimeSource, fakeStream(videoTrack, broadAudioTrack)); });
    await waitFor(() => expect(broadAudioTrack.stop).toHaveBeenCalledOnce());

    const runtime = result.current.runtimes.current.get(runtimeSource.id)!;
    expect(runtime.getVideoTracks()).toHaveLength(1);
    expect(runtime.getVideoTracks()[0]).not.toBe(videoTrack);
    expect(runtime.getVideoTracks()[0]?.readyState).toBe('live');
    expect(videoTrack.stop).toHaveBeenCalledOnce();
    expect(runtime.getAudioTracks()).toHaveLength(0);
    expect(mixer.sourceIds()).not.toContain(runtimeSource.id);
    expect(result.current.sourceStatuses[runtimeSource.id]).toMatchObject({ state: 'warning', message: expect.stringContaining('Window-only audio is unavailable') });
  });

  it.each(['system', 'application'] as const)('rejects direct %s audio mode for windows and captures video only', async (mode) => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const option: DesktopSourceOption = { id: 'window:1', name: 'Editor', kind: 'window', thumbnail: '' };
    const application = { pid: 42, name: 'Editor', path: '/Applications/Editor.app/Contents/MacOS/Editor' };
    const api = {
      ...makeApi(),
      platform: 'win32',
      listDesktopSources: vi.fn(async () => [option]),
      prepareDesktopCapture: vi.fn(async () => undefined),
    } as unknown as StreamAPI;
    const setActionError = vi.fn();
    const params = { ...makeHookParams(makeSource('media'), { api }), setActionError };
    const videoTrack = new FakeTrack('video', 'Editor');
    const audioTrack = new FakeTrack('audio', 'System audio');
    const stream = fakeStream(videoTrack, audioTrack);
    mediaDevices = installMediaDevices(async () => fakeStream());
    const getDisplayMedia = vi.fn(async () => stream);
    Object.assign(mediaDevices, { getDisplayMedia });
    const { result } = renderHook(() => useCapture(params));

    await act(async () => { await result.current.openCapturePicker('window'); });
    act(() => result.current.setCaptureAudioMode(mode));
    expect(result.current.captureAudioMode).toBe(mode);
    if (mode === 'application') act(() => result.current.onSelectCaptureAudioApplication(application));
    await act(async () => { await result.current.addDesktopCapture(option); });

    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
    expect(api.prepareDesktopCapture).toHaveBeenCalledWith(option.id, false);
    const capturedSource = (params.addToActiveScene as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as StreamSource;
    const runtimeId = toRuntimeProject(makeProject(capturedSource)).scenes[0]!.sources[0]!.id;
    expect(capturedSource).toMatchObject({ kind: 'window', captureAudioEnabled: false });
    expect(capturedSource.captureAudioMode).toBeUndefined();
    expect(audioTrack.stop).toHaveBeenCalledOnce();
    expect(result.current.runtimes.current.get(runtimeId)?.getVideoTracks()).toHaveLength(1);
    expect(result.current.runtimes.current.get(runtimeId)?.getAudioTracks()).toHaveLength(0);
    expect(api.startSystemAudioCapture).not.toHaveBeenCalled();
    expect(api.startApplicationAudioCapture).not.toHaveBeenCalled();
    expect(setActionError).toHaveBeenCalledWith(expect.stringContaining('Window-only audio is unavailable'));
  });

  it('combines explicitly selected application audio with screen capture in one runtime', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const option: DesktopSourceOption = { id: 'screen:1', name: 'Display', kind: 'screen', thumbnail: '' };
    const application = { pid: 42, name: 'Editor', path: '/Applications/Editor.app/Contents/MacOS/Editor' };
    const api = {
      ...makeApi(),
      listDesktopSources: vi.fn(async () => [option]),
      prepareDesktopCapture: vi.fn(async () => undefined),
      listAudioApplications: vi.fn(async () => [application]),
    } as unknown as StreamAPI;
    const params = makeHookParams(makeSource('media'), { api });
    const capturedVideoTrack = new FakeTrack('video', 'Editor');
    const capturedStream = fakeStream(capturedVideoTrack);
    mediaDevices = installMediaDevices(async () => fakeStream());
    const getDisplayMedia = vi.fn(async () => capturedStream);
    Object.assign(mediaDevices, { getDisplayMedia });
    const { result } = renderHook(() => useCapture(params));

    await act(async () => { await result.current.openCapturePicker('screen'); });
    act(() => result.current.setCaptureAudioMode('application'));
    act(() => result.current.onSelectCaptureAudioApplication(application));
    await act(async () => { await result.current.addDesktopCapture(option); });

    const capturedSource = (params.addToActiveScene as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as StreamSource;
    const runtimeId = toRuntimeProject(makeProject(capturedSource)).scenes[0]!.sources[0]!.id;
    const runtime = result.current.runtimes.current.get(runtimeId)!;
    expect(capturedSource).toMatchObject({ kind: 'display', captureAudioEnabled: true, captureAudioMode: 'application', captureAudioApplicationPath: application.path });
    expect(api.startApplicationAudioCapture).toHaveBeenCalledWith(runtimeId, application.pid, application.path);
    expect(runtime.getVideoTracks()).toHaveLength(1);
    expect(runtime.getVideoTracks()[0]).not.toBe(capturedVideoTrack);
    expect(runtime.getVideoTracks()[0]?.readyState).toBe('live');
    expect(runtime.getAudioTracks()).toHaveLength(1);
    expect(mixerMock.instances[0]?.add).toHaveBeenCalledWith(runtimeId, runtime, expect.any(Object));
    expect(capturedVideoTrack.stop).toHaveBeenCalledOnce();
  });

  it('clones new screen video before replacing an existing video-only runtime with native audio', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const target = { kind: 'screen' as const, name: 'Display', displayId: 'display-1' };
    const source = makeSource('display', {
      id: 'saved-display', name: 'Display', captureId: 'screen:1:0', captureTarget: target,
      captureAudioEnabled: true, captureAudioMode: 'application', captureAudioApplicationPath: '/Applications/Editor.app',
    });
    const option: DesktopSourceOption = { id: 'screen:1:0', name: 'Display', kind: 'screen', thumbnail: '', displayId: target.displayId };
    const application = { pid: 42, name: 'Editor', path: '/Applications/Editor.app' };
    const api = {
      ...makeApi(),
      listDesktopSources: vi.fn(async () => [option]),
      listAudioApplications: vi.fn(async () => [application]),
      prepareDesktopCapture: vi.fn(async () => undefined),
    } as unknown as StreamAPI;
    const params = makeHookParams(source, { api, activeSourceIds: new Set<string>(), programSourceIds: new Set<string>() });
    const runtimeId = params.allSources[0]!.id;
    const oldVideoTrack = new FakeTrack('video', 'Previous video');
    const newVideoTrack = new FakeTrack('video', 'New video');
    const newVideoStream = fakeStream(newVideoTrack);
    mediaDevices = installMediaDevices(async () => fakeStream());
    Object.assign(mediaDevices, { getDisplayMedia: vi.fn(async () => newVideoStream) });
    const { result } = renderHook(() => useCapture(params));

    await act(async () => { await result.current.attachRuntime(params.allSources[0]!, fakeStream(oldVideoTrack)); });
    await act(async () => { await result.current.openCapturePicker('screen', source.id); });
    act(() => result.current.onSelectCaptureAudioApplication(application));
    await act(async () => { await result.current.addDesktopCapture(option); });

    const runtime = result.current.runtimes.current.get(runtimeId)!;
    expect(oldVideoTrack.stop).toHaveBeenCalledOnce();
    expect(newVideoTrack.stop).toHaveBeenCalledOnce();
    expect(runtime.getVideoTracks()).toHaveLength(1);
    expect(runtime.getVideoTracks()[0]).not.toBe(newVideoTrack);
    expect(runtime.getVideoTracks()[0]?.readyState).toBe('live');
    expect(runtime.getAudioTracks()).toHaveLength(1);
    expect(runtime.getAudioTracks()[0]?.readyState).toBe('live');
  });

  it('keeps screen video live and reports a warning when explicit application audio fails', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const option: DesktopSourceOption = { id: 'screen:1', name: 'Display', kind: 'screen', thumbnail: '' };
    const application = { pid: 42, name: 'Editor', path: '/Applications/Editor.app/Contents/MacOS/Editor' };
    const api = {
      ...makeApi(),
      listDesktopSources: vi.fn(async () => [option]),
      prepareDesktopCapture: vi.fn(async () => undefined),
      startApplicationAudioCapture: vi.fn(async () => { throw new Error('Audio helper unavailable'); }),
    } as unknown as StreamAPI;
    const setActionError = vi.fn();
    const params = { ...makeHookParams(makeSource('media'), { api }), setActionError };
    const videoTrack = new FakeTrack('video', 'Editor');
    const stream = fakeStream(videoTrack);
    mediaDevices = installMediaDevices(async () => fakeStream());
    Object.assign(mediaDevices, { getDisplayMedia: vi.fn(async () => stream) });
    const { result } = renderHook(() => useCapture(params));

    await act(async () => { await result.current.openCapturePicker('screen'); });
    act(() => result.current.setCaptureAudioMode('application'));
    act(() => result.current.onSelectCaptureAudioApplication(application));
    await act(async () => { await result.current.addDesktopCapture(option); });

    const capturedSource = (params.addToActiveScene as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as StreamSource;
    const runtimeId = toRuntimeProject(makeProject(capturedSource)).scenes[0]!.sources[0]!.id;
    expect(result.current.runtimes.current.get(runtimeId)?.getVideoTracks()).toEqual([videoTrack]);
    expect(videoTrack.readyState).toBe('live');
    expect(result.current.sourceStatuses[runtimeId]?.state).toBe('warning');
    expect(setActionError).toHaveBeenCalledWith(expect.stringContaining('Video capture is still active'));
  });

  it('keeps screen video live when the native helper reports an error before startup resolves', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const target = { kind: 'screen' as const, name: 'Display', displayId: 'display-1' };
    const source = makeSource('display', {
      id: 'native-startup-error',
      name: 'Display',
      captureId: 'screen:previous',
      captureTarget: target,
      captureAudioEnabled: false,
    });
    const option: DesktopSourceOption = { id: 'screen:startup-error', name: 'Display', kind: 'screen', thumbnail: '', displayId: target.displayId };
    const application = { pid: 42, name: 'Editor', path: '/Applications/Editor.app' };
    const nativeStart = deferred<void>();
    const nativeStartCalled = deferred<void>();
    let onAudioFrame: ((sourceId: string, frame: ArrayBuffer | { error: string }) => void) | undefined;
    const api = {
      ...makeApi(),
      listDesktopSources: vi.fn(async () => [option]),
      listAudioApplications: vi.fn(async () => [application]),
      prepareDesktopCapture: vi.fn(async () => undefined),
      startApplicationAudioCapture: vi.fn(() => { nativeStartCalled.resolve(); return nativeStart.promise; }),
      startSystemAudioCapture: vi.fn(async () => undefined),
      onApplicationAudioFrame: vi.fn((listener: (sourceId: string, frame: ArrayBuffer | { error: string }) => void) => {
        onAudioFrame = listener;
        return () => undefined;
      }),
    } as unknown as StreamAPI;
    const setActionError = vi.fn();
    const params = { ...makeHookParams(source, { api, activeSourceIds: new Set(), programSourceIds: new Set() }), setActionError };
    const videoTrack = new FakeTrack('video', 'Editor');
    const stream = fakeStream(videoTrack);
    mediaDevices = installMediaDevices(async () => fakeStream());
    Object.assign(mediaDevices, { getDisplayMedia: vi.fn(async () => stream) });
    const { result } = renderHook(() => useCapture(params));

    await act(async () => { await result.current.openCapturePicker('screen', source.id); });
    act(() => result.current.setCaptureAudioMode('application'));
    act(() => result.current.onSelectCaptureAudioApplication(application));
    let runtimeId = '';
    await act(async () => {
      const addCapture = result.current.addDesktopCapture(option);
      await nativeStartCalled.promise;
      runtimeId = (api.startApplicationAudioCapture as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      onAudioFrame?.(runtimeId, { error: 'Native helper failed to start' });
      nativeStart.resolve();
      await addCapture;
    });

    const runtime = result.current.runtimes.current.get(runtimeId);
    expect(runtime?.getVideoTracks().some((track) => track.readyState === 'live')).toBe(true);
    expect(videoTrack.readyState).toBe('live');
    expect(result.current.sourceStatuses[runtimeId]).toMatchObject({ state: 'warning', message: expect.stringContaining('Native helper failed to start') });
    expect(result.current.applicationAudioInputs.current.has(runtimeId)).toBe(false);
    const input = await mixerMock.instances[0]!.createApplicationAudioInput.mock.results[0]!.value;
    expect(input.close).toHaveBeenCalledOnce();
    expect(api.stopApplicationAudioCapture).toHaveBeenCalledOnce();
    expect(api.startSystemAudioCapture).not.toHaveBeenCalled();
    expect(setActionError).toHaveBeenCalledWith(expect.stringContaining('Video capture is still active'));
  });

  it('stops cloned screen helper audio when the established native helper fails and keeps its video', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const target = { kind: 'screen' as const, name: 'Display', displayId: 'display-1' };
    const application = { pid: 42, name: 'Editor', path: '/Applications/Editor.app' };
    const source = makeSource('display', {
      id: 'native-helper-audio-cleanup',
      name: 'Display',
      captureId: 'screen:cleanup:0',
      captureTarget: target,
      captureAudioEnabled: true,
      captureAudioMode: 'application',
      captureAudioApplicationPath: application.path,
    });
    const option: DesktopSourceOption = {
      id: source.captureId!, name: 'Display', kind: 'screen', thumbnail: '', displayId: target.displayId,
    };
    let onAudioFrame: ((sourceId: string, frame: ArrayBuffer | { error: string }) => void) | undefined;
    const api = {
      ...makeApi(),
      resolveDesktopCapture: vi.fn(async () => option),
      prepareDesktopCapture: vi.fn(async () => undefined),
      listAudioApplications: vi.fn(async () => [application]),
      onApplicationAudioFrame: vi.fn((listener: (sourceId: string, frame: ArrayBuffer | { error: string }) => void) => {
        onAudioFrame = listener;
        return () => undefined;
      }),
    } as unknown as StreamAPI;
    const params = makeHookParams(source, { api });
    const runtimeId = params.allSources[0]!.id;
    const capturedVideo = new FakeTrack('video', 'Editor');
    mediaDevices = installMediaDevices(async () => fakeStream(capturedVideo));
    const { result } = renderHook(() => useCapture(params));

    await waitFor(() => expect(result.current.runtimes.current.get(runtimeId)?.getAudioTracks()).toHaveLength(1));
    const mixer = mixerMock.instances[0]!;
    const previousRuntime = result.current.runtimes.current.get(runtimeId)!;
    const clonedVideo = previousRuntime.getVideoTracks()[0]!;
    const clonedAudio = previousRuntime.getAudioTracks()[0]!;

    act(() => onAudioFrame?.(runtimeId, { error: 'Native helper exited' }));
    await waitFor(() => expect(result.current.runtimes.current.get(runtimeId)?.getAudioTracks()).toHaveLength(0));
    await waitFor(() => expect(result.current.sourceStatuses[runtimeId]?.state).toBe('warning'));

    expect(result.current.runtimes.current.get(runtimeId)?.getVideoTracks()[0]).toBe(clonedVideo);
    expect(clonedVideo.readyState).toBe('live');
    expect(clonedAudio.readyState).toBe('ended');
    expect(clonedAudio.stop).toHaveBeenCalledOnce();
    expect(result.current.applicationAudioInputs.current.has(runtimeId)).toBe(false);
    expect(api.stopApplicationAudioCapture).toHaveBeenCalledOnce();
    const input = await mixer.createApplicationAudioInput.mock.results[0]!.value;
    expect(input.close).toHaveBeenCalledOnce();
    expect(mixer.add).toHaveBeenCalledOnce();
    expect(mixer.remove).toHaveBeenCalledOnce();
    expect(mixer.sourceIds()).not.toContain(runtimeId);
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

  it('keeps screen video active and reports when explicitly requested Windows system audio is missing', async () => {
    const option: DesktopSourceOption = { id: 'screen:1', name: 'Display', kind: 'screen', thumbnail: '' };
    const api = {
      ...makeApi(),
      platform: 'win32',
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

    await act(async () => { await result.current.openCapturePicker('screen'); });
    act(() => result.current.setCaptureAudioMode('system'));
    await act(async () => { await result.current.addDesktopCapture(option); });

    const capturedSource = (params.addToActiveScene as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as StreamSource;
    expect(capturedSource).toMatchObject({ kind: 'display', captureAudioEnabled: true, captureAudioMode: 'system' });
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

  it('stops a camera after its final visible owner is hidden and restores the same runtime when shown again', async () => {
    const source = makeSource('camera', { id: 'hidden-camera-owner' });
    const params = makeHookParams(source);
    const runtimeSource = params.allSources[0]!;
    const runtimeId = runtimeSource.id;
    const firstTrack = new FakeTrack('video', 'Camera before hide');
    const shownAgainTrack = new FakeTrack('video', 'Camera after reshow');
    const firstStream = fakeStream(firstTrack);
    const shownAgainStream = fakeStream(shownAgainTrack);
    mediaDevices = installMediaDevices(async () => mediaDevices!.getUserMedia.mock.calls.length === 1 ? firstStream : shownAgainStream);
    const { result, rerender } = renderHook(({ current }: { current: UseCaptureParams }) => useCapture(current), { initialProps: { current: params } });

    await waitFor(() => expect(result.current.runtimes.current.get(runtimeId)).toBe(firstStream));
    const emptyProject = toRuntimeProject(makeProject(null));
    const hiddenIds = new Set<string>();
    rerender({ current: {
      ...params,
      project: emptyProject,
      projectRef: { current: emptyProject },
      allSources: [],
      allSourcesRef: { current: [] },
      programProject: emptyProject,
      programSourceIds: new Set(),
      activeSourceIds: hiddenIds,
      activeSourceIdsRef: { current: hiddenIds },
      liveScene: emptyProject.scenes[0]!,
    } });

    await waitFor(() => expect(firstTrack.stop).toHaveBeenCalledOnce());
    expect(result.current.runtimes.current.has(runtimeId)).toBe(false);

    rerender({ current: params });
    await waitFor(() => expect(result.current.runtimes.current.get(runtimeId)).toBe(shownAgainStream));

    expect(runtimeSource.originSourceId).toBe(source.id);
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    expect(shownAgainTrack.readyState).toBe('live');
  });

  it('stops screen helper capture when its final visible owner is hidden and restores the same binding on reshow', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const target = { kind: 'screen' as const, name: 'Display', displayId: 'display-1' };
    const application = { pid: 42, name: 'Editor', path: '/Applications/Editor.app' };
    const source = makeSource('display', {
      id: 'hidden-display-owner', name: 'Display', captureId: 'screen:hidden-owner:0', captureTarget: target,
      captureBindingId: '44444444-4444-4444-8444-444444444444',
      cursorMode: 'motion', captureAudioEnabled: true, captureAudioMode: 'application',
      captureAudioApplicationPath: application.path,
    });
    const option: DesktopSourceOption = { id: source.captureId!, name: source.name, kind: 'screen', thumbnail: '', displayId: target.displayId };
    const api = {
      ...makeApi(),
      resolveDesktopCapture: vi.fn(async () => option),
      prepareDesktopCapture: vi.fn(async () => undefined),
      listAudioApplications: vi.fn(async () => [application]),
    } as unknown as StreamAPI;
    const params = makeHookParams(source, { api });
    const runtimeId = params.allSources[0]!.id;
    const firstCaptureTrack = new FakeTrack('video', 'Window before hide');
    const shownAgainCaptureTrack = new FakeTrack('video', 'Window after reshow');
    const firstCapture = fakeStream(firstCaptureTrack);
    const shownAgainCapture = fakeStream(shownAgainCaptureTrack);
    mediaDevices = installMediaDevices(async () => mediaDevices!.getUserMedia.mock.calls.length === 1 ? firstCapture : shownAgainCapture);
    const { result, rerender } = renderHook(({ current }: { current: UseCaptureParams }) => useCapture(current), { initialProps: { current: params } });

    await waitFor(() => expect(result.current.runtimes.current.get(runtimeId)?.getAudioTracks()).toHaveLength(1));
    const firstRuntime = result.current.runtimes.current.get(runtimeId)!;
    const firstRuntimeVideo = firstRuntime.getVideoTracks()[0]!;
    const firstRuntimeAudio = firstRuntime.getAudioTracks()[0]!;
    const firstAudioInput = result.current.applicationAudioInputs.current.get(runtimeId)!;
    const mixer = mixerMock.instances[0]!;
    expect(api.startApplicationAudioCapture).toHaveBeenCalledOnce();
    expect(params.allSources[0]?.captureBindingId).toBe(source.captureBindingId);
    const emptyProject = toRuntimeProject(makeProject(null));
    const hiddenIds = new Set<string>();
    rerender({ current: {
      ...params,
      project: emptyProject,
      projectRef: { current: emptyProject },
      allSources: [],
      allSourcesRef: { current: [] },
      programProject: emptyProject,
      programSourceIds: new Set(),
      activeSourceIds: hiddenIds,
      activeSourceIdsRef: { current: hiddenIds },
      liveScene: emptyProject.scenes[0]!,
    } });

    await waitFor(() => expect(firstRuntimeVideo.readyState).toBe('ended'));
    expect(firstRuntimeAudio.readyState).toBe('ended');
    expect(result.current.runtimes.current.has(runtimeId)).toBe(false);
    expect(result.current.applicationAudioInputs.current.has(runtimeId)).toBe(false);
    expect(api.stopApplicationAudioCapture).toHaveBeenCalledOnce();
    expect(firstAudioInput.close).toHaveBeenCalledOnce();
    expect(mixer.remove).toHaveBeenCalledOnce();
    expect(mixer.sourceIds()).not.toContain(runtimeId);

    rerender({ current: params });
    await waitFor(() => expect(api.startApplicationAudioCapture).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.runtimes.current.get(runtimeId)?.getAudioTracks()).toHaveLength(1));
    expect(api.resolveDesktopCapture).toHaveBeenCalledTimes(2);
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    const restoredRuntime = result.current.runtimes.current.get(runtimeId)!;
    expect(restoredRuntime.getVideoTracks()[0]?.readyState).toBe('live');
    expect(result.current.runtimes.current.has(runtimeId)).toBe(true);
    expect(params.allSources[0]?.captureBindingId).toBe(source.captureBindingId);
  });

  it('keeps shared capture and Program audio owned when only the Preview alias is hidden', async () => {
    const previewAlias = makeSource('media', {
      id: 'preview-shared-media', mediaKind: 'video', assetId: 'visible-program-asset', assetExtension: 'mp4', volume: 0.2,
    });
    const programAlias = makeSource('media', {
      id: 'program-shared-media', mediaKind: 'video', assetId: 'visible-program-asset', assetExtension: 'mp4', volume: 0.8,
    });
    const draftProject = makeProject(previewAlias);
    const programProject = toRuntimeProject(makeProject(programAlias));
    const previewRuntime = toRuntimeProject(draftProject).scenes[0]!.sources[0]!;
    const programRuntime = programProject.scenes[0]!.sources[0]!;
    expect(previewRuntime.id).toBe(programRuntime.id);
    const runtimeId = programRuntime.id;
    const allSources = [previewRuntime, programRuntime];
    const params = {
      ...makeHookParams(previewAlias, {
        draftProject,
        runtimeProgramProject: programProject,
        allSources,
        programSourceIds: new Set([runtimeId]),
      }),
      allSources,
      allSourcesRef: { current: allSources },
      programProject,
      programSourceIds: new Set([runtimeId]),
      programSourceOriginIds: new Set([programAlias.id]),
    };
    const audioTrack = new FakeTrack('audio', 'Shared Program audio');
    const stream = fakeStream(audioTrack);
    mediaDevices = installMediaDevices(async () => fakeStream());
    const { result, rerender } = renderHook(({ current }: { current: UseCaptureParams }) => useCapture(current), { initialProps: { current: params } });

    await act(async () => { await result.current.attachRuntime(previewRuntime, stream); });
    const mixer = mixerMock.instances[0]!;
    expect(mixer.sourceIds()).toContain(runtimeId);
    const programOnlySources = [programRuntime];
    rerender({ current: {
      ...params,
      project: toRuntimeProject(makeProject(null)),
      allSources: programOnlySources,
      allSourcesRef: { current: programOnlySources },
      activeSourceIds: new Set([runtimeId]),
      activeSourceIdsRef: { current: new Set([runtimeId]) },
    } });

    expect(result.current.runtimes.current.get(runtimeId)).toBe(stream);
    expect(audioTrack.readyState).toBe('live');
    expect(mixer.remove).not.toHaveBeenCalled();
    expect(mixer.sourceIds()).toContain(runtimeId);
    await waitFor(() => expect(mixer.setProgramActive).toHaveBeenLastCalledWith(runtimeId, true));
  });

  it('keeps hidden Draft camera settings metadata-only when Program owns the same runtime binding', async () => {
    const hiddenDraftSource = makeSource('camera', { id: 'shared-hidden-camera', visible: false, deviceId: 'camera-old' });
    const programSource = { ...hiddenDraftSource, visible: true };
    const draftProject = makeProject(hiddenDraftSource);
    const programProject = toRuntimeProject(makeProject(programSource));
    const hiddenRuntimeSource = toRuntimeProject(draftProject).scenes[0]!.sources[0]!;
    const programRuntimeSource = programProject.scenes[0]!.sources[0]!;
    expect(hiddenRuntimeSource.id).toBe(programRuntimeSource.id);
    const runtimeId = programRuntimeSource.id;
    const activeSourceIds = new Set<string>();
    const allSources = [programRuntimeSource];
    const params = {
      ...makeHookParams(hiddenDraftSource, {
        draftProject,
        runtimeProgramProject: programProject,
        allSources,
        activeSourceIds,
        programSourceIds: new Set([runtimeId]),
      }),
      allSources,
      allSourcesRef: { current: allSources },
      programProject,
      programSourceIds: new Set([runtimeId]),
    };
    mediaDevices = installMediaDevices(async () => fakeStream());
    const { result } = renderHook(() => useCapture(params));

    await act(async () => {
      await result.current.switchInputDevice(hiddenRuntimeSource, 'camera-new');
      await result.current.updateCameraAudioSettings(hiddenRuntimeSource, { captureAudioEnabled: true, audioDeviceId: 'microphone-new' });
      await result.current.updateCameraCaptureSettings(hiddenRuntimeSource, { cameraResolution: '1280x720', cameraFrameRate: 30 });
    });

    expect(params.updateSource).toHaveBeenCalledTimes(3);
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(result.current.runtimes.current.has(runtimeId)).toBe(false);
  });

  it('updates a hidden Draft window binding without restarting its visible Program runtime', async () => {
    const previousTarget = { kind: 'window' as const, name: 'Editor', appIconHash: 'a'.repeat(64) };
    const hiddenDraftSource = makeSource('window', {
      id: 'shared-hidden-window', visible: false, name: 'Editor', captureId: 'window:old:0',
      captureTarget: previousTarget, captureBindingId: '55555555-5555-4555-8555-555555555555',
    });
    const programSource = { ...hiddenDraftSource, visible: true };
    const draftProject = makeProject(hiddenDraftSource);
    const programProject = toRuntimeProject(makeProject(programSource));
    const hiddenRuntimeSource = toRuntimeProject(draftProject).scenes[0]!.sources[0]!;
    const programRuntimeSource = programProject.scenes[0]!.sources[0]!;
    expect(hiddenRuntimeSource.id).toBe(programRuntimeSource.id);
    const runtimeId = programRuntimeSource.id;
    const allSources = [programRuntimeSource];
    const activeSourceIds = new Set<string>();
    const option: DesktopSourceOption = {
      id: 'window:new:0', name: 'Editor Updated', kind: 'window', thumbnail: '', appIconHash: 'b'.repeat(64),
    };
    const api = {
      ...makeApi(),
      listDesktopSources: vi.fn(async () => [option]),
    } as unknown as StreamAPI;
    const params = {
      ...makeHookParams(hiddenDraftSource, {
        api,
        draftProject,
        runtimeProgramProject: programProject,
        allSources,
        activeSourceIds,
        programSourceIds: new Set([runtimeId]),
      }),
      allSources,
      allSourcesRef: { current: allSources },
      programProject,
      programSourceIds: new Set([runtimeId]),
    };
    const programTrack = new FakeTrack('video', 'Program Editor');
    const programStream = fakeStream(programTrack);
    mediaDevices = installMediaDevices(async () => programStream);
    const getDisplayMedia = vi.fn(async () => programStream);
    Object.assign(mediaDevices, { getDisplayMedia });
    const { result } = renderHook(() => useCapture(params));

    await act(async () => { await result.current.attachRuntime(programRuntimeSource, programStream); });
    await act(async () => { await result.current.openCapturePicker('window', hiddenDraftSource.id); });
    await act(async () => { await result.current.addDesktopCapture(option); });

    expect(api.prepareDesktopCapture).not.toHaveBeenCalled();
    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(result.current.runtimes.current.get(runtimeId)).toBe(programStream);
    expect(programTrack.readyState).toBe('live');
    const update = (params.updateSource as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as (current: StreamSource) => StreamSource;
    expect(update(hiddenDraftSource)).toMatchObject({ captureId: option.id, captureTarget: { name: option.name } });
    expect(update(hiddenDraftSource).captureBindingId).not.toBe(hiddenDraftSource.captureBindingId);
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

  it('ignores a stale media route completion after a newer element connection takes ownership', async () => {
    const source = makeSource('media', { audioFilters: { ...DEFAULT_AUDIO_FILTERS, noiseSuppression: true } });
    const setActionError = vi.fn();
    const params = { ...makeHookParams(source), setActionError };
    const runtimeSource = params.allSources[0]!;
    mediaDevices = installMediaDevices(async () => fakeStream());
    const { result, rerender } = renderHook(({ current }: { current: UseCaptureParams }) => useCapture(current), { initialProps: { current: params } });
    act(() => { result.current.ensureMixer(); });
    const mixer = mixerMock.instances[0]!;
    const staleRequest = deferred<boolean>();
    const currentRequest = deferred<boolean>();
    let requestCount = 0;
    mixer.addMediaElement.mockImplementation((id: string) => {
      const request = requestCount++ === 0 ? staleRequest : currentRequest;
      return request.promise.then((ready) => {
        if (ready) mixer.ids.add(id);
        return ready;
      });
    });
    const firstElement = document.createElement('video');
    const secondElement = document.createElement('video');
    let staleConnection!: Promise<void>;
    let currentConnection!: Promise<void>;
    act(() => { staleConnection = result.current.connectMediaElement(runtimeSource, firstElement); });

    const hiddenProject = toRuntimeProject(makeProject(null));
    rerender({ current: {
      ...params,
      project: hiddenProject,
      projectRef: { current: hiddenProject },
      allSources: [],
      allSourcesRef: { current: [] },
      programProject: hiddenProject,
      programSourceIds: new Set(),
      activeSourceIds: new Set(),
      activeSourceIdsRef: { current: new Set() },
    } });
    rerender({ current: params });
    act(() => { currentConnection = result.current.connectMediaElement(runtimeSource, secondElement); });

    await act(async () => { currentRequest.resolve(true); await currentConnection; });
    expect(result.current.sourceStatuses[runtimeSource.id]).toEqual({ state: 'ready' });

    await act(async () => {
      staleRequest.resolve(false);
      await staleConnection.catch(() => undefined);
    });

    expect(result.current.sourceStatuses[runtimeSource.id]).toEqual({ state: 'ready' });
    expect(setActionError).not.toHaveBeenCalled();
    expect(mixer.remove).not.toHaveBeenCalled();
    expect(mixer.sourceIds()).toContain(runtimeSource.id);
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
      setBrowserSourceActivity: vi.fn(async () => undefined),
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
    expect(api.createBrowserSource).toHaveBeenCalledWith(runtimeId, 'https://example.test/', expect.any(Number), expect.any(Number));
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

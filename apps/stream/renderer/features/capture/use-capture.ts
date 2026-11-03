import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { AudioMixerEngine } from '../../audio-mixer';
import { audioOutputDeviceOptions, type AudioOutputDeviceOption } from '../../audio-output-devices';
import { retainDesktopAudioTracks } from '../../desktop-audio-capture';
import { bindDesktopCaptureSource } from '../../desktop-capture-binding';
import { captureTargetForOption } from '../../../shared/capture-target';
import {
  captureAudioModeForSource,
  hasWindowCaptureAudioIntent,
  uniqueAudioApplicationForPath,
  WINDOW_ONLY_AUDIO_UNAVAILABLE_MESSAGE,
  type CaptureAudioMode,
} from '../../../shared/capture-audio';
import { listenForMediaStreamEnd } from '../../media-stream-ended';
import { flattenSourceNodes } from '../../../shared/source-tree';
import {
  createDefaultStreamAudioSettings,
  type AudioApplicationOption,
  type CaptureCursorMode,
  type DesktopSourceOption,
  type StreamAPI,
  type StreamAudioSettings,
  type StreamProject,
  type StreamScene,
  type StreamSource,
} from '../../../shared/desktop-api';
import { friendlyError } from '../shared/friendly-error';
import { getOriginSourceId, getSourceRuntimeId, preserveDesktopCaptureRuntime, toRuntimeSource, type RuntimeSource } from '../../source-runtime';
import { createSource, DEFAULT_AUDIO_FILTERS } from '../sources/helpers';
import { desktopAudioCaptureModeForPlatform, supportsApplicationAudioCapture } from '../../../shared/platform-capabilities';
import { getVisibleSourceIdsForScenes } from '../../../shared/scene-reference-graph';
import { useBrowserSessions } from './use-browser-sessions';
import {
  applyBrowserFrame,
  audioInputCaptureConstraints,
  browserAudioCaptureConstraints,
  combineCaptureStreams,
  explicitAudioInputDevices,
  getInputCaptureStream,
  inputCaptureConstraints,
  listInputDevices,
  monitoringDeviceError,
  pairedCameraAudioDeviceId,
  type InputCaptureKind,
  type InputDeviceOption,
} from './helpers';

export type ApplicationAudioInput = Awaited<ReturnType<AudioMixerEngine['createApplicationAudioInput']>>;

export interface SourceStatus {
  state: 'starting' | 'ready' | 'warning' | 'unavailable';
  message?: string;
}

class CaptureOperationCancelled extends Error {
  constructor() {
    super('Capture operation belongs to an earlier workspace.');
    this.name = 'CaptureOperationCancelled';
  }
}

type DesktopRestoreReason = 'startup' | 'track-ended';

function desktopRestoreConstraints(sourceId: string, frameRate: number, cursorMode: CaptureCursorMode, includeAudio: boolean): MediaStreamConstraints {
  const video = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      maxFrameRate: frameRate,
    },
    cursor: cursorMode,
  } as unknown as MediaTrackConstraints;
  const audio = includeAudio ? {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      echoCancellation: false,
    },
  } as unknown as MediaTrackConstraints : false;
  return { video, audio };
}

function hasLiveVideoTrack(stream: MediaStream): boolean {
  return stream.getVideoTracks().some((track) => track.readyState === 'live');
}

function isCaptureOperationCancelled(error: unknown): boolean {
  return error instanceof CaptureOperationCancelled;
}

export interface UseCaptureParams {
  api: StreamAPI;
  project: StreamProject | null;
  projectRef: RefObject<StreamProject | null>;
  allSources: RuntimeSource[];
  allSourcesRef: RefObject<RuntimeSource[]>;
  /** Committed Program configuration; draft edits never change live audio routes. */
  programProject: StreamProject | null;
  /** Runtime IDs of sources currently visible in Program. */
  programSourceIds: ReadonlySet<string>;
  /** Logical source IDs visible in Program, disambiguating shared runtime resources. */
  programSourceOriginIds?: ReadonlySet<string>;
  /** Runtime resources still owned by an outgoing transition snapshot. */
  retainedSourceIds?: ReadonlySet<string>;
  liveScene: StreamScene | null;
  /** The memoized set of source ids currently rendered (depends on studio mode / multiview) — same value used to gate the RuntimeVideoBank. */
  activeSourceIds: Set<string>;
  /** Mirrors `activeSourceIds` every render, with a temporary override while Multiview is opening/closing — read by async callbacks that must see the current scope after an `await`. */
  activeSourceIdsRef: RefObject<Set<string>>;
  setActionError: (message: string) => void;
  working: boolean;
  setWorking: Dispatch<SetStateAction<boolean>>;
  displayCaptureSystemAudio: boolean;
  /** DOM map of mounted browser-source `<img>` elements, owned by App.tsx (rendered via RuntimeVideoBank). */
  imageElements: RefObject<Map<string, HTMLImageElement>>;
  /** Closes the Sources dock's "Add Source" menu — owned by the sources feature. */
  closeSourceMenu: () => void;
  /** Adds a freshly created source to the active scene — owned by the sources feature. */
  addToActiveScene: (source: StreamSource) => StreamSource;
  /** Generic source patch — owned by the sources feature. */
  updateSource: (sourceId: string, update: (source: StreamSource) => StreamSource) => void;
}

export interface UseCaptureResult {
  runtimes: RefObject<Map<string, MediaStream>>;
  mixer: RefObject<AudioMixerEngine | null>;
  applicationAudioInputs: RefObject<Map<string, ApplicationAudioInput>>;
  applicationAudioSessions: RefObject<Map<string, { pid: number; path: string }>>;
  ensureMixer: () => AudioMixerEngine;
  attachRuntime: (source: StreamSource, stream: MediaStream, preserveNativeAudioInput?: boolean) => Promise<void>;
  stopRuntime: (sourceId: string) => void;
  connectMediaElement: (source: StreamSource, element: HTMLMediaElement) => Promise<void>;
  onMediaPlaybackState: (sourceId: string, element: HTMLMediaElement | null) => void;
  onBrowserElement: (sourceId: string, image: HTMLImageElement) => void;
  mediaPlaybackStates: Record<string, { paused: boolean; ended: boolean }>;
  meterLevels: Record<string, number>;
  sourceStatuses: Record<string, SourceStatus>;
  runtimeRevision: number;
  runtimesSnapshot: Map<string, MediaStream>;
  startApplicationAudioRuntime: (source: StreamSource, application: AudioApplicationOption) => Promise<void>;
  startSystemAudioRuntime: (source: StreamSource) => Promise<void>;
  clearNoiseSuppressionPreference: (sourceId: string) => void;
  /** Tears down every live runtime and capture dialog — called when the active scene collection changes. */
  resetForWorkspaceChange: () => void;

  audioSettings: StreamAudioSettings;
  audioOutputDevices: AudioOutputDeviceOption[];
  audioSettingsError: string;
  updateMonitoringDevice: (monitoringDeviceId: string) => Promise<void>;
  refreshAudioOutputDevices: () => Promise<void>;

  captureOptions: DesktopSourceOption[] | null;
  captureKind: 'screen' | 'window' | 'audio' | null;
  captureTargetSourceId: string | null;
  setCaptureOptions: Dispatch<SetStateAction<DesktopSourceOption[] | null>>;
  setCaptureKind: Dispatch<SetStateAction<'screen' | 'window' | 'audio' | null>>;
  setCaptureTargetSourceId: Dispatch<SetStateAction<string | null>>;
  supportsSystemAudio: boolean;
  supportsApplicationAudio: boolean;
  captureAudioMode: CaptureAudioMode;
  setCaptureAudioMode: Dispatch<SetStateAction<CaptureAudioMode>>;
  captureAudioApplications: AudioApplicationOption[] | null;
  captureAudioApplicationLoading: boolean;
  selectedCaptureAudioApplication: AudioApplicationOption | null;
  onLoadCaptureAudioApplications: () => void;
  onSelectCaptureAudioApplication: (application: AudioApplicationOption | null) => void;
  captureCursorMode: CaptureCursorMode;
  setCaptureCursorMode: Dispatch<SetStateAction<CaptureCursorMode>>;
  openCapturePicker: (kind: 'screen' | 'window' | 'audio', targetSourceId?: string, audioMode?: CaptureAudioMode) => Promise<void>;
  addDesktopCapture: (option: DesktopSourceOption) => Promise<void>;

  applicationAudioOptions: AudioApplicationOption[] | null;
  applicationAudioTargetSourceId: string | null;
  setApplicationAudioOptions: Dispatch<SetStateAction<AudioApplicationOption[] | null>>;
  setApplicationAudioTargetSourceId: Dispatch<SetStateAction<string | null>>;
  openApplicationAudioPicker: (targetSourceId?: string) => Promise<void>;
  addSystemAudioCapture: (targetSourceId?: string) => Promise<void>;
  chooseAudioApplication: (application: AudioApplicationOption) => Promise<void>;

  inputDevicePicker: InputCaptureKind | null;
  inputDeviceOptions: Record<InputCaptureKind, InputDeviceOption[]>;
  cameraAudioEnabled: boolean;
  setCameraAudioEnabled: Dispatch<SetStateAction<boolean>>;
  cameraAudioDeviceId: string;
  setCameraAudioDeviceId: Dispatch<SetStateAction<string>>;
  setInputDevicePicker: Dispatch<SetStateAction<InputCaptureKind | null>>;
  openInputDevicePicker: (kind: InputCaptureKind) => Promise<void>;
  chooseInputDevice: (device: InputDeviceOption) => Promise<void>;
  switchInputDevice: (source: StreamSource, deviceId: string | undefined) => Promise<void>;
  updateCameraAudioSettings: (source: StreamSource, settings: Pick<StreamSource, 'captureAudioEnabled' | 'audioDeviceId'>) => Promise<void>;
  toggleDesktopCaptureAudio: (source: StreamSource, enabled: boolean) => Promise<void>;
  updateCameraCaptureSettings: (source: StreamSource, settings: Pick<StreamSource, 'cameraResolution' | 'cameraFrameRate'>) => Promise<void>;
}

/**
 * Everything to do with acquiring and keeping live media runtimes attached to
 * sources: desktop/window/display capture, camera/microphone, application
 * and system audio, browser-source frames/audio, the shared `AudioMixerEngine`,
 * audio output device selection, and audio level meters. Mirrors the exact
 * effects/timings of the former inline App.tsx implementation.
 */
export function useCapture(params: UseCaptureParams): UseCaptureResult {
  const { api, project, projectRef, allSources, allSourcesRef, programProject, programSourceIds, programSourceOriginIds, activeSourceIds, activeSourceIdsRef, setActionError, working, setWorking, imageElements, closeSourceMenu, addToActiveScene, updateSource } = params;

  const [captureOptions, setCaptureOptions] = useState<DesktopSourceOption[] | null>(null);
  const [captureKind, setCaptureKind] = useState<'screen' | 'window' | 'audio' | null>(null);
  const [captureTargetSourceId, setCaptureTargetSourceId] = useState<string | null>(null);
  const manualCaptureRevision = useRef(0);
  const desktopRestoreQueue = useRef<Promise<void>>(Promise.resolve());
  const captureAudioApplicationRequest = useRef(0);
  const [captureAudioMode, setCaptureAudioMode] = useState<CaptureAudioMode>('off');
  const [captureAudioApplications, setCaptureAudioApplications] = useState<AudioApplicationOption[] | null>(null);
  const [captureAudioApplicationLoading, setCaptureAudioApplicationLoading] = useState(false);
  const [selectedCaptureAudioApplication, setSelectedCaptureAudioApplication] = useState<AudioApplicationOption | null>(null);
  const [applicationAudioOptions, setApplicationAudioOptions] = useState<AudioApplicationOption[] | null>(null);
  const [applicationAudioTargetSourceId, setApplicationAudioTargetSourceId] = useState<string | null>(null);
  const [inputDevicePicker, setInputDevicePicker] = useState<InputCaptureKind | null>(null);
  const [inputDeviceOptions, setInputDeviceOptions] = useState<Record<InputCaptureKind, InputDeviceOption[]>>({ camera: [], microphone: [] });
  const [cameraAudioEnabled, setCameraAudioEnabled] = useState(true);
  const [cameraAudioDeviceId, setCameraAudioDeviceId] = useState('');
  const [captureCursorMode, setCaptureCursorMode] = useState<CaptureCursorMode>('motion');
  const [audioSettings, setAudioSettings] = useState<StreamAudioSettings>(createDefaultStreamAudioSettings);
  const [audioOutputDevices, setAudioOutputDevices] = useState<AudioOutputDeviceOption[]>([]);
  const [audioSettingsError, setAudioSettingsError] = useState('');
  const [meterLevels, setMeterLevels] = useState<Record<string, number>>({});
  const [sourceStatuses, setSourceStatuses] = useState<Record<string, SourceStatus>>({});
  const [mediaPlaybackStates, setMediaPlaybackStates] = useState<Record<string, { paused: boolean; ended: boolean }>>({});
  const [runtimeRevision, setRuntimeRevision] = useState(0);
  const [inputDeviceRevision, setInputDeviceRevision] = useState(0);

  const runtimes = useRef(new Map<string, MediaStream>());
  const runtimeSources = useRef(new Map<string, RuntimeSource>());
  const mediaElementConnectionOwners = useRef(new Map<string, symbol>());
  const previouslyOwnedRuntimeIds = useRef(new Set<string>());
  const runtimeOwnershipEpochs = useRef(new Map<string, number>());
  const applicationAudioInputs = useRef(new Map<string, ApplicationAudioInput>());
  const applicationAudioSessions = useRef(new Map<string, { pid: number; path: string }>());
  const mixer = useRef<AudioMixerEngine | null>(null);
  const audioSettingsRef = useRef(audioSettings);
  audioSettingsRef.current = audioSettings;
  const browserAudioInFlight = useRef(new Set<string>());
  const pendingBrowserFrames = useRef(new Map<string, ArrayBuffer>());
  const nativeAudioStartupFailures = useRef(new WeakMap<ApplicationAudioInput, string>());
  const inputRestoreAttempts = useRef(new Set<string>());
  const inputRestoreInFlight = useRef(new Set<string>());
  const noiseSuppressionFailures = useRef(new Set<string>());
  const restoreBlockedProject = useRef<StreamProject | null>(null);
  const captureSessionGeneration = useRef(0);
  const nativeCaptureLocks = useRef(new Map<string, Promise<void>>());
  const programProjectRef = useRef(programProject);
  const programSourceIdsRef = useRef(programSourceIds);
  const programSourceOriginIdsRef = useRef(programSourceOriginIds);
  const retainedSourceIdsRef = useRef(params.retainedSourceIds ?? new Set<string>());
  programProjectRef.current = programProject;
  programSourceIdsRef.current = programSourceIds;
  programSourceOriginIdsRef.current = programSourceOriginIds;
  retainedSourceIdsRef.current = params.retainedSourceIds ?? new Set<string>();

  const hasRuntimeOwner = useCallback((runtimeId: string) => allSourcesRef.current.some((source) => source.id === runtimeId)
    || programSourceIdsRef.current.has(runtimeId)
    || retainedSourceIdsRef.current.has(runtimeId), []);
  const isVisibleInDraft = useCallback((source: StreamSource) => {
    const draft = projectRef.current;
    if (!draft) return false;
    const visibleIds = getVisibleSourceIdsForScenes(draft.scenes, draft.scenes.map((scene) => scene.id));
    return visibleIds.has(getSourceRuntimeId(source));
  }, [projectRef]);

  const withNativeCaptureLock = useCallback(async <T,>(runtimeId: string, operation: () => Promise<T>): Promise<T> => {
    const previous = nativeCaptureLocks.current.get(runtimeId) ?? Promise.resolve();
    let release!: () => void;
    const currentLock = new Promise<void>((resolve) => { release = resolve; });
    const queuedLock = previous.catch(() => undefined).then(() => currentLock);
    nativeCaptureLocks.current.set(runtimeId, queuedLock);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (nativeCaptureLocks.current.get(runtimeId) === queuedLock) nativeCaptureLocks.current.delete(runtimeId);
    }
  }, []);

  const findSourceByOrigin = useCallback((sourceId: string, kind?: StreamSource['kind']) => {
    const draftSource = projectRef.current?.scenes
      .flatMap((scene) => flattenSourceNodes(scene.sources))
      .find((source) => getOriginSourceId(source) === sourceId && (!kind || source.kind === kind));
    if (draftSource) return draftSource;
    return allSourcesRef.current.find((source) => getOriginSourceId(source) === sourceId && (!kind || source.kind === kind));
  }, [allSourcesRef, projectRef]);

  const setSourceStatus = useCallback((runtimeId: string, status: SourceStatus) => {
    setSourceStatuses((current) => ({ ...current, [runtimeId]: status }));
  }, []);

  const clearSourceStatus = useCallback((runtimeId: string) => {
    setSourceStatuses((current) => {
      if (!(runtimeId in current)) return current;
      const next = { ...current };
      delete next[runtimeId];
      return next;
    });
  }, []);

  const reportCameraAudioFailure = useCallback((runtimeId: string, error: unknown) => {
    const message = `Camera sound could not be captured. Video remains active: ${friendlyError(error)}`;
    setSourceStatus(runtimeId, { state: 'warning', message });
    setActionError(message);
  }, [setActionError, setSourceStatus]);

  const desktopRestoreAttempts = useRef(new Map<string, { signature: string; attempts: number; inFlight: boolean; ownershipEpoch: number }>());
  const desktopRestoreRef = useRef<(source: RuntimeSource) => void>(() => undefined);
  const releaseRuntimeOwnership = useCallback((runtimeId: string) => {
    runtimeOwnershipEpochs.current.set(runtimeId, (runtimeOwnershipEpochs.current.get(runtimeId) ?? 0) + 1);
    mediaElementConnectionOwners.current.delete(runtimeId);
    desktopRestoreAttempts.current.delete(runtimeId);
    const inputAttemptPrefix = `${runtimeId}:`;
    for (const key of inputRestoreAttempts.current) {
      if (key.startsWith(inputAttemptPrefix)) inputRestoreAttempts.current.delete(key);
    }
  }, []);

  const committedSource = useCallback((runtimeId: string): StreamSource | undefined => {
    const committed = programProjectRef.current;
    if (!committed) return undefined;
    const visibleOrigins = programSourceOriginIdsRef.current;
    const candidates = committed.scenes
      .flatMap((scene) => flattenSourceNodes(scene.sources))
      .filter((candidate) => candidate.id === runtimeId
        && (visibleOrigins ? visibleOrigins.has(getOriginSourceId(candidate)) : candidate.visible));
    return candidates[candidates.length - 1];
  }, []);

  const committedAudioSettings = useCallback((runtimeId: string) => {
    const source = committedSource(runtimeId);
    return {
      volume: source?.volume ?? 1,
      muted: source?.muted ?? false,
      balance: source?.balance ?? 0,
      audioFilters: source?.audioFilters ?? DEFAULT_AUDIO_FILTERS,
      audioMonitoring: source?.audioMonitoring ?? 'off' as const,
      audioTracks: source?.audioTracks ?? [1 as const],
      programActive: programSourceIdsRef.current.has(runtimeId)
        && (source?.kind !== 'browser' || source.browserAudioEnabled === true),
    };
  }, [committedSource]);

  const applyCommittedAudioSettings = useCallback(async (runtimeId: string, isCurrent: () => boolean = () => true) => {
    const audioMixer = mixer.current;
    if (!audioMixer) return;
    const settings = committedAudioSettings(runtimeId);
    audioMixer.setSettings(runtimeId, settings);
    audioMixer.setBalance(runtimeId, settings.balance);
    audioMixer.setProgramActive(runtimeId, settings.programActive);
    audioMixer.setAudioMonitoring(runtimeId, settings.audioMonitoring);
    audioMixer.setAudioTracks(runtimeId, settings.audioTracks);
    audioMixer.setAudioFilters(runtimeId, settings.audioFilters);
    if (!settings.audioFilters?.noiseSuppression) {
      noiseSuppressionFailures.current.delete(runtimeId);
      await audioMixer.setNoiseSuppression(runtimeId, false);
      return;
    }
    if (noiseSuppressionFailures.current.has(runtimeId) || !audioMixer.sourceIds().includes(runtimeId)) return;
    const ready = await audioMixer.setNoiseSuppression(runtimeId, true);
    if (isCurrent() && !ready && !noiseSuppressionFailures.current.has(runtimeId)) {
      noiseSuppressionFailures.current.add(runtimeId);
      setActionError('Neural noise suppression could not be started for this audio source.');
    }
  }, [committedAudioSettings, setActionError]);

  const refreshAudioOutputDevices = useCallback(async () => {
    try {
      setAudioOutputDevices(audioOutputDeviceOptions(await navigator.mediaDevices.enumerateDevices()));
    } catch {
      setAudioSettingsError('Audio output devices could not be listed.');
    }
  }, []);

  const clearNoiseSuppressionPreference = useCallback((sourceId: string) => {
    const source = runtimeSources.current.get(sourceId) ?? allSourcesRef.current.find((candidate) => candidate.id === sourceId);
    const originSourceId = source ? getOriginSourceId(source) : sourceId;
    updateSource(originSourceId, (current) => ({ ...current, audioFilters: { ...DEFAULT_AUDIO_FILTERS, ...current.audioFilters, noiseSuppression: false } }));
  }, [allSourcesRef, updateSource]);

  const ensureMixer = useCallback(() => {
    if (!mixer.current) {
      mixer.current = new AudioMixerEngine();
      const selectedDeviceId = audioSettingsRef.current.monitoringDeviceId;
      if (selectedDeviceId) {
        void mixer.current.setMonitoringDevice(selectedDeviceId).then(() => setAudioSettingsError(''))
          .catch((error) => setAudioSettingsError(monitoringDeviceError(error)));
      }
    }
    return mixer.current;
  }, []);

  const updateMonitoringDevice = async (monitoringDeviceId: string) => {
    const nextSettings = { monitoringDeviceId };
    audioSettingsRef.current = nextSettings;
    setAudioSettings(nextSettings);
    setAudioSettingsError('');
    try {
      await api.saveAudioSettings(nextSettings);
    } catch (error) {
      setAudioSettingsError(`Audio settings could not be saved: ${friendlyError(error)}`);
    }
    if (!mixer.current) return;
    try {
      await mixer.current.setMonitoringDevice(monitoringDeviceId);
    } catch (error) {
      setAudioSettingsError(monitoringDeviceError(error));
    }
  };

  const onBrowserElement = useCallback((sourceId: string, image: HTMLImageElement) => {
    const frame = pendingBrowserFrames.current.get(sourceId);
    if (!frame) return;
    pendingBrowserFrames.current.delete(sourceId);
    applyBrowserFrame(image, frame);
  }, []);

  const connectMediaElement = useCallback(async (source: StreamSource, element: HTMLMediaElement) => {
    const generation = captureSessionGeneration.current;
    const runtimeSource = toRuntimeSource(source);
    const runtimeId = runtimeSource.id;
    if (!hasRuntimeOwner(runtimeId)) throw new CaptureOperationCancelled();
    const connectionOwner = Symbol(runtimeId);
    mediaElementConnectionOwners.current.set(runtimeId, connectionOwner);
    runtimeSources.current.set(runtimeId, runtimeSource);
    const isCurrentConnection = () => generation === captureSessionGeneration.current
      && mediaElementConnectionOwners.current.get(runtimeId) === connectionOwner
      && hasRuntimeOwner(runtimeId);
    const cleanUpOrphanedConnection = (audioMixer: AudioMixerEngine) => {
      if (mediaElementConnectionOwners.current.get(runtimeId) === connectionOwner && !hasRuntimeOwner(runtimeId)) {
        mediaElementConnectionOwners.current.delete(runtimeId);
      }
      if (mediaElementConnectionOwners.current.has(runtimeId)) return;
      audioMixer.remove(runtimeId);
      if (runtimeSources.current.get(runtimeId) === runtimeSource) runtimeSources.current.delete(runtimeId);
      if (!hasRuntimeOwner(runtimeId)) clearSourceStatus(runtimeId);
    };
    setSourceStatus(runtimeId, { state: 'starting' });
    const audioMixer = ensureMixer();
    try {
      const settingsAtCreation = committedAudioSettings(runtimeId);
      const routeAlreadyExists = audioMixer.sourceIds().includes(runtimeId);
      const routeSettings = routeAlreadyExists ? settingsAtCreation : { ...settingsAtCreation, programActive: false };
      const noiseSuppressionReady = await audioMixer.addMediaElement(runtimeId, element, routeSettings);
      if (!isCurrentConnection()) {
        cleanUpOrphanedConnection(audioMixer);
        throw new CaptureOperationCancelled();
      }
      if (!audioMixer.sourceIds().includes(runtimeId)) throw new Error('The audio route became unavailable while it was being connected.');
      const currentSettings = committedAudioSettings(runtimeId);
      if (!noiseSuppressionReady && currentSettings.audioFilters?.noiseSuppression) {
        if (!noiseSuppressionFailures.current.has(runtimeId)) setActionError('Neural noise suppression could not be started for this audio source.');
        noiseSuppressionFailures.current.add(runtimeId);
      }
      await applyCommittedAudioSettings(runtimeId, isCurrentConnection);
      if (!isCurrentConnection()) {
        cleanUpOrphanedConnection(audioMixer);
        throw new CaptureOperationCancelled();
      }
      const appliedSettings = committedAudioSettings(runtimeId);
      if ((appliedSettings.audioFilters?.noiseGate || appliedSettings.audioFilters?.expander)
        && audioMixer.setAudioFilters(runtimeId, appliedSettings.audioFilters) === false) {
        setActionError('Audio filters are unavailable in this audio runtime.');
      }
      await audioMixer.resume();
      if (!isCurrentConnection()) {
        cleanUpOrphanedConnection(audioMixer);
        throw new CaptureOperationCancelled();
      }
      setSourceStatus(runtimeId, { state: 'ready' });
      setMeterLevels((current) => ({ ...current, [runtimeId]: 0 }));
    } catch (error) {
      if (isCaptureOperationCancelled(error)) throw error;
      if (!isCurrentConnection()) {
        cleanUpOrphanedConnection(audioMixer);
        throw new CaptureOperationCancelled();
      }
      setSourceStatus(runtimeId, { state: 'unavailable', message: friendlyError(error) });
      setActionError(`Media audio could not be added: ${friendlyError(error)}`);
      throw error;
    }
  }, [applyCommittedAudioSettings, clearSourceStatus, committedAudioSettings, ensureMixer, hasRuntimeOwner, setActionError, setSourceStatus]);

  const onMediaPlaybackState = useCallback((sourceId: string, element: HTMLMediaElement | null) => {
    setMediaPlaybackStates((current) => {
      if (!element) {
        const next = { ...current };
        delete next[sourceId];
        return next;
      }
      return { ...current, [sourceId]: { paused: element.paused, ended: element.ended } };
    });
  }, []);

  const stopRuntimeRaw = useCallback((runtimeId: string, clearStatus = true, preserveNativeAudioInput = false) => {
    const stream = runtimes.current.get(runtimeId);
    // Remove ownership before stopping tracks so the resulting `ended` events
    // are not mistaken for an unexpected device disconnect.
    runtimes.current.delete(runtimeId);
    stream?.getTracks().forEach((track) => track.stop());
    const applicationAudioInput = applicationAudioInputs.current.get(runtimeId);
    if (applicationAudioInput && !preserveNativeAudioInput) {
      applicationAudioInputs.current.delete(runtimeId);
      applicationAudioSessions.current.delete(runtimeId);
      applicationAudioInput.close();
      void api.stopApplicationAudioCapture(runtimeId).catch(() => undefined);
    }
    mixer.current?.remove(runtimeId);
    runtimeSources.current.delete(runtimeId);
    noiseSuppressionFailures.current.delete(runtimeId);
    setMeterLevels((current) => { const next = { ...current }; delete next[runtimeId]; return next; });
    if (clearStatus) clearSourceStatus(runtimeId);
    setRuntimeRevision((value) => value + 1);
  }, [api, clearSourceStatus]);

  const attachRuntime = useCallback(async (source: StreamSource, stream: MediaStream, preserveNativeAudioInput = false) => {
    const generation = captureSessionGeneration.current;
    const runtimeSource = toRuntimeSource(source);
    const runtimeId = runtimeSource.id;
    const existing = runtimes.current.get(runtimeId);
    let suppressedWindowAudio = false;
    if (source.kind === 'window') {
      const unexpectedAudioTracks = stream.getAudioTracks().filter((track) => track.readyState === 'live');
      if (unexpectedAudioTracks.length > 0) {
        const videoTracks = stream.getVideoTracks();
        const overlapsExistingVideo = videoTracks.some((track) => existing?.getVideoTracks().includes(track));
        unexpectedAudioTracks.forEach((track) => track.stop());
        stream = new MediaStream(overlapsExistingVideo ? videoTracks.map((track) => track.clone()) : videoTracks);
        suppressedWindowAudio = true;
      }
    }
    runtimeSources.current.set(runtimeId, runtimeSource);
    const existingWindowAudio = runtimeSource.kind === 'window' && (
      (existing?.getAudioTracks().some((track) => track.readyState === 'live') ?? false)
      || applicationAudioInputs.current.has(runtimeId)
      || (mixer.current?.sourceIds().includes(runtimeId) ?? false)
    );
    suppressedWindowAudio ||= existingWindowAudio;
    const cameraAudioUpgrade = runtimeSource.kind === 'camera'
      && runtimeSource.captureAudioEnabled === true
      && existing?.getVideoTracks().some((track) => track.readyState === 'live') === true
      && !existing.getAudioTracks().some((track) => track.readyState === 'live')
      && stream.getVideoTracks().some((track) => track.readyState === 'live')
      && stream.getAudioTracks().some((track) => track.readyState === 'live');
    if (!preserveNativeAudioInput && !cameraAudioUpgrade && !existingWindowAudio
      && existing && existing !== stream && existing.getTracks().some((track) => track.readyState !== 'ended')) {
      stream.getTracks().forEach((track) => track.stop());
      if (suppressedWindowAudio) {
        const message = `${WINDOW_ONLY_AUDIO_UNAVAILABLE_MESSAGE} Video capture is still active.`;
        setSourceStatus(runtimeId, { state: 'warning', message });
        setActionError(message);
      } else {
        setSourceStatus(runtimeId, { state: 'ready' });
      }
      return;
    }
    if (existing && existing !== stream) {
      stopRuntimeRaw(runtimeId, false, preserveNativeAudioInput);
      runtimeSources.current.set(runtimeId, runtimeSource);
    }
    setSourceStatus(runtimeId, { state: 'starting' });
    runtimes.current.set(runtimeId, stream);
    setRuntimeRevision((value) => value + 1);
    let removeVideoTrackListeners: () => void = () => {};
    const clearEndedRuntime = () => {
      if (generation !== captureSessionGeneration.current
        || runtimes.current.get(runtimeId) !== stream
        || stream.getTracks().some((track) => track.readyState !== 'ended')) return false;
      removeVideoTrackListeners();
      runtimes.current.delete(runtimeId);
      mixer.current?.remove(runtimeId);
      const applicationAudioInput = applicationAudioInputs.current.get(runtimeId);
      if (applicationAudioInput) {
        applicationAudioInputs.current.delete(runtimeId);
        applicationAudioSessions.current.delete(runtimeId);
        applicationAudioInput.close();
        void api.stopApplicationAudioCapture(runtimeId).catch(() => undefined);
      }
      setMeterLevels((current) => { const next = { ...current }; delete next[runtimeId]; return next; });
      setSourceStatus(runtimeId, { state: 'unavailable', message: 'Capture ended.' });
      setActionError(`${runtimeSource.name} disconnected.`);
      setRuntimeRevision((value) => value + 1);
      if (runtimeSource.kind === 'display' || runtimeSource.kind === 'window') desktopRestoreRef.current(runtimeSource);
      return true;
    };
    const handleEnded = () => { clearEndedRuntime(); };
    const removeEndedListeners = listenForMediaStreamEnd(stream, handleEnded);
    if (runtimeSource.kind === 'display' || runtimeSource.kind === 'window') {
      const videoTracks = stream.getVideoTracks();
      const handleVideoEnded = () => {
        if (generation !== captureSessionGeneration.current || runtimes.current.get(runtimeId) !== stream
          || videoTracks.some((track) => track.readyState === 'live')
          || stream.getTracks().every((track) => track.readyState === 'ended')) return;
        removeEndedListeners();
        removeVideoTrackListeners();
        stopRuntimeRaw(runtimeId, false);
        setSourceStatus(runtimeId, { state: 'unavailable', message: 'Capture video ended.' });
        setActionError(`${runtimeSource.name} disconnected.`);
        desktopRestoreRef.current(runtimeSource);
      };
      for (const track of videoTracks) track.addEventListener('ended', handleVideoEnded);
      removeVideoTrackListeners = () => {
        for (const track of videoTracks) track.removeEventListener('ended', handleVideoEnded);
      };
    }
    if (stream.getTracks().length > 0 && stream.getTracks().every((track) => track.readyState === 'ended')) {
      handleEnded();
      removeEndedListeners();
      return;
    }
    if (stream.getAudioTracks().length > 0) {
      try {
        const audioMixer = ensureMixer();
        const settingsAtCreation = committedAudioSettings(runtimeId);
        const routeAlreadyExists = audioMixer.sourceIds().includes(runtimeId);
        const routeSettings = routeAlreadyExists ? settingsAtCreation : { ...settingsAtCreation, programActive: false };
        const noiseSuppressionReady = await audioMixer.add(runtimeId, stream, routeSettings);
        if (runtimes.current.get(runtimeId) !== stream) {
          removeEndedListeners();
          return;
        }
        if (generation !== captureSessionGeneration.current) {
          stopRuntimeRaw(runtimeId);
          removeEndedListeners();
          return;
        }
        if (stream.getTracks().every((track) => track.readyState === 'ended')) {
          handleEnded();
          removeEndedListeners();
          return;
        }
        const currentSettings = committedAudioSettings(runtimeId);
        if (!noiseSuppressionReady && currentSettings.audioFilters?.noiseSuppression) {
          if (!noiseSuppressionFailures.current.has(runtimeId)) setActionError('Neural noise suppression could not be started for this audio source.');
          noiseSuppressionFailures.current.add(runtimeId);
        }
        await applyCommittedAudioSettings(runtimeId);
        const appliedSettings = committedAudioSettings(runtimeId);
        if ((appliedSettings.audioFilters?.noiseGate || appliedSettings.audioFilters?.expander)
          && audioMixer.setAudioFilters(runtimeId, appliedSettings.audioFilters) === false) {
          setActionError('Audio filters are unavailable in this audio runtime.');
        }
        await audioMixer.resume();
        if (generation !== captureSessionGeneration.current || runtimes.current.get(runtimeId) !== stream) {
          removeEndedListeners();
          return;
        }
        if (stream.getTracks().length > 0 && stream.getTracks().every((track) => track.readyState === 'ended')) {
          if (runtimes.current.get(runtimeId) === stream) handleEnded();
          audioMixer.remove(runtimeId);
          removeEndedListeners();
          return;
        }
        setMeterLevels((current) => ({ ...current, [runtimeId]: 0 }));
      } catch (error) {
        if (generation !== captureSessionGeneration.current || runtimes.current.get(runtimeId) !== stream) {
          removeEndedListeners();
          return;
        }
        setActionError(`Audio source could not be added: ${friendlyError(error)}`);
      }
    }
    if (stream.getTracks().length > 0 && stream.getTracks().every((track) => track.readyState === 'ended')) {
      if (runtimes.current.get(runtimeId) === stream) handleEnded();
      mixer.current?.remove(runtimeId);
      removeEndedListeners();
      return;
    }
    if (suppressedWindowAudio) {
      const message = `${WINDOW_ONLY_AUDIO_UNAVAILABLE_MESSAGE} Video capture is still active.`;
      setSourceStatus(runtimeId, { state: 'warning', message });
      setActionError(message);
    } else {
      setSourceStatus(runtimeId, { state: 'ready' });
    }
  }, [api, applyCommittedAudioSettings, committedAudioSettings, ensureMixer, setActionError, setSourceStatus, stopRuntimeRaw]);

  const stripUnsupportedWindowAudio = useCallback(async (source: StreamSource) => {
    if (source.kind !== 'window') return false;
    const runtimeId = toRuntimeSource(source).id;
    const stream = runtimes.current.get(runtimeId);
    const liveVideoTracks = stream?.getVideoTracks().filter((track) => track.readyState === 'live') ?? [];
    const hasLiveAudio = stream?.getAudioTracks().some((track) => track.readyState === 'live') ?? false;
    const hasNativeAudio = applicationAudioInputs.current.has(runtimeId);
    const hasAudioRoute = mixer.current?.sourceIds().includes(runtimeId) ?? false;
    if (!hasLiveAudio && !hasNativeAudio && !hasAudioRoute) return false;

    const videoOnlyStream = liveVideoTracks.length > 0
      ? new MediaStream(liveVideoTracks.map((track) => track.clone()))
      : null;
    stopRuntimeRaw(runtimeId, false);
    if (videoOnlyStream) await attachRuntime(source, videoOnlyStream);
    const message = videoOnlyStream
      ? `${WINDOW_ONLY_AUDIO_UNAVAILABLE_MESSAGE} Video capture is still active.`
      : WINDOW_ONLY_AUDIO_UNAVAILABLE_MESSAGE;
    setSourceStatus(runtimeId, { state: 'warning', message });
    setActionError(message);
    return true;
  }, [attachRuntime, setActionError, setSourceStatus, stopRuntimeRaw]);

  const stopRuntime = useCallback((sourceId: string) => {
    const candidates = [...runtimes.current.keys()].filter((runtimeId) => {
      const source = runtimeSources.current.get(runtimeId) ?? allSourcesRef.current.find((item) => item.id === runtimeId);
      return runtimeId === sourceId || (source ? getOriginSourceId(source) === sourceId : false);
    });
    const programOwnedIds = new Set<string>([
      ...programSourceIdsRef.current,
      ...retainedSourceIdsRef.current,
    ]);
    const mergedOwnerIds = new Set(allSourcesRef.current.map((source) => source.id));
    for (const runtimeId of candidates) {
      if (programOwnedIds.has(runtimeId) || mergedOwnerIds.has(runtimeId)) continue;
      stopRuntimeRaw(runtimeId);
    }
  }, [allSourcesRef, stopRuntimeRaw]);

  const startNativeAudioRuntime = useCallback(async (
    source: StreamSource,
    mode: Exclude<CaptureAudioMode, 'off'>,
    application?: AudioApplicationOption,
    videoStream?: MediaStream,
  ) => {
    if (source.kind === 'window') throw new Error(WINDOW_ONLY_AUDIO_UNAVAILABLE_MESSAGE);
    const validSource = mode === 'application'
      ? source.kind === 'application-audio' || source.kind === 'display'
      : source.kind === 'desktop-audio' || source.kind === 'display';
    if (!validSource || (mode === 'application' && !application)) throw new Error('Invalid native audio capture request.');

    const generation = captureSessionGeneration.current;
    const runtimeSource = toRuntimeSource(source);
    const runtimeId = runtimeSource.id;
    await withNativeCaptureLock(runtimeId, async () => {
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      let existingInput = applicationAudioInputs.current.get(runtimeId);
      const existingRuntime = runtimes.current.get(runtimeId);
      const existingApplication = applicationAudioSessions.current.get(runtimeId);
      const sameAudioCapture = existingInput
        && (mode === 'system'
          ? !existingApplication
          : existingApplication?.pid === application!.pid && existingApplication.path === application!.path);
      if (existingInput && !sameAudioCapture) {
        applicationAudioInputs.current.delete(runtimeId);
        applicationAudioSessions.current.delete(runtimeId);
        existingInput.close();
        await api.stopApplicationAudioCapture(runtimeId).catch(() => undefined);
        existingInput = undefined;
      }
      if (existingInput && !videoStream && existingRuntime?.getTracks().some((track) => track.readyState === 'live')) {
        return;
      }

      runtimeSources.current.set(runtimeId, runtimeSource);
      setSourceStatus(runtimeId, { state: 'starting' });
      let input = existingInput;
      let combinedStream: MediaStream | null = null;
      if (!input) {
        input = await ensureMixer().createApplicationAudioInput();
        if (generation !== captureSessionGeneration.current) { input.close(); throw new CaptureOperationCancelled(); }
        applicationAudioInputs.current.set(runtimeId, input);
        if (mode === 'application') applicationAudioSessions.current.set(runtimeId, { pid: application!.pid, path: application!.path });
        else applicationAudioSessions.current.delete(runtimeId);
      }

      try {
        if (!existingInput) {
          if (mode === 'application') await api.startApplicationAudioCapture(runtimeId, application!.pid, application!.path);
          else await api.startSystemAudioCapture(runtimeId);
        }
        if (generation !== captureSessionGeneration.current) {
          if (applicationAudioInputs.current.get(runtimeId) === input) {
            applicationAudioInputs.current.delete(runtimeId);
            applicationAudioSessions.current.delete(runtimeId);
            input.close();
          }
          await api.stopApplicationAudioCapture(runtimeId).catch(() => undefined);
          throw new CaptureOperationCancelled();
        }
        const startupFailure = nativeAudioStartupFailures.current.get(input);
        if (startupFailure) throw new Error(startupFailure);
        if (applicationAudioInputs.current.get(runtimeId) !== input) throw new CaptureOperationCancelled();

        if (videoStream) {
          // Runtime replacement stops every track in the old stream. Clone both
          // inputs so replacing a preview variant cannot stop the new capture
          // or the native helper's output tracks.
          const liveVideoTracks = videoStream.getVideoTracks().filter((track) => track.readyState === 'live');
          if (liveVideoTracks.length === 0) throw new Error('The selected window did not provide a live video track.');
          const videoOnly = new MediaStream(liveVideoTracks.map((track) => track.clone()));
          const audioOnly = new MediaStream(input.stream.getAudioTracks().map((track) => track.clone()));
          combinedStream = combineCaptureStreams(videoOnly, audioOnly);
        } else {
          combinedStream = input.stream;
        }
        await attachRuntime(runtimeSource, combinedStream, true);
        if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
        const attachFailure = nativeAudioStartupFailures.current.get(input);
        if (attachFailure) throw new Error(attachFailure);
        if (applicationAudioInputs.current.get(runtimeId) !== input) throw new CaptureOperationCancelled();
        if (videoStream && !hasLiveVideoTrack(runtimes.current.get(runtimeId) ?? combinedStream)) {
          throw new Error('The selected window did not provide a live video track.');
        }
        videoStream?.getTracks().forEach((track) => track.stop());
      } catch (error) {
        if (combinedStream && combinedStream !== input.stream) {
          if (runtimes.current.get(runtimeId) === combinedStream) stopRuntimeRaw(runtimeId, false, true);
          else combinedStream.getTracks().forEach((track) => track.stop());
        }
        const stillOwnsInput = applicationAudioInputs.current.get(runtimeId) === input;
        if (stillOwnsInput) {
          applicationAudioInputs.current.delete(runtimeId);
          applicationAudioSessions.current.delete(runtimeId);
          input.close();
        }
        if (!nativeAudioStartupFailures.current.has(input)) {
          await api.stopApplicationAudioCapture(runtimeId).catch(() => undefined);
        }
        if (generation === captureSessionGeneration.current && !isCaptureOperationCancelled(error)) {
          setSourceStatus(runtimeId, { state: 'unavailable', message: friendlyError(error) });
        }
        throw error;
      }
    });
  }, [api, attachRuntime, ensureMixer, setSourceStatus, stopRuntimeRaw, withNativeCaptureLock]);

  const startApplicationAudioRuntime = useCallback(async (source: StreamSource, application: AudioApplicationOption) => {
    if (source.kind !== 'application-audio') throw new Error('Invalid application-audio source.');
    await startNativeAudioRuntime(source, 'application', application);
  }, [startNativeAudioRuntime]);

  const startSystemAudioRuntime = useCallback(async (source: StreamSource) => {
    if (source.kind !== 'desktop-audio') throw new Error('Invalid desktop-audio source.');
    await startNativeAudioRuntime(source, 'system');
  }, [startNativeAudioRuntime]);

  const loadCaptureAudioApplications = useCallback(async (savedApplicationPath?: string) => {
    const request = ++captureAudioApplicationRequest.current;
    setCaptureAudioApplicationLoading(true);
    try {
      const applications = await api.listAudioApplications();
      if (request !== captureAudioApplicationRequest.current) return;
      setCaptureAudioApplications(applications);
      if (savedApplicationPath) {
        setSelectedCaptureAudioApplication(uniqueAudioApplicationForPath(applications, savedApplicationPath, api.platform));
      } else {
        setSelectedCaptureAudioApplication((selected) => selected && applications.some((candidate) => candidate.pid === selected.pid && candidate.path === selected.path) ? selected : null);
      }
    } catch (error) {
      if (request === captureAudioApplicationRequest.current) {
        setCaptureAudioApplications(null);
        setSelectedCaptureAudioApplication(null);
        setActionError(`Could not list running applications: ${friendlyError(error)}`);
      }
    } finally {
      if (request === captureAudioApplicationRequest.current) setCaptureAudioApplicationLoading(false);
    }
  }, [api, setActionError]);

  const onLoadCaptureAudioApplications = useCallback(() => {
    if (captureKind === 'window') return;
    void loadCaptureAudioApplications();
  }, [captureKind, loadCaptureAudioApplications]);
  const onSelectCaptureAudioApplication = useCallback((application: AudioApplicationOption | null) => {
    setSelectedCaptureAudioApplication(application);
  }, []);

  const supportsSystemAudio = desktopAudioCaptureModeForPlatform(api.platform) !== 'unavailable';
  const supportsApplicationAudio = supportsApplicationAudioCapture(api.platform);

  const openCapturePicker = async (kind: 'screen' | 'window' | 'audio', targetSourceId?: string, audioModeOverride?: CaptureAudioMode) => {
    const manualRevision = ++manualCaptureRevision.current;
    closeSourceMenu();
    setActionError('');
    let savedApplicationPath: string | undefined;
    let initialAudioMode: CaptureAudioMode = 'off';
    if (targetSourceId) {
      const target = findSourceByOrigin(targetSourceId);
      if (target?.kind === 'display' || target?.kind === 'window') {
        setCaptureCursorMode(target.cursorMode ?? 'motion');
        initialAudioMode = kind === 'window' ? 'off' : audioModeOverride ?? captureAudioModeForSource(target, api.platform);
        savedApplicationPath = initialAudioMode === 'application' ? target.captureAudioApplicationPath : undefined;
      }
    }
    if (kind === 'window') initialAudioMode = 'off';
    if ((initialAudioMode === 'system' && !supportsSystemAudio)
      || (initialAudioMode === 'application' && !supportsApplicationAudio)) initialAudioMode = 'off';
    setCaptureAudioMode(kind === 'audio' ? 'off' : initialAudioMode);
    captureAudioApplicationRequest.current += 1;
    setCaptureAudioApplications(null);
    setSelectedCaptureAudioApplication(null);
    setCaptureAudioApplicationLoading(false);
    setWorking(true);
    try {
      const sources = await api.listDesktopSources(kind === 'audio' ? 'screen' : kind);
      if (manualRevision !== manualCaptureRevision.current) return;
      setCaptureKind(kind);
      setCaptureTargetSourceId(targetSourceId ?? null);
      setCaptureOptions(sources);
      if (initialAudioMode === 'application' && savedApplicationPath) void loadCaptureAudioApplications(savedApplicationPath);
    } catch (error) {
      if (manualRevision === manualCaptureRevision.current) setActionError(`Could not list capture sources: ${friendlyError(error)}`);
    } finally {
      if (manualRevision === manualCaptureRevision.current) setWorking(false);
    }
  };

  const openApplicationAudioPicker = async (targetSourceId?: string) => {
    if (working) return;
    closeSourceMenu();
    setActionError('');
    setWorking(true);
    try {
      setApplicationAudioOptions(await api.listAudioApplications());
      setApplicationAudioTargetSourceId(targetSourceId ?? null);
    } catch (error) {
      setActionError(`Could not list running applications: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const addSystemAudioCapture = async (targetSourceId?: string) => {
    if (!project || working) return;
    const generation = captureSessionGeneration.current;
    closeSourceMenu();
    const target = targetSourceId
      ? findSourceByOrigin(targetSourceId, 'desktop-audio')
      : null;
    if (targetSourceId && !target) {
      setActionError('The desktop audio source is no longer available.');
      return;
    }
    if (target && !isVisibleInDraft(target)) return;
    const source = target ?? createSource('desktop-audio', project.output, 'Desktop Audio', { captureId: 'system' });
    setWorking(true);
    setActionError('');
    try {
      await startSystemAudioRuntime(source);
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      if (!target) addToActiveScene(source);
    } catch (error) {
      if (!isCaptureOperationCancelled(error)) setActionError(`Could not capture desktop audio: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const chooseAudioApplication = async (application: AudioApplicationOption) => {
    if (!project || working) return;
    const generation = captureSessionGeneration.current;
    const target = applicationAudioTargetSourceId
      ? findSourceByOrigin(applicationAudioTargetSourceId, 'application-audio')
      : null;
    if (applicationAudioTargetSourceId && !target) {
      setActionError('The application-audio source is no longer available.');
      setApplicationAudioOptions(null);
      setApplicationAudioTargetSourceId(null);
      return;
    }
    if (target && !isVisibleInDraft(target)) {
      updateSource(getOriginSourceId(target), (current) => ({
        ...current,
        name: application.name,
        applicationPath: application.path,
      }));
      setApplicationAudioOptions(null);
      setApplicationAudioTargetSourceId(null);
      return;
    }
    const source = target
      ? { ...target, name: application.name, applicationPath: application.path }
      : createSource('application-audio', project.output, application.name, { applicationPath: application.path });
    setWorking(true);
    setActionError('');
    try {
      await startApplicationAudioRuntime(source, application);
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      if (target) updateSource(getOriginSourceId(source), (current) => ({ ...current, name: application.name, applicationPath: application.path }));
      else addToActiveScene(source);
      setApplicationAudioOptions(null);
      setApplicationAudioTargetSourceId(null);
    } catch (error) {
      if (!isCaptureOperationCancelled(error)) setActionError(`Could not capture ${application.name}: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const addDesktopCapture = async (option: DesktopSourceOption) => {
    if (!project || working) return;
    const generation = captureSessionGeneration.current;
    const pickerKind = captureKind;
    if (!pickerKind) return;
    const reconnectSource = captureTargetSourceId ? findSourceByOrigin(captureTargetSourceId) : null;
    const isWindowCapture = pickerKind === 'window' || (pickerKind === 'screen' && option.kind === 'window');
    const unsupportedWindowAudioRequested = isWindowCapture
      && (captureAudioMode !== 'off'
        || (reconnectSource?.kind === 'window' && hasWindowCaptureAudioIntent(reconnectSource)));
    const selectedAudioMode = pickerKind === 'audio' || isWindowCapture ? 'off' : captureAudioMode;
    const selectedApplication = selectedAudioMode === 'application' ? selectedCaptureAudioApplication : null;
    if (selectedAudioMode === 'system' && !supportsSystemAudio) {
      setActionError('System audio capture is unavailable on this platform.');
      return;
    }
    if (selectedAudioMode === 'application' && (!supportsApplicationAudio || !selectedApplication)) {
      setActionError('Select an application before starting capture with application audio.');
      return;
    }
    const reconnectKindMatches = pickerKind === 'audio'
      ? reconnectSource?.kind === 'desktop-audio'
      : reconnectSource?.kind === 'display' || reconnectSource?.kind === 'window';
    if (reconnectSource && reconnectKindMatches && !isVisibleInDraft(reconnectSource)) {
      const originId = getOriginSourceId(reconnectSource);
      if (pickerKind === 'audio') {
        updateSource(originId, (current) => getOriginSourceId(current) === originId
          ? { ...current, captureId: option.id }
          : current);
      } else {
        const reboundSource = bindDesktopCaptureSource(reconnectSource, option, captureCursorMode);
        const configuredSource = {
          ...reboundSource,
          captureAudioEnabled: selectedAudioMode !== 'off',
          captureAudioMode: selectedAudioMode === 'off' ? undefined : selectedAudioMode,
          captureAudioApplicationPath: selectedAudioMode === 'application' ? selectedApplication?.path : undefined,
        };
        updateSource(originId, (current) => getOriginSourceId(current) === originId
          ? {
            ...current,
            captureId: option.id,
            captureBindingId: configuredSource.captureBindingId,
            captureTarget: configuredSource.captureTarget,
            cursorMode: configuredSource.cursorMode,
            captureAudioEnabled: configuredSource.captureAudioEnabled,
            captureAudioMode: configuredSource.captureAudioMode,
            captureAudioApplicationPath: configuredSource.captureAudioApplicationPath,
          }
          : current);
      }
      if (unsupportedWindowAudioRequested && reconnectSource?.kind === 'window') {
        const runtimeId = toRuntimeSource(reconnectSource).id;
        setSourceStatus(runtimeId, { state: 'warning', message: WINDOW_ONLY_AUDIO_UNAVAILABLE_MESSAGE });
        setActionError(WINDOW_ONLY_AUDIO_UNAVAILABLE_MESSAGE);
      }
      setCaptureOptions(null);
      setCaptureKind(null);
      setCaptureTargetSourceId(null);
      setCaptureAudioMode('off');
      setCaptureAudioApplications(null);
      setSelectedCaptureAudioApplication(null);
      return;
    }
    setWorking(true);
    setActionError('');
    let stream: MediaStream | null = null;
    let audioUnavailable = unsupportedWindowAudioRequested;
    let audioWarning = unsupportedWindowAudioRequested
      ? `${WINDOW_ONLY_AUDIO_UNAVAILABLE_MESSAGE} Video capture is still active.`
      : '';
    try {
      const displayLoopback = pickerKind === 'audio' || (selectedAudioMode === 'system' && api.platform === 'win32');
      const captureAudio = pickerKind === 'audio' || displayLoopback;
      // Start the media request in the picker click handler so Chromium keeps
      // the user's gesture while main validates and grants the chosen source.
      const mediaRequest = navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: pickerKind === 'audio' ? 1 : project.output.frameRate, max: pickerKind === 'audio' ? 1 : project.output.frameRate }, cursor: captureCursorMode } as MediaTrackConstraints,
        audio: captureAudio,
      });
      void mediaRequest.catch(() => undefined);
      await api.prepareDesktopCapture(option.id, captureAudio);
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      stream = await mediaRequest;
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      if (pickerKind !== 'audio' && !displayLoopback && stream.getAudioTracks().length > 0) {
        const unexpectedAudioTracks = stream.getAudioTracks();
        const videoTracks = stream.getVideoTracks();
        unexpectedAudioTracks.forEach((track) => track.stop());
        stream = new MediaStream(videoTracks);
      }
      let source: StreamSource;
      if (pickerKind === 'audio') {
        const audioTracks = retainDesktopAudioTracks(stream);
        if (audioTracks.length === 0) throw new Error('The system did not provide a desktop audio track.');
        stream = new MediaStream(audioTracks);
        const reconnectSource = captureTargetSourceId
          ? findSourceByOrigin(captureTargetSourceId, 'desktop-audio')
          : null;
        if (captureTargetSourceId && !reconnectSource) throw new Error('The desktop audio source is no longer available.');
        source = reconnectSource
          ? { ...reconnectSource, captureId: option.id }
          : createSource('desktop-audio', project.output, 'Desktop Audio', { captureId: option.id });
      } else if (captureTargetSourceId) {
        const reconnectSource = findSourceByOrigin(captureTargetSourceId);
        if (!reconnectSource) throw new Error('The capture source is no longer available.');
        source = {
          ...bindDesktopCaptureSource(reconnectSource, option, captureCursorMode),
          captureAudioEnabled: selectedAudioMode !== 'off',
          captureAudioMode: selectedAudioMode === 'off' ? undefined : selectedAudioMode,
          captureAudioApplicationPath: selectedAudioMode === 'application' ? selectedApplication?.path : undefined,
        };
      } else {
        const kind = option.kind === 'screen' ? 'display' : 'window';
        source = createSource(kind, project.output, option.name, {
          captureId: option.id,
          captureTarget: captureTargetForOption(option),
          cursorMode: captureCursorMode,
          captureAudioEnabled: selectedAudioMode !== 'off',
          captureAudioMode: selectedAudioMode === 'off' ? undefined : selectedAudioMode,
          captureAudioApplicationPath: selectedAudioMode === 'application' ? selectedApplication?.path : undefined,
        });
      }
      if (pickerKind !== 'audio') {
        const liveVideoTracks = stream.getVideoTracks().filter((track) => track.readyState === 'live');
        if (liveVideoTracks.length === 0) throw new Error('The selected capture did not provide a live video track.');
        audioUnavailable ||= selectedAudioMode === 'system' && displayLoopback && stream.getAudioTracks().length === 0;
        if (selectedAudioMode === 'application' || (selectedAudioMode === 'system' && api.platform === 'darwin')) {
          try {
            await startNativeAudioRuntime(source, selectedAudioMode, selectedApplication ?? undefined, stream);
            stream = null;
          } catch (error) {
            if (isCaptureOperationCancelled(error)) throw error;
            audioUnavailable = true;
            audioWarning = `Capture audio could not be started: ${friendlyError(error)}. Video capture is still active.`;
          }
        }
      }
      if (stream) {
        await attachRuntime(source, stream);
        stream = null;
      }
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      if (captureTargetSourceId) {
        updateSource(getOriginSourceId(source), (current) => ({ ...current, captureId: option.id, ...(source.kind === 'display' || source.kind === 'window' ? {
          captureBindingId: source.captureBindingId,
          captureTarget: source.captureTarget,
          cursorMode: source.cursorMode,
          captureAudioEnabled: source.captureAudioEnabled,
          captureAudioMode: source.captureAudioMode,
          captureAudioApplicationPath: source.captureAudioApplicationPath,
        } : {}) }));
        if (source.kind === 'display' || source.kind === 'window') {
          desktopRestoreAttempts.current.delete(toRuntimeSource(source).id);
        }
      } else {
        addToActiveScene(source);
      }
      if (audioUnavailable) {
        const runtimeId = toRuntimeSource(source).id;
        const message = audioWarning || 'System audio was not provided. Video capture is still active.';
        setSourceStatus(runtimeId, { state: 'warning', message });
        setActionError(message);
      }
      setCaptureOptions(null);
      setCaptureKind(null);
      setCaptureTargetSourceId(null);
      setCaptureAudioMode('off');
      setCaptureAudioApplications(null);
      setSelectedCaptureAudioApplication(null);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (!isCaptureOperationCancelled(error)) setActionError(`Could not start capture: ${friendlyError(error)}`);
    } finally {
      setWorking(false);
    }
  };

  const openInputDevicePicker = async (kind: InputCaptureKind) => {
    if (working) return;
    setWorking(true);
    closeSourceMenu();
    setActionError('');
    let permissionStream: MediaStream | null = null;
    try {
      permissionStream = await navigator.mediaDevices.getUserMedia(inputCaptureConstraints(kind));
      permissionStream.getTracks().forEach((track) => track.stop());
      permissionStream = null;
      const devices = await listInputDevices(kind);
      setInputDeviceOptions((current) => ({ ...current, [kind]: devices }));
      if (kind === 'camera') {
        const audioDevices = await listInputDevices('microphone').catch(() => []);
        setInputDeviceOptions((current) => ({ ...current, microphone: audioDevices }));
        setCameraAudioEnabled(true);
        setCameraAudioDeviceId('');
      }
      setInputDevicePicker(kind);
      if (devices.length === 0) setActionError(`No ${kind === 'camera' ? 'cameras' : 'microphones'} are available.`);
    } catch (error) {
      permissionStream?.getTracks().forEach((track) => track.stop());
      setActionError(`Could not list ${kind === 'camera' ? 'cameras' : 'microphones'}: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const chooseInputDevice = async (device: InputDeviceOption) => {
    const kind = inputDevicePicker;
    if (!kind || !project || working) return;
    const pairedAudioDeviceId = kind === 'camera' ? pairedCameraAudioDeviceId(device, inputDeviceOptions.microphone) : undefined;
    const selectedAudioDeviceId = kind === 'camera' ? (cameraAudioDeviceId || pairedAudioDeviceId) : undefined;
    if (kind === 'camera' && cameraAudioEnabled && !selectedAudioDeviceId) {
      setActionError(explicitAudioInputDevices(inputDeviceOptions.microphone).length === 0
        ? 'No audio input is available. Turn off Capture audio to add this camera without sound.'
        : 'Select an audio input or turn off Capture audio.');
      return;
    }
    const generation = captureSessionGeneration.current;
    setWorking(true);
    setActionError('');
    let stream: MediaStream | null = null;
    let audioError: unknown;
    try {
      const acquired = await getInputCaptureStream(kind, device.deviceId || undefined, undefined, kind === 'camera' && cameraAudioEnabled, selectedAudioDeviceId);
      stream = acquired.stream;
      audioError = acquired.audioError;
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      const label = stream.getVideoTracks()[0]?.label || stream.getTracks()[0]?.label || device.label;
      const source = createSource(kind, project.output, label, {
        ...(device.deviceId ? { deviceId: device.deviceId } : {}),
        ...(kind === 'camera' ? { captureAudioEnabled: cameraAudioEnabled, ...(selectedAudioDeviceId ? { audioDeviceId: selectedAudioDeviceId } : {}) } : {}),
      });
      await attachRuntime(source, stream);
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      addToActiveScene(source);
      setInputDevicePicker(null);
      if (audioError) reportCameraAudioFailure(toRuntimeSource(source).id, audioError);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (!isCaptureOperationCancelled(error)) setActionError(`Could not start ${kind === 'camera' ? 'camera' : 'microphone'}: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const switchInputDevice = async (source: StreamSource, deviceId: string | undefined) => {
    if ((source.kind !== 'camera' && source.kind !== 'microphone') || working) return;
    const generation = captureSessionGeneration.current;
    const kind = source.kind;
    if (!isVisibleInDraft(source)) {
      const label = inputDeviceOptions[kind].find((option) => option.deviceId === deviceId)?.label ?? source.name;
      updateSource(getOriginSourceId(source), (current) => ({ ...current, name: label, deviceId }));
      return;
    }
    setWorking(true);
    setActionError('');
    let stream: MediaStream | null = null;
    let audioError: unknown;
    try {
      const acquired = await getInputCaptureStream(kind, deviceId, source, source.captureAudioEnabled === true, source.audioDeviceId);
      stream = acquired.stream;
      audioError = acquired.audioError;
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      const label = stream.getTracks()[0]?.label || source.name;
      const nextSource = { ...source, name: label, deviceId };
      await attachRuntime(nextSource, stream);
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      updateSource(getOriginSourceId(source), (current) => ({ ...current, name: label, deviceId }));
      const devices = await listInputDevices(kind).catch(() => null);
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      if (devices) setInputDeviceOptions((current) => ({ ...current, [kind]: devices }));
      if (kind === 'camera') {
        const audioDevices = await listInputDevices('microphone').catch(() => null);
        if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
        if (audioDevices) setInputDeviceOptions((current) => ({ ...current, microphone: audioDevices }));
      }
      if (kind === 'camera' && audioError) reportCameraAudioFailure(toRuntimeSource(nextSource).id, audioError);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (!isCaptureOperationCancelled(error)) setActionError(`Could not switch ${kind === 'camera' ? 'camera' : 'microphone'}: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const updateCameraAudioSettings = async (
    source: StreamSource,
    settings: Pick<StreamSource, 'captureAudioEnabled' | 'audioDeviceId'>,
  ) => {
    if (source.kind !== 'camera' || working) return;
    if (!isVisibleInDraft(source)) {
      updateSource(getOriginSourceId(source), (current) => ({ ...current, ...settings }));
      return;
    }
    const nextSource = { ...source, ...settings };
    const runtimeId = toRuntimeSource(source).id;
    const currentStream = runtimes.current.get(runtimeId);
    const videoTracks = currentStream?.getVideoTracks().map((track) => track.clone()) ?? [];
    if (videoTracks.length === 0) {
      updateSource(getOriginSourceId(source), (current) => ({ ...current, ...settings }));
      return;
    }
    setWorking(true);
    setActionError('');
    const generation = captureSessionGeneration.current;
    let nextStream = new MediaStream(videoTracks);
    let audioError: unknown;
    try {
      if (settings.captureAudioEnabled) {
        if (!settings.audioDeviceId) {
          audioError = new Error('Select an audio input to capture camera sound.');
        } else {
          try {
            const audioInput = await navigator.mediaDevices.getUserMedia(audioInputCaptureConstraints(settings.audioDeviceId));
            const tracks = audioInput.getAudioTracks();
            if (tracks.length === 0) {
              audioInput.getTracks().forEach((track) => track.stop());
              audioError = new Error('The selected audio input did not provide an audio track.');
            } else {
              nextStream = new MediaStream([...videoTracks, ...tracks]);
            }
          } catch (error) {
            audioError = error;
          }
        }
      }
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      await attachRuntime(nextSource, nextStream);
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      updateSource(getOriginSourceId(source), (current) => ({ ...current, ...settings }));
      if (audioError) reportCameraAudioFailure(toRuntimeSource(nextSource).id, audioError);
    } catch (error) {
      nextStream.getTracks().forEach((track) => track.stop());
      if (!isCaptureOperationCancelled(error)) setActionError(`Camera audio settings could not be changed: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const toggleDesktopCaptureAudio = async (source: StreamSource, enabled: boolean) => {
    if ((source.kind !== 'display' && source.kind !== 'window') || working) return;
    if (enabled) {
      if (source.kind === 'window') {
        if (await stripUnsupportedWindowAudio(source)) return;
        const runtimeId = toRuntimeSource(source).id;
        const hasLiveVideo = runtimes.current.get(runtimeId)?.getVideoTracks()
          .some((track) => track.readyState === 'live') ?? false;
        const message = hasLiveVideo
          ? `${WINDOW_ONLY_AUDIO_UNAVAILABLE_MESSAGE} Video capture is still active.`
          : WINDOW_ONLY_AUDIO_UNAVAILABLE_MESSAGE;
        setSourceStatus(runtimeId, { state: 'warning', message });
        setActionError(message);
        return;
      }
      await openCapturePicker(
        'screen',
        getOriginSourceId(source),
        supportsApplicationAudio ? 'application' : 'off',
      );
      return;
    }
    if (!isVisibleInDraft(source)) {
      updateSource(getOriginSourceId(source), (current) => ({
        ...current,
        captureAudioEnabled: false,
        captureAudioMode: undefined,
        captureAudioApplicationPath: undefined,
      }));
      return;
    }
    const generation = captureSessionGeneration.current;
    const runtimeId = toRuntimeSource(source).id;
    const currentStream = runtimes.current.get(runtimeId);
    const videoTracks = currentStream?.getVideoTracks().map((track) => track.clone()) ?? [];
    const nextSource = { ...source, captureAudioEnabled: false, captureAudioMode: undefined, captureAudioApplicationPath: undefined };
    if (videoTracks.length === 0) {
      updateSource(getOriginSourceId(source), (current) => ({ ...current, captureAudioEnabled: false, captureAudioMode: undefined, captureAudioApplicationPath: undefined }));
      return;
    }
    setWorking(true);
    const nextStream = new MediaStream(videoTracks);
    try {
      await attachRuntime(nextSource, nextStream);
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      updateSource(getOriginSourceId(source), (current) => ({ ...current, captureAudioEnabled: false, captureAudioMode: undefined, captureAudioApplicationPath: undefined }));
    } catch (error) {
      nextStream.getTracks().forEach((track) => track.stop());
      if (!isCaptureOperationCancelled(error)) setActionError(`System audio could not be disabled: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const updateCameraCaptureSettings = async (
    source: StreamSource,
    settings: Pick<StreamSource, 'cameraResolution' | 'cameraFrameRate'>,
  ) => {
    if (source.kind !== 'camera' || working) return;
    if (!isVisibleInDraft(source)) {
      updateSource(getOriginSourceId(source), (current) => ({ ...current, ...settings }));
      return;
    }
    const nextSource = { ...source, ...settings };
    const runtimeId = toRuntimeSource(source).id;
    if (!runtimes.current.has(runtimeId)) {
      updateSource(getOriginSourceId(source), (current) => ({ ...current, ...settings }));
      return;
    }
    setWorking(true);
    const generation = captureSessionGeneration.current;
    setActionError('');
    let stream: MediaStream | null = null;
    let audioError: unknown;
    try {
      const acquired = await getInputCaptureStream('camera', source.deviceId, nextSource, source.captureAudioEnabled === true, source.audioDeviceId);
      stream = acquired.stream;
      audioError = acquired.audioError;
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      await attachRuntime(nextSource, stream);
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      updateSource(getOriginSourceId(source), (current) => ({ ...current, ...settings }));
      if (audioError) reportCameraAudioFailure(toRuntimeSource(nextSource).id, audioError);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (!isCaptureOperationCancelled(error)) setActionError(`Could not change camera settings: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  // --- effects -------------------------------------------------------------

  useEffect(() => {
    let active = true;
    void api.loadAudioSettings().then((settings) => {
      if (!active) return;
      audioSettingsRef.current = settings;
      setAudioSettings(settings);
      if (settings.monitoringDeviceId && mixer.current) {
        void mixer.current.setMonitoringDevice(settings.monitoringDeviceId).then(() => setAudioSettingsError(''))
          .catch((error) => setAudioSettingsError(monitoringDeviceError(error)));
      }
    }).catch((error) => {
      if (active) setAudioSettingsError(`Audio settings could not be loaded: ${friendlyError(error)}`);
    });
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    let active = true;
    const refreshDevices = () => {
      void navigator.mediaDevices.enumerateDevices().then((devices) => {
        if (!active) return;
        const options = audioOutputDeviceOptions(devices);
        setAudioOutputDevices(options);
        const selectedId = audioSettingsRef.current.monitoringDeviceId;
        const engine = mixer.current;
        if (!engine || !selectedId) return;
        if (options.some((device) => device.deviceId === selectedId)) {
          void engine.setMonitoringDevice(selectedId).then(() => setAudioSettingsError(''))
            .catch((error) => setAudioSettingsError(monitoringDeviceError(error)));
        } else {
          void engine.setMonitoringDevice('').catch(() => undefined);
          setAudioSettingsError('Saved monitoring device is unavailable. Using System Default.');
        }
      }).catch(() => {
        if (active) setAudioSettingsError('Audio output devices could not be listed.');
      });
    };
    refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const refreshDevices = () => {
      inputRestoreAttempts.current.clear();
      setInputDeviceRevision((revision) => revision + 1);
      for (const kind of ['camera', 'microphone'] as const) {
        void listInputDevices(kind).then((devices) => {
          if (active) setInputDeviceOptions((current) => ({ ...current, [kind]: devices }));
        }).catch(() => undefined);
      }
    };
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
    };
  }, []);

  useEffect(() => api.onBrowserSourceFrame((sourceId, frame) => {
    const image = imageElements.current.get(sourceId);
    if (image) applyBrowserFrame(image, frame);
    else pendingBrowserFrames.current.set(sourceId, frame);
  }), [api, imageElements]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next: Record<string, number> = {};
      for (const sourceId of mixer.current?.sourceIds() ?? []) next[sourceId] = mixer.current?.level(sourceId) ?? 0;
      setMeterLevels(next);
    }, 80);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    captureSessionGeneration.current += 1;
    manualCaptureRevision.current += 1;
    captureAudioApplicationRequest.current += 1;
    desktopRestoreAttempts.current.clear();
    restoreBlockedProject.current = null;
    inputRestoreAttempts.current.clear();
    inputRestoreInFlight.current.clear();
    browserAudioInFlight.current.clear();
    mediaElementConnectionOwners.current.clear();
    for (const stream of runtimes.current.values()) stream.getTracks().forEach((track) => track.stop());
    runtimes.current.clear();
    runtimeSources.current.clear();
    for (const [sourceId, input] of applicationAudioInputs.current) {
      void api.stopApplicationAudioCapture(sourceId).catch(() => undefined);
      input.close();
    }
    applicationAudioInputs.current.clear();
    applicationAudioSessions.current.clear();
    pendingBrowserFrames.current.clear();
    const previousMixer = mixer.current;
    mixer.current = null;
    void previousMixer?.close();
  }, [api]);

  const browserSessions = useBrowserSessions({
    api,
    sources: allSources,
    activeSourceIds,
    playbackSourceIds: params.retainedSourceIds ?? programSourceIds,
    defaultViewport: {
      width: project?.output.baseWidth ?? 1920,
      height: project?.output.baseHeight ?? 1080,
    },
    onError: setActionError,
    onSourceStatus: setSourceStatus,
  });

  const activeBrowserSources = allSources.filter((source) => activeSourceIds.has(source.id) && source.kind === 'browser');
  const browserAudioSignature = JSON.stringify(activeBrowserSources
    .map((source) => ({ id: source.id, enabled: source.browserAudioEnabled === true, url: source.url ?? '' })));

  useEffect(() => api.onApplicationAudioFrame((sourceId, frame) => {
    const input = applicationAudioInputs.current.get(sourceId);
    if (!input) return;
    if (frame instanceof ArrayBuffer) {
      input.node.port.postMessage(frame, [frame]);
      return;
    }
    const source = runtimeSources.current.get(sourceId);
    const runtime = runtimes.current.get(sourceId);
    const liveVideoTracks = runtime?.getVideoTracks().filter((track) => track.readyState === 'live') ?? [];
    nativeAudioStartupFailures.current.set(input, frame.error);
    if ((source?.kind === 'display' || source?.kind === 'window') && liveVideoTracks.length > 0) {
      const generation = captureSessionGeneration.current;
      runtimes.current.delete(sourceId);
      mixer.current?.remove(sourceId);
      runtime?.getAudioTracks().forEach((track) => track.stop());
      applicationAudioInputs.current.delete(sourceId);
      applicationAudioSessions.current.delete(sourceId);
      input.close();
      void api.stopApplicationAudioCapture(sourceId).catch(() => undefined);
      const videoOnlyStream = new MediaStream(liveVideoTracks);
      if (generation !== captureSessionGeneration.current) {
        videoOnlyStream.getTracks().forEach((track) => track.stop());
        return;
      }
      void attachRuntime(source, videoOnlyStream).then(() => {
        if (generation !== captureSessionGeneration.current || runtimes.current.get(sourceId) !== videoOnlyStream) return;
        const message = `Capture audio stopped: ${frame.error}. Video capture is still active.`;
        setSourceStatus(sourceId, { state: 'warning', message });
        setActionError(message);
      }).catch(() => {
        videoOnlyStream.getTracks().forEach((track) => track.stop());
      });
      return;
    }
    stopRuntimeRaw(sourceId, false);
    setSourceStatus(sourceId, { state: 'unavailable', message: frame.error });
  }), [api, attachRuntime, setActionError, setSourceStatus, stopRuntimeRaw]);

  useEffect(() => {
    const enabledBrowserSources = JSON.parse(browserAudioSignature) as Array<{ id: string; enabled: boolean }>;
    const enabledIds = new Set(enabledBrowserSources.filter((source) => source.enabled).map((source) => source.id));
    for (const sourceId of runtimes.current.keys()) {
      const source = allSourcesRef.current.find((item) => item.id === sourceId);
      if (source?.kind === 'browser' && !enabledIds.has(sourceId)) stopRuntimeRaw(sourceId, false);
    }
    for (const { id, enabled } of enabledBrowserSources) {
      const generation = captureSessionGeneration.current;
      const operationKey = `${id}:${generation}`;
      if (!enabled || runtimes.current.has(id) || browserAudioInFlight.current.has(operationKey)) continue;
      browserAudioInFlight.current.add(operationKey);
      void (async () => {
        let stream: MediaStream | null = null;
        try {
          const captureId = await api.getBrowserSourceAudioCaptureId(id);
          if (generation !== captureSessionGeneration.current || !activeSourceIdsRef.current.has(id)) return;
          stream = await navigator.mediaDevices.getUserMedia(browserAudioCaptureConstraints(captureId));
          if (generation !== captureSessionGeneration.current || !activeSourceIdsRef.current.has(id)) {
            stream.getTracks().forEach((track) => track.stop());
            stream = null;
            return;
          }
          if (stream.getAudioTracks().length === 0) throw new Error('The browser source did not provide an audio track.');
          const source = allSourcesRef.current.find((item) => item.id === id && item.kind === 'browser' && item.browserAudioEnabled);
          if (!source) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          await attachRuntime(source, stream);
          stream = null;
        } catch (error) {
          stream?.getTracks().forEach((track) => track.stop());
          if (generation === captureSessionGeneration.current && activeSourceIdsRef.current.has(id)
            && allSourcesRef.current.some((item) => item.id === id && item.kind === 'browser' && item.browserAudioEnabled)) {
            setSourceStatus(id, { state: 'unavailable', message: friendlyError(error) });
          }
        } finally {
          browserAudioInFlight.current.delete(operationKey);
        }
      })();
    }
  }, [activeSourceIdsRef, allSourcesRef, api, attachRuntime, browserAudioSignature, runtimeRevision, setSourceStatus, stopRuntimeRaw]);

  useEffect(() => {
    const routeIds = new Set([...allSources.map((source) => source.id), ...(mixer.current?.sourceIds() ?? [])]);
    for (const source of allSources) runtimeSources.current.set(source.id, source);
    for (const runtimeId of routeIds) void applyCommittedAudioSettings(runtimeId);
  }, [allSources, applyCommittedAudioSettings, programProject, programSourceIds, programSourceOriginIds]);

  useEffect(() => {
    const currentOwnerIds = new Set(allSources.map((source) => source.id));
    const retainedIds = new Set<string>([
      ...programSourceIds,
      ...(params.retainedSourceIds ?? []),
    ]);
    for (const source of allSources) {
      runtimeSources.current.set(source.id, source);
      previouslyOwnedRuntimeIds.current.add(source.id);
    }
    for (const runtimeId of previouslyOwnedRuntimeIds.current) {
      if (currentOwnerIds.has(runtimeId) || retainedIds.has(runtimeId)) continue;
      releaseRuntimeOwnership(runtimeId);
      if (runtimes.current.has(runtimeId) || mixer.current?.sourceIds().includes(runtimeId)) stopRuntimeRaw(runtimeId);
      previouslyOwnedRuntimeIds.current.delete(runtimeId);
    }
  }, [allSources, params.retainedSourceIds, programProject, programSourceIds, releaseRuntimeOwnership, stopRuntimeRaw]);

  const inputRestoreSignature = JSON.stringify(allSources
    .filter((source) => activeSourceIds.has(source.id) && (source.kind === 'camera' || source.kind === 'microphone'))
    .map((source) => ({ id: source.id, kind: source.kind as InputCaptureKind, deviceId: source.deviceId ?? '', captureAudioEnabled: source.captureAudioEnabled === true, audioDeviceId: source.audioDeviceId ?? '', name: source.name, inputDeviceRevision })));

  useEffect(() => {
    if (restoreBlockedProject.current && projectRef.current === restoreBlockedProject.current) return;
    restoreBlockedProject.current = null;
    const sources = JSON.parse(inputRestoreSignature) as Array<{ id: string; kind: InputCaptureKind; deviceId: string; captureAudioEnabled: boolean; audioDeviceId: string; name: string; inputDeviceRevision: number }>;
    for (const candidate of sources) {
      const source = allSources.find((item) => item.id === candidate.id);
      if (!source || runtimes.current.has(source.id)) continue;
      const baseAttemptKey = `${source.id}:${source.deviceId ?? 'default'}`;
      const generation = captureSessionGeneration.current;
      const ownershipEpoch = runtimeOwnershipEpochs.current.get(source.id) ?? 0;
      const isCurrentOwner = () => (runtimeOwnershipEpochs.current.get(source.id) ?? 0) === ownershipEpoch;
      const inFlightKey = `${baseAttemptKey}:${generation}:${ownershipEpoch}`;
      const attemptKey = `${baseAttemptKey}:${inputDeviceRevision}`;
      if (inputRestoreAttempts.current.has(attemptKey) || inputRestoreInFlight.current.has(inFlightKey)) continue;
      inputRestoreAttempts.current.add(attemptKey);
      inputRestoreInFlight.current.add(inFlightKey);
      setSourceStatus(source.id, { state: 'starting' });
      void getInputCaptureStream(candidate.kind, candidate.deviceId || undefined, source, candidate.captureAudioEnabled, candidate.audioDeviceId || undefined).then(async ({ stream, audioError }) => {
        if (generation !== captureSessionGeneration.current || !isCurrentOwner()) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (runtimes.current.has(source.id) || !activeSourceIdsRef.current.has(source.id)
          || !allSourcesRef.current.some((candidateSource) => candidateSource.id === source.id)) {
          stream.getTracks().forEach((track) => track.stop());
          clearSourceStatus(source.id);
          return;
        }
        await attachRuntime(source, stream);
        if (generation !== captureSessionGeneration.current || !isCurrentOwner()) {
          if (runtimes.current.get(source.id) === stream) stopRuntimeRaw(source.id);
          return;
        }
      if (audioError) reportCameraAudioFailure(source.id, audioError);
        const devices = await listInputDevices(candidate.kind).catch(() => null);
        if (generation !== captureSessionGeneration.current || !isCurrentOwner()) return;
        if (devices) setInputDeviceOptions((current) => ({ ...current, [candidate.kind]: devices }));
        if (candidate.kind === 'camera') {
          const audioDevices = await listInputDevices('microphone').catch(() => null);
          if (generation !== captureSessionGeneration.current || !isCurrentOwner()) return;
          if (audioDevices) setInputDeviceOptions((current) => ({ ...current, microphone: audioDevices }));
        }
      }).catch((error) => {
        if (generation !== captureSessionGeneration.current || !isCurrentOwner()) return;
        if (!activeSourceIdsRef.current.has(source.id)
          || !allSourcesRef.current.some((candidateSource) => candidateSource.id === source.id)) {
          clearSourceStatus(source.id);
          return;
        }
        setSourceStatus(source.id, { state: 'unavailable', message: friendlyError(error) });
        setActionError(`${candidate.name} is unavailable.`);
        void listInputDevices(candidate.kind).then((devices) => {
          setInputDeviceOptions((current) => ({ ...current, [candidate.kind]: devices }));
        }).catch(() => undefined);
      }).finally(() => inputRestoreInFlight.current.delete(inFlightKey));
    }
  }, [activeSourceIdsRef, allSources, allSourcesRef, attachRuntime, clearSourceStatus, inputDeviceRevision, inputRestoreSignature, projectRef, reportCameraAudioFailure, setActionError, setSourceStatus, stopRuntimeRaw, runtimeOwnershipEpochs, runtimeRevision]);

  const restoreDesktopCapture = useCallback(async (source: RuntimeSource, reason: DesktopRestoreReason = 'startup') => {
    if ((source.kind !== 'display' && source.kind !== 'window') || captureKind !== null) return;
    const originId = getOriginSourceId(source);
    const unsupportedWindowAudioRequested = hasWindowCaptureAudioIntent(source);
    const signature = JSON.stringify([
      source.kind,
      source.captureTarget ?? null,
      source.name,
      captureAudioModeForSource(source, api.platform),
      source.captureAudioApplicationPath ?? null,
      unsupportedWindowAudioRequested,
    ]);
    const ownershipEpoch = runtimeOwnershipEpochs.current.get(source.id) ?? 0;
    const previous = desktopRestoreAttempts.current.get(source.id);
    const sameOwnership = previous?.ownershipEpoch === ownershipEpoch;
    const attempts = previous?.signature === signature && sameOwnership ? previous.attempts : 0;
    const maximumAttempts = reason === 'track-ended' ? 2 : 1;
    if ((previous?.signature === signature && sameOwnership && previous.inFlight) || attempts >= maximumAttempts) return;

    desktopRestoreAttempts.current.set(source.id, { signature, attempts: attempts + 1, inFlight: true, ownershipEpoch });
    const captureGeneration = captureSessionGeneration.current;
    const manualRevision = manualCaptureRevision.current;
    const isCurrent = () => captureGeneration === captureSessionGeneration.current
      && manualRevision === manualCaptureRevision.current
      && captureKind === null
      && (runtimeOwnershipEpochs.current.get(source.id) ?? 0) === ownershipEpoch
      && allSourcesRef.current.some((candidate) => candidate.id === source.id)
      && activeSourceIdsRef.current.has(source.id);
    if (!isCurrent()) {
      const record = desktopRestoreAttempts.current.get(source.id);
      if (record?.signature === signature && record.ownershipEpoch === ownershipEpoch) {
        desktopRestoreAttempts.current.set(source.id, { ...record, attempts, inFlight: false });
      }
      return;
    }

    let releaseLock!: () => void;
    const currentLock = new Promise<void>((resolve) => { releaseLock = resolve; });
    const previousLock = desktopRestoreQueue.current;
    const queuedLock = previousLock.catch(() => undefined).then(() => currentLock);
    desktopRestoreQueue.current = queuedLock;
    await previousLock.catch(() => undefined);

    let stream: MediaStream | null = null;
    let runtimeId: string | null = null;
    try {
      if (!isCurrent()) throw new CaptureOperationCancelled();

      setSourceStatus(source.id, { state: 'starting' });
      const kind = source.kind === 'display' ? 'screen' : 'window';
      const option = await api.resolveDesktopCapture(
        kind,
        source.captureId,
        source.captureTarget,
        source.captureTarget ? undefined : source.name,
      );
      if (!isCurrent()) throw new CaptureOperationCancelled();
      if (!option) throw new Error('The saved capture target could not be matched safely. Reconnect Capture to choose it.');

      const audioMode = captureAudioModeForSource(source, api.platform);
      const includeDisplayAudio = audioMode === 'system' && api.platform === 'win32';
      const frameRate = projectRef.current?.output.frameRate ?? 30;
      const cursorMode = source.cursorMode ?? 'motion';
      await api.prepareDesktopCapture(option.id, includeDisplayAudio, 'automatic-restore');
      if (!isCurrent()) throw new CaptureOperationCancelled();

      const requestStream = async (withAudio: boolean) => navigator.mediaDevices.getUserMedia(
        desktopRestoreConstraints(option.id, frameRate, cursorMode, withAudio),
      );
      let audioUnavailable = unsupportedWindowAudioRequested;
      let audioWarning = unsupportedWindowAudioRequested
        ? `${WINDOW_ONLY_AUDIO_UNAVAILABLE_MESSAGE} Video capture is still active.`
        : '';
      try {
        stream = await requestStream(includeDisplayAudio);
      } catch (error) {
        if (!includeDisplayAudio) throw error;
        await api.prepareDesktopCapture(option.id, false, 'automatic-restore');
        if (!isCurrent()) throw new CaptureOperationCancelled();
        stream = await requestStream(false);
        audioUnavailable = true;
        audioWarning = 'System audio was not restored. Window video capture is still active.';
      }
      if (!isCurrent()) throw new CaptureOperationCancelled();
      if (source.kind === 'window' && stream.getAudioTracks().length > 0) {
        const unexpectedAudioTracks = stream.getAudioTracks();
        const videoTracks = stream.getVideoTracks();
        unexpectedAudioTracks.forEach((track) => track.stop());
        stream = new MediaStream(videoTracks);
      }
      const liveVideoTracks = stream.getVideoTracks().filter((track) => track.readyState === 'live');
      if (liveVideoTracks.length === 0) throw new Error('The selected window did not provide a live video track.');
      audioUnavailable ||= includeDisplayAudio && stream.getAudioTracks().length === 0;
      if (audioUnavailable && !audioWarning) audioWarning = 'System audio was not restored. Window video capture is still active.';

      const reboundSource = bindDesktopCaptureSource(source, option, cursorMode, 'automatic-restore');
      runtimeId = preserveDesktopCaptureRuntime(source, reboundSource);
      if ((audioMode === 'application' && supportsApplicationAudioCapture(api.platform))
        || (audioMode === 'system' && api.platform === 'darwin')) {
        try {
          let application: AudioApplicationOption | undefined;
          if (audioMode === 'application') {
            const applications = await api.listAudioApplications();
            if (!isCurrent()) throw new CaptureOperationCancelled();
            application = uniqueAudioApplicationForPath(applications, source.captureAudioApplicationPath, api.platform) ?? undefined;
            if (!application) {
              audioUnavailable = true;
              audioWarning = 'The saved application is unavailable or matches multiple running instances. Video capture is still active.';
            }
          }
          if (audioMode === 'system' || application) {
            await startNativeAudioRuntime(reboundSource, audioMode, application, stream);
            if (!isCurrent()) throw new CaptureOperationCancelled();
            if (!runtimes.current.get(runtimeId)?.getVideoTracks().some((track) => track.readyState === 'live')) {
              throw new Error('The selected window did not provide a live video track.');
            }
            stream = null;
          }
        } catch (error) {
          if (isCaptureOperationCancelled(error) || !isCurrent()) throw new CaptureOperationCancelled();
          audioUnavailable = true;
          audioWarning = `${audioMode === 'application' ? 'Application' : 'System'} audio could not be restored: ${friendlyError(error)}. Video capture is still active.`;
        }
      } else if (audioMode !== 'off' && !includeDisplayAudio) {
        audioUnavailable = true;
        audioWarning = `${audioMode === 'application' ? 'Application' : 'System'} audio is not supported on this platform. Video capture is still active.`;
      }
      if (stream) {
        if (!hasLiveVideoTrack(stream)) throw new Error('The selected window did not provide a live video track.');
        if (!isCurrent()) throw new CaptureOperationCancelled();
        await attachRuntime(reboundSource, stream);
        if (!isCurrent()) throw new CaptureOperationCancelled();
        stream = null;
      }
      if (!isCurrent()) throw new CaptureOperationCancelled();
      const draftStillOwnsRequestedRuntime = projectRef.current?.scenes
        .flatMap((scene) => flattenSourceNodes(scene.sources))
        .some((candidate) => getOriginSourceId(candidate) === originId
          && candidate.kind === source.kind
          && getSourceRuntimeId(candidate) === source.id) ?? false;
      if (draftStillOwnsRequestedRuntime) {
        updateSource(originId, (current) => getOriginSourceId(current) === originId
          && current.kind === source.kind
          && getSourceRuntimeId(current) === source.id
          ? {
            ...current,
            captureId: option.id,
            captureTarget: reboundSource.captureTarget,
            cursorMode: reboundSource.cursorMode,
          }
          : current);
      }
      if (audioUnavailable) {
        setSourceStatus(runtimeId, { state: 'warning', message: audioWarning });
        setActionError(audioWarning);
      }
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (!isCaptureOperationCancelled(error) && isCurrent()) {
        const message = error instanceof Error ? error.message : friendlyError(error);
        setSourceStatus(source.id, { state: 'unavailable', message });
        setActionError(`${source.name} could not be restored. Use Reconnect Capture to choose it.`);
      } else if (captureGeneration === captureSessionGeneration.current
        && (runtimeOwnershipEpochs.current.get(source.id) ?? 0) === ownershipEpoch) {
        clearSourceStatus(source.id);
      }
    } finally {
      const record = desktopRestoreAttempts.current.get(source.id);
      if (record?.signature === signature && record.ownershipEpoch === ownershipEpoch) {
        desktopRestoreAttempts.current.set(source.id, { ...record, inFlight: false });
      }
      releaseLock();
      if (desktopRestoreQueue.current === queuedLock) desktopRestoreQueue.current = Promise.resolve();
      if (runtimeId && stream) stopRuntimeRaw(runtimeId, false);
    }
  }, [activeSourceIdsRef, allSourcesRef, api, attachRuntime, captureKind, clearSourceStatus, projectRef, setActionError, setSourceStatus, startNativeAudioRuntime, stopRuntimeRaw, updateSource]);

  desktopRestoreRef.current = (source) => { void restoreDesktopCapture(source, 'track-ended'); };

  useEffect(() => {
    for (const source of allSources) {
      if (source.kind === 'window') void stripUnsupportedWindowAudio(source);
    }
  }, [allSources, runtimeRevision, stripUnsupportedWindowAudio]);

  const desktopRestoreSignature = JSON.stringify(allSources
    .filter((source) => activeSourceIds.has(source.id) && (source.kind === 'display' || source.kind === 'window'))
    .map((source) => ({
      id: source.id,
      kind: source.kind,
      captureId: source.captureId ?? '',
      captureTarget: source.captureTarget ?? null,
      name: source.name,
      captureAudioMode: captureAudioModeForSource(source, api.platform),
      captureAudioApplicationPath: source.captureAudioApplicationPath ?? '',
    })));

  useEffect(() => {
    if (captureKind !== null || (restoreBlockedProject.current && projectRef.current === restoreBlockedProject.current)) return;
    for (const source of allSources) {
      if ((source.kind !== 'display' && source.kind !== 'window') || !activeSourceIdsRef.current.has(source.id)) continue;
      const stream = runtimes.current.get(source.id);
      if (stream?.getVideoTracks().some((track) => track.readyState === 'live')) continue;
      void restoreDesktopCapture(source, 'startup');
    }
  }, [activeSourceIdsRef, allSources, captureKind, desktopRestoreSignature, projectRef, restoreDesktopCapture, runtimeRevision]);

  const runtimesSnapshot = useMemo(() => new Map(runtimes.current), [runtimeRevision]);

  const resetForWorkspaceChange = () => {
    captureSessionGeneration.current += 1;
    manualCaptureRevision.current += 1;
    captureAudioApplicationRequest.current += 1;
    desktopRestoreAttempts.current.clear();
    runtimeOwnershipEpochs.current.clear();
    restoreBlockedProject.current = projectRef.current;
    inputRestoreAttempts.current.clear();
    inputRestoreInFlight.current.clear();
    browserAudioInFlight.current.clear();
    mediaElementConnectionOwners.current.clear();
    const runtimeIds = new Set([
      ...runtimes.current.keys(),
      ...applicationAudioInputs.current.keys(),
      ...(mixer.current?.sourceIds() ?? []),
    ]);
    for (const runtimeId of runtimeIds) stopRuntimeRaw(runtimeId);
    browserSessions.reset();
    pendingBrowserFrames.current.clear();
    runtimeSources.current.clear();
    previouslyOwnedRuntimeIds.current.clear();
    setMeterLevels({});
    setSourceStatuses({});
    setMediaPlaybackStates({});
    setCaptureOptions(null);
    setCaptureKind(null);
    setCaptureTargetSourceId(null);
    setCaptureAudioMode('off');
    setCaptureAudioApplications(null);
    setCaptureAudioApplicationLoading(false);
    setSelectedCaptureAudioApplication(null);
    setApplicationAudioOptions(null);
    setApplicationAudioTargetSourceId(null);
    setInputDevicePicker(null);
    setCameraAudioEnabled(true);
    setCameraAudioDeviceId('');
  };

  return {
    runtimes, mixer, applicationAudioInputs, applicationAudioSessions, ensureMixer,
    attachRuntime, stopRuntime, connectMediaElement, onMediaPlaybackState, onBrowserElement,
    mediaPlaybackStates, meterLevels, sourceStatuses, runtimeRevision, runtimesSnapshot,
    startApplicationAudioRuntime, startSystemAudioRuntime, clearNoiseSuppressionPreference, resetForWorkspaceChange,
    audioSettings, audioOutputDevices, audioSettingsError, updateMonitoringDevice, refreshAudioOutputDevices,
    captureOptions, captureKind, captureTargetSourceId, setCaptureOptions, setCaptureKind, setCaptureTargetSourceId,
    supportsSystemAudio, supportsApplicationAudio, captureAudioMode, setCaptureAudioMode,
    captureAudioApplications, captureAudioApplicationLoading, selectedCaptureAudioApplication,
    onLoadCaptureAudioApplications, onSelectCaptureAudioApplication,
    captureCursorMode, setCaptureCursorMode, openCapturePicker, addDesktopCapture,
    applicationAudioOptions, applicationAudioTargetSourceId, setApplicationAudioOptions, setApplicationAudioTargetSourceId,
    openApplicationAudioPicker, addSystemAudioCapture, chooseAudioApplication,
    inputDevicePicker, inputDeviceOptions, cameraAudioEnabled, setCameraAudioEnabled, cameraAudioDeviceId, setCameraAudioDeviceId,
    setInputDevicePicker, openInputDevicePicker, chooseInputDevice, switchInputDevice, updateCameraAudioSettings, toggleDesktopCaptureAudio,
    updateCameraCaptureSettings,
  };
}

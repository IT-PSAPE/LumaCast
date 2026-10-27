import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { AudioMixerEngine } from '../../audio-mixer';
import { audioOutputDeviceOptions, type AudioOutputDeviceOption } from '../../audio-output-devices';
import { retainDesktopAudioTracks } from '../../desktop-audio-capture';
import { bindDesktopCaptureSource } from '../../desktop-capture-binding';
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
import { getOriginSourceId, toRuntimeSource, type RuntimeSource } from '../../source-runtime';
import { createSource, DEFAULT_AUDIO_FILTERS } from '../sources/helpers';
import {
  applyBrowserFrame,
  browserAudioCaptureConstraints,
  inputCaptureConstraints,
  listInputDevices,
  monitoringDeviceError,
  type BrowserSourceConfig,
  type InputCaptureKind,
  type InputDeviceOption,
} from './helpers';

export type ApplicationAudioInput = Awaited<ReturnType<AudioMixerEngine['createApplicationAudioInput']>>;

export interface SourceStatus {
  state: 'starting' | 'ready' | 'unavailable';
  message?: string;
}

class CaptureOperationCancelled extends Error {
  constructor() {
    super('Capture operation belongs to an earlier workspace.');
    this.name = 'CaptureOperationCancelled';
  }
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
  attachRuntime: (source: StreamSource, stream: MediaStream) => Promise<void>;
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
  includeSystemAudio: boolean;
  setIncludeSystemAudio: Dispatch<SetStateAction<boolean>>;
  captureCursorMode: CaptureCursorMode;
  setCaptureCursorMode: Dispatch<SetStateAction<CaptureCursorMode>>;
  openCapturePicker: (kind: 'screen' | 'window' | 'audio', targetSourceId?: string) => Promise<void>;
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
  setInputDevicePicker: Dispatch<SetStateAction<InputCaptureKind | null>>;
  openInputDevicePicker: (kind: InputCaptureKind) => Promise<void>;
  chooseInputDevice: (device: InputDeviceOption) => Promise<void>;
  switchInputDevice: (source: StreamSource, deviceId: string | undefined) => Promise<void>;
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
  const { api, project, projectRef, allSources, allSourcesRef, programProject, programSourceIds, activeSourceIds, activeSourceIdsRef, setActionError, working, setWorking, displayCaptureSystemAudio, imageElements, closeSourceMenu, addToActiveScene, updateSource } = params;

  const [captureOptions, setCaptureOptions] = useState<DesktopSourceOption[] | null>(null);
  const [captureKind, setCaptureKind] = useState<'screen' | 'window' | 'audio' | null>(null);
  const [captureTargetSourceId, setCaptureTargetSourceId] = useState<string | null>(null);
  const [applicationAudioOptions, setApplicationAudioOptions] = useState<AudioApplicationOption[] | null>(null);
  const [applicationAudioTargetSourceId, setApplicationAudioTargetSourceId] = useState<string | null>(null);
  const [inputDevicePicker, setInputDevicePicker] = useState<InputCaptureKind | null>(null);
  const [inputDeviceOptions, setInputDeviceOptions] = useState<Record<InputCaptureKind, InputDeviceOption[]>>({ camera: [], microphone: [] });
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true);
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
  const previouslyOwnedRuntimeIds = useRef(new Set<string>());
  const applicationAudioInputs = useRef(new Map<string, ApplicationAudioInput>());
  const applicationAudioSessions = useRef(new Map<string, { pid: number; path: string }>());
  const mixer = useRef<AudioMixerEngine | null>(null);
  const audioSettingsRef = useRef(audioSettings);
  audioSettingsRef.current = audioSettings;
  const browserConfigs = useRef(new Map<string, BrowserSourceConfig>());
  const browserAudioInFlight = useRef(new Set<string>());
  const pendingBrowserFrames = useRef(new Map<string, ArrayBuffer>());
  const inputRestoreAttempts = useRef(new Set<string>());
  const inputRestoreInFlight = useRef(new Set<string>());
  const noiseSuppressionFailures = useRef(new Set<string>());
  const restoreBlockedProject = useRef<StreamProject | null>(null);
  const captureSessionGeneration = useRef(0);
  const nativeCaptureLocks = useRef(new Map<string, Promise<void>>());
  const programProjectRef = useRef(programProject);
  const programSourceIdsRef = useRef(programSourceIds);
  const retainedSourceIdsRef = useRef(params.retainedSourceIds ?? new Set<string>());
  programProjectRef.current = programProject;
  programSourceIdsRef.current = programSourceIds;
  retainedSourceIdsRef.current = params.retainedSourceIds ?? new Set<string>();

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

  const committedSource = useCallback((runtimeId: string): StreamSource | undefined => {
    const committed = programProjectRef.current;
    if (!committed) return undefined;
    for (const scene of committed.scenes) {
      const source = flattenSourceNodes(scene.sources).find((candidate) => candidate.id === runtimeId);
      if (source) return source;
    }
    return undefined;
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

  const applyCommittedAudioSettings = useCallback(async (runtimeId: string) => {
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
    if (!ready && !noiseSuppressionFailures.current.has(runtimeId)) {
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
    runtimeSources.current.set(runtimeId, runtimeSource);
    setSourceStatus(runtimeId, { state: 'starting' });
    try {
      const audioMixer = ensureMixer();
      const settingsAtCreation = committedAudioSettings(runtimeId);
      const routeAlreadyExists = audioMixer.sourceIds().includes(runtimeId);
      const routeSettings = routeAlreadyExists ? settingsAtCreation : { ...settingsAtCreation, programActive: false };
      const noiseSuppressionReady = await audioMixer.addMediaElement(runtimeId, element, routeSettings);
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      if (!allSourcesRef.current.some((candidate) => candidate.id === runtimeId)) {
        audioMixer.remove(runtimeId);
        runtimeSources.current.delete(runtimeId);
        clearSourceStatus(runtimeId);
        throw new CaptureOperationCancelled();
      }
      if (!audioMixer.sourceIds().includes(runtimeId)) throw new Error('The audio route became unavailable while it was being connected.');
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
      if (generation !== captureSessionGeneration.current || !allSourcesRef.current.some((candidate) => candidate.id === runtimeId)) {
        throw new CaptureOperationCancelled();
      }
      setSourceStatus(runtimeId, { state: 'ready' });
      setMeterLevels((current) => ({ ...current, [runtimeId]: 0 }));
    } catch (error) {
      if (isCaptureOperationCancelled(error)) throw error;
      setSourceStatus(runtimeId, { state: 'unavailable', message: friendlyError(error) });
      setActionError(`Media audio could not be added: ${friendlyError(error)}`);
      throw error;
    }
  }, [allSourcesRef, applyCommittedAudioSettings, clearSourceStatus, committedAudioSettings, ensureMixer, setActionError, setSourceStatus]);

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

  const stopRuntimeRaw = useCallback((runtimeId: string, clearStatus = true) => {
    const stream = runtimes.current.get(runtimeId);
    // Remove ownership before stopping tracks so the resulting `ended` events
    // are not mistaken for an unexpected device disconnect.
    runtimes.current.delete(runtimeId);
    stream?.getTracks().forEach((track) => track.stop());
    const applicationAudioInput = applicationAudioInputs.current.get(runtimeId);
    if (applicationAudioInput) {
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

  const attachRuntime = useCallback(async (source: StreamSource, stream: MediaStream) => {
    const generation = captureSessionGeneration.current;
    const runtimeSource = toRuntimeSource(source);
    const runtimeId = runtimeSource.id;
    runtimeSources.current.set(runtimeId, runtimeSource);
    const existing = runtimes.current.get(runtimeId);
    if (existing && existing !== stream && existing.getTracks().some((track) => track.readyState !== 'ended')) {
      stream.getTracks().forEach((track) => track.stop());
      setSourceStatus(runtimeId, { state: 'ready' });
      return;
    }
    if (existing && existing !== stream) stopRuntimeRaw(runtimeId, false);
    setSourceStatus(runtimeId, { state: 'starting' });
    runtimes.current.set(runtimeId, stream);
    setRuntimeRevision((value) => value + 1);
    const clearEndedRuntime = () => {
      if (generation !== captureSessionGeneration.current
        || runtimes.current.get(runtimeId) !== stream
        || stream.getTracks().some((track) => track.readyState !== 'ended')) return false;
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
      return true;
    };
    const handleEnded = () => { clearEndedRuntime(); };
    const removeEndedListeners = listenForMediaStreamEnd(stream, handleEnded);
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
    setSourceStatus(runtimeId, { state: 'ready' });
  }, [api, applyCommittedAudioSettings, committedAudioSettings, ensureMixer, setActionError, setSourceStatus, stopRuntimeRaw]);

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

  const startApplicationAudioRuntime = useCallback(async (source: StreamSource, application: AudioApplicationOption) => {
    if (source.kind !== 'application-audio') throw new Error('Invalid application-audio source.');
    const generation = captureSessionGeneration.current;
    const runtimeSource = toRuntimeSource(source);
    const runtimeId = runtimeSource.id;
    await withNativeCaptureLock(runtimeId, async () => {
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      if (applicationAudioInputs.current.has(runtimeId)) return;
      runtimeSources.current.set(runtimeId, runtimeSource);
      setSourceStatus(runtimeId, { state: 'starting' });
      const input = await ensureMixer().createApplicationAudioInput();
      if (generation !== captureSessionGeneration.current) { input.close(); throw new CaptureOperationCancelled(); }
      applicationAudioInputs.current.set(runtimeId, input);
      applicationAudioSessions.current.set(runtimeId, { pid: application.pid, path: application.path });
      try {
        await api.startApplicationAudioCapture(runtimeId, application.pid, application.path);
        if (generation !== captureSessionGeneration.current) {
          input.close();
          await api.stopApplicationAudioCapture(runtimeId).catch(() => undefined);
          throw new CaptureOperationCancelled();
        }
        await attachRuntime(runtimeSource, input.stream);
      } catch (error) {
        if (applicationAudioInputs.current.get(runtimeId) === input) {
          applicationAudioInputs.current.delete(runtimeId);
          applicationAudioSessions.current.delete(runtimeId);
        }
        input.close();
        await api.stopApplicationAudioCapture(runtimeId).catch(() => undefined);
        if (generation === captureSessionGeneration.current) setSourceStatus(runtimeId, { state: 'unavailable', message: friendlyError(error) });
        throw error;
      }
    });
  }, [api, attachRuntime, ensureMixer, setSourceStatus, withNativeCaptureLock]);

  const startSystemAudioRuntime = useCallback(async (source: StreamSource) => {
    if (source.kind !== 'desktop-audio') throw new Error('Invalid desktop-audio source.');
    const generation = captureSessionGeneration.current;
    const runtimeSource = toRuntimeSource(source);
    const runtimeId = runtimeSource.id;
    await withNativeCaptureLock(runtimeId, async () => {
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      if (applicationAudioInputs.current.has(runtimeId)) return;
      runtimeSources.current.set(runtimeId, runtimeSource);
      setSourceStatus(runtimeId, { state: 'starting' });
      const input = await ensureMixer().createApplicationAudioInput();
      if (generation !== captureSessionGeneration.current) { input.close(); throw new CaptureOperationCancelled(); }
      applicationAudioInputs.current.set(runtimeId, input);
      try {
        await api.startSystemAudioCapture(runtimeId);
        if (generation !== captureSessionGeneration.current) {
          input.close();
          await api.stopApplicationAudioCapture(runtimeId).catch(() => undefined);
          throw new CaptureOperationCancelled();
        }
        await attachRuntime(runtimeSource, input.stream);
      } catch (error) {
        if (applicationAudioInputs.current.get(runtimeId) === input) applicationAudioInputs.current.delete(runtimeId);
        input.close();
        await api.stopApplicationAudioCapture(runtimeId).catch(() => undefined);
        if (generation === captureSessionGeneration.current) setSourceStatus(runtimeId, { state: 'unavailable', message: friendlyError(error) });
        throw error;
      }
    });
  }, [api, attachRuntime, ensureMixer, setSourceStatus, withNativeCaptureLock]);

  const openCapturePicker = async (kind: 'screen' | 'window' | 'audio', targetSourceId?: string) => {
    closeSourceMenu();
    setActionError('');
    if (targetSourceId) {
      const target = findSourceByOrigin(targetSourceId);
      if (target?.kind === 'display' || target?.kind === 'window') setCaptureCursorMode(target.cursorMode ?? 'motion');
    }
    setWorking(true);
    try {
      const sources = await api.listDesktopSources(kind === 'audio' ? 'screen' : kind);
      setCaptureKind(kind);
      setCaptureTargetSourceId(targetSourceId ?? null);
      setCaptureOptions(sources);
    } catch (error) {
      setActionError(`Could not list capture sources: ${friendlyError(error)}`);
    } finally {
      setWorking(false);
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
    const captureMode = captureKind;
    if (!captureMode) return;
    setWorking(true);
    setActionError('');
    let stream: MediaStream | null = null;
    try {
      const captureAudio = captureMode === 'audio' || (includeSystemAudio && displayCaptureSystemAudio);
      // Start the media request in the picker click handler so Chromium keeps
      // the user's gesture while main validates and grants the chosen source.
      const mediaRequest = navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: captureMode === 'audio' ? 1 : project.output.frameRate, max: captureMode === 'audio' ? 1 : project.output.frameRate }, cursor: captureCursorMode } as MediaTrackConstraints,
        audio: captureAudio,
      });
      void mediaRequest.catch(() => undefined);
      await api.prepareDesktopCapture(option.id, captureAudio);
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      stream = await mediaRequest;
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      let source: StreamSource;
      if (captureMode === 'audio') {
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
        source = bindDesktopCaptureSource(reconnectSource, option, captureCursorMode);
      } else {
        const kind = option.kind === 'screen' ? 'display' : 'window';
        source = createSource(kind, project.output, option.name, { captureId: option.id, cursorMode: captureCursorMode });
      }
      await attachRuntime(source, stream);
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      if (captureTargetSourceId) {
        updateSource(getOriginSourceId(source), (current) => ({ ...current, captureId: option.id, ...(source.kind === 'display' || source.kind === 'window' ? { cursorMode: source.cursorMode } : {}) }));
      } else {
        addToActiveScene(source);
      }
      setCaptureOptions(null);
      setCaptureKind(null);
      setCaptureTargetSourceId(null);
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
    const generation = captureSessionGeneration.current;
    setWorking(true);
    setActionError('');
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia(inputCaptureConstraints(kind, device.deviceId || undefined));
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      const label = stream.getTracks()[0]?.label || device.label;
      const source = createSource(kind, project.output, label, device.deviceId ? { deviceId: device.deviceId } : {});
      await attachRuntime(source, stream);
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      addToActiveScene(source);
      setInputDevicePicker(null);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (!isCaptureOperationCancelled(error)) setActionError(`Could not start ${kind === 'camera' ? 'camera' : 'microphone'}: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const switchInputDevice = async (source: StreamSource, deviceId: string | undefined) => {
    if ((source.kind !== 'camera' && source.kind !== 'microphone') || working) return;
    const generation = captureSessionGeneration.current;
    const kind = source.kind;
    setWorking(true);
    setActionError('');
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia(inputCaptureConstraints(kind, deviceId, source));
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      const label = stream.getTracks()[0]?.label || source.name;
      const nextSource = { ...source, name: label, deviceId };
      await attachRuntime(nextSource, stream);
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      updateSource(getOriginSourceId(source), (current) => ({ ...current, name: label, deviceId }));
      const devices = await listInputDevices(kind);
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      setInputDeviceOptions((current) => ({ ...current, [kind]: devices }));
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (!isCaptureOperationCancelled(error)) setActionError(`Could not switch ${kind === 'camera' ? 'camera' : 'microphone'}: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const updateCameraCaptureSettings = async (
    source: StreamSource,
    settings: Pick<StreamSource, 'cameraResolution' | 'cameraFrameRate'>,
  ) => {
    if (source.kind !== 'camera' || working) return;
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
    try {
      stream = await navigator.mediaDevices.getUserMedia(inputCaptureConstraints('camera', source.deviceId, nextSource));
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      await attachRuntime(nextSource, stream);
      if (generation !== captureSessionGeneration.current) throw new CaptureOperationCancelled();
      updateSource(getOriginSourceId(source), (current) => ({ ...current, ...settings }));
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
    for (const stream of runtimes.current.values()) stream.getTracks().forEach((track) => track.stop());
    runtimes.current.clear();
    for (const [sourceId, input] of applicationAudioInputs.current) {
      void api.stopApplicationAudioCapture(sourceId).catch(() => undefined);
      input.close();
    }
    applicationAudioInputs.current.clear();
    applicationAudioSessions.current.clear();
    void mixer.current?.close();
  }, [api]);

  const activeBrowserSources = allSources.filter((source) => activeSourceIds.has(source.id) && source.kind === 'browser');
  const browserSourceSignature = JSON.stringify([...new Map(activeBrowserSources.filter((source) => source.url)
    .map((source) => [source.id, {
      id: source.id,
      url: source.url!,
      width: source.browserViewportWidth ?? project?.output.baseWidth ?? 1920,
      height: source.browserViewportHeight ?? project?.output.baseHeight ?? 1080,
    }] as const)).values()]);
  const browserAudioSignature = JSON.stringify(activeBrowserSources
    .map((source) => ({ id: source.id, enabled: source.browserAudioEnabled === true, url: source.url ?? '' })));

  useEffect(() => {
    const desired = new Map<string, BrowserSourceConfig>((JSON.parse(browserSourceSignature) as BrowserSourceConfig[]).map((source) => [source.id, source]));
    for (const [id, existing] of browserConfigs.current) {
      const next = desired.get(id);
      if (!next || next.url !== existing.url || next.width !== existing.width || next.height !== existing.height) {
        void api.closeBrowserSource(id).catch(() => undefined);
        pendingBrowserFrames.current.delete(id);
      }
    }
    for (const [id, source] of desired) {
      const existing = browserConfigs.current.get(id);
      if (existing && existing.url === source.url && existing.width === source.width && existing.height === source.height) continue;
      setSourceStatus(id, { state: 'starting' });
      void api.createBrowserSource(id, source.url, source.width, source.height).then(() => {
        const current = browserConfigs.current.get(id);
        if (current?.url === source.url && current.width === source.width && current.height === source.height) setSourceStatus(id, { state: 'ready' });
        else void api.closeBrowserSource(id).catch(() => undefined);
      }, (error) => {
        setSourceStatus(id, { state: 'unavailable', message: friendlyError(error) });
      });
    }
    browserConfigs.current = desired;
  }, [api, browserSourceSignature, setSourceStatus]);

  useEffect(() => () => {
    for (const id of browserConfigs.current.keys()) void api.closeBrowserSource(id).catch(() => undefined);
    browserConfigs.current.clear();
    pendingBrowserFrames.current.clear();
  }, [api]);

  useEffect(() => api.onApplicationAudioFrame((sourceId, frame) => {
    const input = applicationAudioInputs.current.get(sourceId);
    if (!input) return;
    if (frame instanceof ArrayBuffer) {
      input.node.port.postMessage(frame, [frame]);
      return;
    }
    stopRuntimeRaw(sourceId, false);
    setSourceStatus(sourceId, { state: 'unavailable', message: frame.error });
  }), [api, setSourceStatus, stopRuntimeRaw]);

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
  }, [allSources, applyCommittedAudioSettings, programProject, programSourceIds]);

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
      if (runtimes.current.has(runtimeId) || mixer.current?.sourceIds().includes(runtimeId)) stopRuntimeRaw(runtimeId);
      previouslyOwnedRuntimeIds.current.delete(runtimeId);
    }
  }, [allSources, params.retainedSourceIds, programProject, programSourceIds, stopRuntimeRaw]);

  const inputRestoreSignature = JSON.stringify(allSources
    .filter((source) => activeSourceIds.has(source.id) && (source.kind === 'camera' || source.kind === 'microphone'))
    .map((source) => ({ id: source.id, kind: source.kind as InputCaptureKind, deviceId: source.deviceId ?? '', name: source.name, inputDeviceRevision })));

  useEffect(() => {
    if (restoreBlockedProject.current && projectRef.current === restoreBlockedProject.current) return;
    restoreBlockedProject.current = null;
    const sources = JSON.parse(inputRestoreSignature) as Array<{ id: string; kind: InputCaptureKind; deviceId: string; name: string; inputDeviceRevision: number }>;
    for (const candidate of sources) {
      const source = allSources.find((item) => item.id === candidate.id);
      if (!source || runtimes.current.has(source.id)) continue;
      const baseAttemptKey = `${source.id}:${source.deviceId ?? 'default'}`;
      const generation = captureSessionGeneration.current;
      const inFlightKey = `${baseAttemptKey}:${generation}`;
      const attemptKey = `${baseAttemptKey}:${inputDeviceRevision}`;
      if (inputRestoreAttempts.current.has(attemptKey) || inputRestoreInFlight.current.has(inFlightKey)) continue;
      inputRestoreAttempts.current.add(attemptKey);
      inputRestoreInFlight.current.add(inFlightKey);
      setSourceStatus(source.id, { state: 'starting' });
      void navigator.mediaDevices.getUserMedia(inputCaptureConstraints(candidate.kind, candidate.deviceId || undefined, source)).then(async (stream) => {
        if (generation !== captureSessionGeneration.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (runtimes.current.has(source.id) || !activeSourceIdsRef.current.has(source.id)) {
          stream.getTracks().forEach((track) => track.stop());
          clearSourceStatus(source.id);
          return;
        }
        await attachRuntime(source, stream);
        if (generation !== captureSessionGeneration.current) return;
        const devices = await listInputDevices(candidate.kind);
        if (generation !== captureSessionGeneration.current) return;
        setInputDeviceOptions((current) => ({ ...current, [candidate.kind]: devices }));
      }).catch((error) => {
        if (generation !== captureSessionGeneration.current) return;
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
  }, [activeSourceIdsRef, allSources, allSourcesRef, attachRuntime, clearSourceStatus, inputDeviceRevision, inputRestoreSignature, projectRef, setActionError, setSourceStatus, runtimeRevision]);

  const runtimesSnapshot = useMemo(() => new Map(runtimes.current), [runtimeRevision]);

  const resetForWorkspaceChange = () => {
    captureSessionGeneration.current += 1;
    restoreBlockedProject.current = projectRef.current;
    inputRestoreAttempts.current.clear();
    inputRestoreInFlight.current.clear();
    browserAudioInFlight.current.clear();
    const runtimeIds = new Set([
      ...runtimes.current.keys(),
      ...applicationAudioInputs.current.keys(),
      ...(mixer.current?.sourceIds() ?? []),
    ]);
    for (const runtimeId of runtimeIds) stopRuntimeRaw(runtimeId);
    for (const id of browserConfigs.current.keys()) void api.closeBrowserSource(id).catch(() => undefined);
    browserConfigs.current.clear();
    pendingBrowserFrames.current.clear();
    runtimeSources.current.clear();
    previouslyOwnedRuntimeIds.current.clear();
    setMeterLevels({});
    setSourceStatuses({});
    setMediaPlaybackStates({});
    setCaptureOptions(null);
    setCaptureKind(null);
    setCaptureTargetSourceId(null);
    setApplicationAudioOptions(null);
    setApplicationAudioTargetSourceId(null);
    setInputDevicePicker(null);
  };

  return {
    runtimes, mixer, applicationAudioInputs, applicationAudioSessions, ensureMixer,
    attachRuntime, stopRuntime, connectMediaElement, onMediaPlaybackState, onBrowserElement,
    mediaPlaybackStates, meterLevels, sourceStatuses, runtimeRevision, runtimesSnapshot,
    startApplicationAudioRuntime, startSystemAudioRuntime, clearNoiseSuppressionPreference, resetForWorkspaceChange,
    audioSettings, audioOutputDevices, audioSettingsError, updateMonitoringDevice, refreshAudioOutputDevices,
    captureOptions, captureKind, captureTargetSourceId, setCaptureOptions, setCaptureKind, setCaptureTargetSourceId,
    includeSystemAudio, setIncludeSystemAudio, captureCursorMode, setCaptureCursorMode, openCapturePicker, addDesktopCapture,
    applicationAudioOptions, applicationAudioTargetSourceId, setApplicationAudioOptions, setApplicationAudioTargetSourceId,
    openApplicationAudioPicker, addSystemAudioCapture, chooseAudioApplication,
    inputDevicePicker, inputDeviceOptions, setInputDevicePicker, openInputDevicePicker, chooseInputDevice, switchInputDevice,
    updateCameraCaptureSettings,
  };
}

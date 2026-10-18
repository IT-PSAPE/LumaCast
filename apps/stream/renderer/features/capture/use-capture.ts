import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { AudioMixerEngine } from '../../audio-mixer';
import { audioOutputDeviceOptions, type AudioOutputDeviceOption } from '../../audio-output-devices';
import { retainDesktopAudioTracks } from '../../desktop-audio-capture';
import { bindDesktopCaptureSource } from '../../desktop-capture-binding';
import { listenForMediaStreamEnd } from '../../media-stream-ended';
import { getVisibleSourceIdsForScenes } from '../../../shared/scene-reference-graph';
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

export interface UseCaptureParams {
  api: StreamAPI;
  project: StreamProject | null;
  projectRef: RefObject<StreamProject | null>;
  allSources: StreamSource[];
  allSourcesRef: RefObject<StreamSource[]>;
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
  attachRuntime: (source: StreamSource, stream: MediaStream, programActiveOverride?: boolean) => Promise<void>;
  stopRuntime: (sourceId: string) => void;
  connectMediaElement: (source: StreamSource, element: HTMLMediaElement) => void;
  onMediaPlaybackState: (sourceId: string, element: HTMLMediaElement | null) => void;
  onBrowserElement: (sourceId: string, image: HTMLImageElement) => void;
  mediaPlaybackStates: Record<string, { paused: boolean; ended: boolean }>;
  meterLevels: Record<string, number>;
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
  const { api, project, projectRef, allSources, allSourcesRef, liveScene, activeSourceIds, activeSourceIdsRef, setActionError, working, setWorking, displayCaptureSystemAudio, imageElements, closeSourceMenu, addToActiveScene, updateSource } = params;

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
  const [mediaPlaybackStates, setMediaPlaybackStates] = useState<Record<string, { paused: boolean; ended: boolean }>>({});
  const [runtimeRevision, setRuntimeRevision] = useState(0);

  const runtimes = useRef(new Map<string, MediaStream>());
  const applicationAudioInputs = useRef(new Map<string, ApplicationAudioInput>());
  const applicationAudioSessions = useRef(new Map<string, { pid: number; path: string }>());
  const mixer = useRef<AudioMixerEngine | null>(null);
  const audioSettingsRef = useRef(audioSettings);
  audioSettingsRef.current = audioSettings;
  const browserConfigs = useRef(new Map<string, BrowserSourceConfig>());
  const browserAudioInFlight = useRef(new Set<string>());
  const pendingBrowserFrames = useRef(new Map<string, ArrayBuffer>());
  const inputRestoreAttempts = useRef(new Set<string>());

  const refreshAudioOutputDevices = useCallback(async () => {
    try {
      setAudioOutputDevices(audioOutputDeviceOptions(await navigator.mediaDevices.enumerateDevices()));
    } catch {
      setAudioSettingsError('Audio output devices could not be listed.');
    }
  }, []);

  const clearNoiseSuppressionPreference = useCallback((sourceId: string) => {
    updateSource(sourceId, (source) => ({ ...source, audioFilters: { ...DEFAULT_AUDIO_FILTERS, ...source.audioFilters, noiseSuppression: false } }));
  }, [updateSource]);

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

  const connectMediaElement = useCallback((source: StreamSource, element: HTMLMediaElement) => {
    void (async () => {
      try {
        const audioMixer = ensureMixer();
        const isProgramSource = liveScene?.sources.some((item) => item.id === source.id && item.visible) ?? false;
        const noiseSuppressionReady = await audioMixer.addMediaElement(source.id, element, { ...source, programActive: isProgramSource });
        audioMixer.setAudioTracks(source.id, allSourcesRef.current.find((item) => item.id === source.id)?.audioTracks ?? source.audioTracks ?? [1]);
        if (!noiseSuppressionReady && source.audioFilters?.noiseSuppression) {
          setActionError('Neural noise suppression could not be started for this audio source.');
          clearNoiseSuppressionPreference(source.id);
        }
        if ((source.audioFilters?.noiseGate || source.audioFilters?.expander) && audioMixer.setAudioFilters(source.id, source.audioFilters) === false) {
          setActionError('Audio filters are unavailable in this audio runtime.');
        }
        await audioMixer.resume();
        setMeterLevels((current) => ({ ...current, [source.id]: 0 }));
      } catch (error) {
        setActionError(`Media audio could not be added: ${friendlyError(error)}`);
      }
    })();
  }, [allSourcesRef, clearNoiseSuppressionPreference, ensureMixer, liveScene, setActionError]);

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

  const attachRuntime = useCallback(async (source: StreamSource, stream: MediaStream, programActiveOverride?: boolean) => {
    runtimes.current.get(source.id)?.getTracks().forEach((track) => track.stop());
    runtimes.current.set(source.id, stream);
    setRuntimeRevision((value) => value + 1);
    const clearEndedRuntime = () => {
      if (runtimes.current.get(source.id) !== stream || stream.getTracks().some((track) => track.readyState !== 'ended')) return false;
      runtimes.current.delete(source.id);
      mixer.current?.remove(source.id);
      setMeterLevels((current) => { const next = { ...current }; delete next[source.id]; return next; });
      setRuntimeRevision((value) => value + 1);
      return true;
    };
    const handleEnded = () => {
      if (clearEndedRuntime()) setActionError(`${source.name} capture ended.`);
    };
    const removeEndedListeners = listenForMediaStreamEnd(stream, handleEnded);
    if (stream.getTracks().length > 0 && stream.getTracks().every((track) => track.readyState === 'ended')) {
      handleEnded();
      removeEndedListeners();
      return;
    }
    if (stream.getAudioTracks().length > 0) {
      try {
        const audioMixer = ensureMixer();
        const isProgramScene = !project?.studioMode || project.activeSceneId === project.liveSceneId;
        const noiseSuppressionReady = await audioMixer.add(source.id, stream, { ...source, programActive: programActiveOverride ?? isProgramScene });
        audioMixer.setAudioTracks(source.id, allSourcesRef.current.find((item) => item.id === source.id)?.audioTracks ?? source.audioTracks ?? [1]);
        if (!noiseSuppressionReady && source.audioFilters?.noiseSuppression) {
          setActionError('Neural noise suppression could not be started for this audio source.');
          clearNoiseSuppressionPreference(source.id);
        }
        if ((source.audioFilters?.noiseGate || source.audioFilters?.expander) && audioMixer.setAudioFilters(source.id, source.audioFilters) === false) {
          setActionError('Audio filters are unavailable in this audio runtime.');
        }
        await audioMixer.resume();
        if (stream.getTracks().length > 0 && stream.getTracks().every((track) => track.readyState === 'ended')) {
          if (runtimes.current.get(source.id) === stream) handleEnded();
          audioMixer.remove(source.id);
          removeEndedListeners();
          return;
        }
        setMeterLevels((current) => ({ ...current, [source.id]: 0 }));
      } catch (error) {
        setActionError(`Audio source could not be added: ${friendlyError(error)}`);
      }
    }
    if (stream.getTracks().length > 0 && stream.getTracks().every((track) => track.readyState === 'ended')) {
      if (runtimes.current.get(source.id) === stream) handleEnded();
      mixer.current?.remove(source.id);
      removeEndedListeners();
    }
  }, [allSourcesRef, clearNoiseSuppressionPreference, ensureMixer, project, setActionError]);

  const stopRuntime = useCallback((sourceId: string) => {
    runtimes.current.get(sourceId)?.getTracks().forEach((track) => track.stop());
    runtimes.current.delete(sourceId);
    const applicationAudioInput = applicationAudioInputs.current.get(sourceId);
    if (applicationAudioInput) {
      applicationAudioInputs.current.delete(sourceId);
      applicationAudioSessions.current.delete(sourceId);
      applicationAudioInput.close();
      void api.stopApplicationAudioCapture(sourceId).catch(() => undefined);
    }
    mixer.current?.remove(sourceId);
    setMeterLevels((current) => { const next = { ...current }; delete next[sourceId]; return next; });
    setRuntimeRevision((value) => value + 1);
  }, [api]);

  const startApplicationAudioRuntime = useCallback(async (source: StreamSource, application: AudioApplicationOption) => {
    if (source.kind !== 'application-audio') throw new Error('Invalid application-audio source.');
    if (applicationAudioInputs.current.has(source.id)) stopRuntime(source.id);
    const input = await ensureMixer().createApplicationAudioInput();
    applicationAudioInputs.current.set(source.id, input);
    applicationAudioSessions.current.set(source.id, { pid: application.pid, path: application.path });
    try {
      await api.startApplicationAudioCapture(source.id, application.pid, application.path);
      await attachRuntime(source, input.stream);
    } catch (error) {
      if (applicationAudioInputs.current.get(source.id) === input) {
        applicationAudioInputs.current.delete(source.id);
        applicationAudioSessions.current.delete(source.id);
      }
      input.close();
      void api.stopApplicationAudioCapture(source.id).catch(() => undefined);
      throw error;
    }
  }, [api, attachRuntime, ensureMixer, stopRuntime]);

  const startSystemAudioRuntime = useCallback(async (source: StreamSource) => {
    if (source.kind !== 'desktop-audio') throw new Error('Invalid desktop-audio source.');
    if (applicationAudioInputs.current.has(source.id)) stopRuntime(source.id);
    const input = await ensureMixer().createApplicationAudioInput();
    applicationAudioInputs.current.set(source.id, input);
    try {
      await api.startSystemAudioCapture(source.id);
      await attachRuntime(source, input.stream);
    } catch (error) {
      if (applicationAudioInputs.current.get(source.id) === input) applicationAudioInputs.current.delete(source.id);
      input.close();
      void api.stopApplicationAudioCapture(source.id).catch(() => undefined);
      throw error;
    }
  }, [api, attachRuntime, ensureMixer, stopRuntime]);

  const openCapturePicker = async (kind: 'screen' | 'window' | 'audio', targetSourceId?: string) => {
    closeSourceMenu();
    setActionError('');
    if (targetSourceId) {
      const target = allSourcesRef.current.find((source) => source.id === targetSourceId);
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
    closeSourceMenu();
    const target = targetSourceId
      ? allSourcesRef.current.find((source) => source.id === targetSourceId && source.kind === 'desktop-audio')
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
      if (!target) addToActiveScene(source);
    } catch (error) {
      setActionError(`Could not capture desktop audio: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const chooseAudioApplication = async (application: AudioApplicationOption) => {
    if (!project || working) return;
    const target = applicationAudioTargetSourceId
      ? allSourcesRef.current.find((source) => source.id === applicationAudioTargetSourceId && source.kind === 'application-audio')
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
      if (target) updateSource(source.id, (current) => ({ ...current, name: application.name, applicationPath: application.path }));
      else addToActiveScene(source);
      setApplicationAudioOptions(null);
      setApplicationAudioTargetSourceId(null);
    } catch (error) {
      setActionError(`Could not capture ${application.name}: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const addDesktopCapture = async (option: DesktopSourceOption) => {
    if (!project || working) return;
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
      stream = await mediaRequest;
      let source: StreamSource;
      if (captureMode === 'audio') {
        const audioTracks = retainDesktopAudioTracks(stream);
        if (audioTracks.length === 0) throw new Error('The system did not provide a desktop audio track.');
        stream = new MediaStream(audioTracks);
        const reconnectSource = captureTargetSourceId
          ? allSourcesRef.current.find((item) => item.id === captureTargetSourceId && item.kind === 'desktop-audio')
          : null;
        if (captureTargetSourceId && !reconnectSource) throw new Error('The desktop audio source is no longer available.');
        source = reconnectSource
          ? { ...reconnectSource, captureId: option.id }
          : createSource('desktop-audio', project.output, 'Desktop Audio', { captureId: option.id });
      } else if (captureTargetSourceId) {
        const reconnectSource = allSourcesRef.current.find((item) => item.id === captureTargetSourceId);
        if (!reconnectSource) throw new Error('The capture source is no longer available.');
        source = bindDesktopCaptureSource(reconnectSource, option, captureCursorMode);
      } else {
        const kind = option.kind === 'screen' ? 'display' : 'window';
        source = createSource(kind, project.output, option.name, { captureId: option.id, cursorMode: captureCursorMode });
      }
      await attachRuntime(source, stream);
      if (captureTargetSourceId) {
        updateSource(source.id, (current) => ({ ...current, captureId: option.id, ...(source.kind === 'display' || source.kind === 'window' ? { cursorMode: source.cursorMode } : {}) }));
      } else {
        addToActiveScene(source);
      }
      setCaptureOptions(null);
      setCaptureKind(null);
      setCaptureTargetSourceId(null);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      setActionError(`Could not start capture: ${friendlyError(error)}`);
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
    setWorking(true);
    setActionError('');
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia(inputCaptureConstraints(kind, device.deviceId || undefined));
      const label = stream.getTracks()[0]?.label || device.label;
      const source = createSource(kind, project.output, label, device.deviceId ? { deviceId: device.deviceId } : {});
      await attachRuntime(source, stream);
      addToActiveScene(source);
      setInputDevicePicker(null);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      setActionError(`Could not start ${kind === 'camera' ? 'camera' : 'microphone'}: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const switchInputDevice = async (source: StreamSource, deviceId: string | undefined) => {
    if ((source.kind !== 'camera' && source.kind !== 'microphone') || working) return;
    const kind = source.kind;
    setWorking(true);
    setActionError('');
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia(inputCaptureConstraints(kind, deviceId, source));
      const label = stream.getTracks()[0]?.label || source.name;
      const nextSource = { ...source, name: label, deviceId };
      await attachRuntime(nextSource, stream);
      updateSource(source.id, (current) => ({ ...current, name: label, deviceId }));
      const devices = await listInputDevices(kind);
      setInputDeviceOptions((current) => ({ ...current, [kind]: devices }));
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      setActionError(`Could not switch ${kind === 'camera' ? 'camera' : 'microphone'}: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const updateCameraCaptureSettings = async (
    source: StreamSource,
    settings: Pick<StreamSource, 'cameraResolution' | 'cameraFrameRate'>,
  ) => {
    if (source.kind !== 'camera' || working) return;
    const nextSource = { ...source, ...settings };
    if (!runtimes.current.has(source.id)) {
      updateSource(source.id, (current) => ({ ...current, ...settings }));
      return;
    }
    setWorking(true);
    setActionError('');
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia(inputCaptureConstraints('camera', source.deviceId, nextSource));
      await attachRuntime(nextSource, stream);
      updateSource(source.id, (current) => ({ ...current, ...settings }));
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      setActionError(`Could not change camera settings: ${friendlyError(error)}`);
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

  const browserSourceSignature = JSON.stringify([...new Map(allSources.filter((source) => source.kind === 'browser' && source.url)
    .map((source) => [source.id, { id: source.id, url: source.url!, width: project?.output.baseWidth ?? 1920, height: project?.output.baseHeight ?? 1080 }] as const)).values()]);
  const browserAudioSignature = JSON.stringify(allSources.filter((source) => source.kind === 'browser')
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
      void api.createBrowserSource(id, source.url, source.width, source.height).catch((error) => {
        setActionError(`Browser source could not load: ${friendlyError(error)}`);
      });
    }
    browserConfigs.current = desired;
  }, [api, browserSourceSignature, setActionError]);

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
    const endedSource = allSourcesRef.current.find((item) => item.id === sourceId);
    stopRuntime(sourceId);
    setActionError(`${endedSource?.kind === 'desktop-audio' ? 'Desktop' : 'Application'} audio capture ended: ${frame.error}`);
  }), [allSourcesRef, api, setActionError, stopRuntime]);

  useEffect(() => {
    const enabledBrowserSources = JSON.parse(browserAudioSignature) as Array<{ id: string; enabled: boolean }>;
    const enabledIds = new Set(enabledBrowserSources.filter((source) => source.enabled).map((source) => source.id));
    for (const sourceId of runtimes.current.keys()) {
      const source = allSourcesRef.current.find((item) => item.id === sourceId);
      if (source?.kind === 'browser' && !enabledIds.has(sourceId)) stopRuntime(sourceId);
    }
    for (const { id, enabled } of enabledBrowserSources) {
      if (!enabled || runtimes.current.has(id) || browserAudioInFlight.current.has(id)) continue;
      browserAudioInFlight.current.add(id);
      void (async () => {
        let stream: MediaStream | null = null;
        try {
          const captureId = await api.getBrowserSourceAudioCaptureId(id);
          stream = await navigator.mediaDevices.getUserMedia(browserAudioCaptureConstraints(captureId));
          if (stream.getAudioTracks().length === 0) throw new Error('The browser source did not provide an audio track.');
          const source = allSourcesRef.current.find((item) => item.id === id && item.kind === 'browser' && item.browserAudioEnabled);
          if (!source) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          const activeProject = projectRef.current;
          const liveSceneForAudio = activeProject?.scenes.find((scene) => scene.id === activeProject.liveSceneId);
          const programActive = liveSceneForAudio?.sources.some((item) => item.id === id && item.visible) ?? false;
          await attachRuntime(source, stream, programActive);
          stream = null;
        } catch (error) {
          stream?.getTracks().forEach((track) => track.stop());
          if (allSourcesRef.current.some((item) => item.id === id && item.kind === 'browser' && item.browserAudioEnabled)) {
            setActionError(`Browser source audio could not be captured: ${friendlyError(error)}`);
          }
        } finally {
          browserAudioInFlight.current.delete(id);
        }
      })();
    }
  }, [allSourcesRef, api, attachRuntime, browserAudioSignature, projectRef, runtimeRevision, setActionError, stopRuntime]);

  useEffect(() => {
    const programSourceIds = liveScene ? getVisibleSourceIdsForScenes(project?.scenes ?? [], [liveScene.id]) : new Set<string>();
    for (const source of allSources) {
      mixer.current?.setSettings(source.id, { volume: source.volume, muted: source.muted });
      mixer.current?.setBalance(source.id, source.balance ?? 0);
      mixer.current?.setProgramActive(source.id, programSourceIds.has(source.id));
      mixer.current?.setAudioMonitoring(source.id, source.audioMonitoring ?? 'off');
      mixer.current?.setAudioTracks(source.id, source.audioTracks ?? [1]);
      mixer.current?.setAudioFilters(source.id, source.audioFilters);
    }
  }, [allSources, liveScene, project?.scenes]);

  const inputRestoreSignature = JSON.stringify(allSources
    .filter((source) => activeSourceIds.has(source.id) && (source.kind === 'camera' || source.kind === 'microphone'))
    .map((source) => ({ id: source.id, kind: source.kind as InputCaptureKind, deviceId: source.deviceId ?? '', name: source.name })));

  useEffect(() => {
    const sources = JSON.parse(inputRestoreSignature) as Array<{ id: string; kind: InputCaptureKind; deviceId: string; name: string }>;
    const activeAttempts = new Set(sources.map((source) => `${source.id}:${source.deviceId || 'default'}`));
    for (const attempt of inputRestoreAttempts.current) if (!activeAttempts.has(attempt)) inputRestoreAttempts.current.delete(attempt);
    for (const candidate of sources) {
      const source = allSources.find((item) => item.id === candidate.id);
      if (!source || runtimes.current.has(source.id)) continue;
      const attemptKey = `${source.id}:${source.deviceId ?? 'default'}`;
      if (inputRestoreAttempts.current.has(attemptKey)) continue;
      inputRestoreAttempts.current.add(attemptKey);
      void navigator.mediaDevices.getUserMedia(inputCaptureConstraints(candidate.kind, candidate.deviceId || undefined, source)).then(async (stream) => {
        if (runtimes.current.has(source.id) || !activeSourceIdsRef.current.has(source.id)) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        await attachRuntime(source, stream);
        const devices = await listInputDevices(candidate.kind);
        setInputDeviceOptions((current) => ({ ...current, [candidate.kind]: devices }));
      }).catch((error) => {
        setActionError(`Could not restore ${source.name}: ${friendlyError(error)}`);
        void listInputDevices(candidate.kind).then((devices) => {
          setInputDeviceOptions((current) => ({ ...current, [candidate.kind]: devices }));
        }).catch(() => undefined);
      });
    }
  }, [activeSourceIdsRef, allSources, attachRuntime, inputRestoreSignature, setActionError]);

  const runtimesSnapshot = useMemo(() => new Map(runtimes.current), [runtimeRevision]);

  const resetForWorkspaceChange = () => {
    for (const stream of runtimes.current.values()) stream.getTracks().forEach((track) => track.stop());
    runtimes.current.clear();
    for (const sourceId of applicationAudioInputs.current.keys()) stopRuntime(sourceId);
    for (const sourceId of mixer.current?.sourceIds() ?? []) mixer.current?.remove(sourceId);
    setRuntimeRevision((value) => value + 1);
    setMeterLevels({});
    setCaptureOptions(null);
    setCaptureKind(null);
  };

  return {
    runtimes, mixer, applicationAudioInputs, applicationAudioSessions, ensureMixer,
    attachRuntime, stopRuntime, connectMediaElement, onMediaPlaybackState, onBrowserElement,
    mediaPlaybackStates, meterLevels, runtimeRevision, runtimesSnapshot,
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

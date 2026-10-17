import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowDownToLine, ArrowUpFromLine, AudioLines, ChevronDown, ChevronUp, Clapperboard, Copy, Eye, EyeOff, ExternalLink, Lock, LockOpen,
  FileAudio, FileVideo, Globe, Grid2X2, Headphones, Image as ImageIcon, Layers2, Mic, Monitor, MoreHorizontal, Move, Pause, Play, Plus, Radio, Settings2,
  Redo2, Square, Type, Undo2, Volume2, VolumeX, Webcam, X,
} from 'lucide-react';
import { CanvasComposition, hitTestSource, RuntimeVideoBank } from './canvas-composition';
import { createSceneTransition, type SceneTransition, type SceneTransitionType } from './scene-transition';
import { AnchoredPopover } from './anchored-popover';
import { ModalDialog } from './modal-dialog';
import { AudioMixerEngine } from './audio-mixer';
import { audioOutputDeviceOptions, type AudioOutputDeviceOption } from './audio-output-devices';
import { canvasPointFromOutputPoint, clampScaledOutputSize, outputRectFromCanvasRect, SCALED_OUTPUT_LIMITS } from './output-scaling';
import { supportsAudioOutputSelection } from './monitor-device-routing';
import { fitPreviewSize } from './preview-layout';
import { getRenderedSourceIds } from './scene-render-scope';
import { canTransformSource, fitSourceToCanvas } from './source-transform';
import { sceneEditorState, SceneHistory, type SceneEditorState } from './scene-history';
import { duplicateSource } from './source-clipboard';
import { currentSlideshowSlideIndex, slideshowImageElementKey } from './slideshow';
import { removeSourceVisibilityHotkeys } from './scene-hotkeys';
import { pauseRecordingChannels, recordingElapsedTime, resumeRecordingChannels, stopRecordingChannels } from './recording-controls';
import { cameraCaptureConstraints } from './camera-capture-settings';
import { retainDesktopAudioTracks } from './desktop-audio-capture';
import { bindDesktopCaptureSource } from './desktop-capture-binding';
import { listenForMediaStreamEnd } from './media-stream-ended';
import {
  CAMERA_FRAME_RATE_OPTIONS,
  CAMERA_RESOLUTION_OPTIONS,
  createDefaultTextStyle,
  createDefaultStreamAudioSettings,
  type AudioApplicationOption,
  type CameraFrameRatePreset,
  type CameraResolutionPreset,
  type DesktopSourceOption,
  type CaptureCursorMode,
  type MediaKind,
  MAX_STREAM_PROFILES,
  MAX_STREAM_SCENE_COLLECTIONS,
  type SceneCollectionSummary,
  type StreamProfileSummary,
  type SourceKind,
  type SourceCrop,
  type SourceFilters,
  type AudioFilters,
  type AudioMonitoring,
  type StreamAudioSettings,
  type AudioTrack,
  AUDIO_TRACKS,
  type ChromaKeyFilter,
  getVideoEncoderRateControlModes,
  normalizeVideoRateControl,
  type StreamOutputSettings,
  type StreamGlobalHotkeys,
  type StreamHotkeyAction,
  type StreamProject,
  type StreamRuntimeStatus,
  type StreamScene,
  type StreamSource,
  type StreamTextStyle,
  type StreamWorkspace,
  type RecordingTrackId,
  VIDEO_ENCODER_OPTIONS,
  VIDEO_RATE_CONTROL_OPTIONS,
  type VideoEncoderFamily,
} from '../shared/desktop-api';

interface ActiveRecording {
  id: string;
  channels: Array<{ track: RecordingTrackId; recorder: MediaRecorder; captureStream: MediaStream }>;
  startedAt: number;
  pausedAt: number | null;
  accumulatedPauseMs: number;
  writeQueue: Promise<void>;
  failure: unknown;
  stoppedChannels: number;
}

interface ActiveStreaming {
  id: string;
  recorder: MediaRecorder;
  captureStream: MediaStream;
  startedAt: number;
  writeQueue: Promise<void>;
  failure: unknown;
}

interface ReplayChunk {
  at: number;
  blob: Blob;
}

interface ReplayChannel {
  track: RecordingTrackId;
  recorder: MediaRecorder;
  captureStream: MediaStream;
  header: Blob | null;
  chunks: ReplayChunk[];
}

interface ActiveReplayBuffer {
  channels: ReplayChannel[];
  startedAt: number;
  stoppedChannels: number;
}

interface BrowserSourceConfig {
  id: string;
  url: string;
  width: number;
  height: number;
}

type InputCaptureKind = 'camera' | 'microphone';

interface InputDeviceOption {
  deviceId: string;
  label: string;
}

function inputCaptureConstraints(kind: InputCaptureKind, deviceId?: string, cameraSettings?: Pick<StreamSource, 'cameraResolution' | 'cameraFrameRate'>): MediaStreamConstraints {
  const selectedDevice = deviceId ? { deviceId: { exact: deviceId } } : {};
  if (kind === 'camera') return cameraCaptureConstraints(deviceId, cameraSettings?.cameraResolution, cameraSettings?.cameraFrameRate);
  return { video: false, audio: { ...selectedDevice, echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
}

function browserAudioCaptureConstraints(captureId: string): MediaStreamConstraints {
  return {
    video: false,
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: captureId, echoCancellation: false } },
  } as unknown as MediaStreamConstraints;
}

async function listInputDevices(kind: InputCaptureKind): Promise<InputDeviceOption[]> {
  const type = kind === 'camera' ? 'videoinput' : 'audioinput';
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === type);
  return devices.map((device, index) => ({ deviceId: device.deviceId, label: device.label || `${kind === 'camera' ? 'Camera' : 'Microphone'} ${index + 1}` }));
}

const DEFAULT_SOURCE_FILTERS: SourceFilters = { brightness: 100, contrast: 100, saturation: 100, opacity: 100, blur: 0 };
const DEFAULT_AUDIO_FILTERS: AudioFilters = {
  gainDb: 0,
  noiseSuppression: false,
  noiseGate: false,
  noiseGateOpenThresholdDb: -26,
  noiseGateCloseThresholdDb: -32,
  noiseGateAttackMs: 10,
  noiseGateHoldMs: 150,
  noiseGateReleaseMs: 250,
  expander: false,
  expanderThresholdDb: -40,
  expanderRatio: 2,
  expanderAttackMs: 10,
  expanderReleaseMs: 150,
  compressor: false,
  compressorThresholdDb: -18,
  compressorRatio: 4,
  limiter: false,
};
const DEFAULT_CHROMA_KEY: ChromaKeyFilter = { enabled: false, keyColor: '#00ff00', similarity: 35, smoothness: 15 };
const DEFAULT_SOURCE_CROP: SourceCrop = { top: 0, right: 0, bottom: 0, left: 0 };

function supportsChromaKey(source: StreamSource): boolean {
  return ['display', 'window', 'camera', 'image', 'slideshow', 'browser'].includes(source.kind)
    || (source.kind === 'media' && source.mediaKind === 'video');
}

function supportsSourceTransform(source: StreamSource): boolean {
  return source.kind !== 'microphone' && source.kind !== 'desktop-audio' && source.kind !== 'application-audio' && !(source.kind === 'media' && source.mediaKind === 'audio');
}

function friendlyError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Capture permission was denied.';
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

function monitoringDeviceError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Audio output permission was denied. Using System Default.';
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'The selected audio output is unavailable. Using System Default.';
  return 'Could not change the monitoring device. Using System Default.';
}

function applyBrowserFrame(image: HTMLImageElement, frame: ArrayBuffer): void {
  const nextUrl = URL.createObjectURL(new Blob([frame], { type: 'image/jpeg' }));
  const previousUrl = image.dataset.browserFrameUrl;
  image.dataset.browserFrameUrl = nextUrl;
  image.src = nextUrl;
  if (previousUrl) URL.revokeObjectURL(previousUrl);
}

function sourceIcon(kind: SourceKind, mediaKind?: MediaKind) {
  if (kind === 'display') return <Monitor size={15} />;
  if (kind === 'window') return <Grid2X2 size={15} />;
  if (kind === 'camera') return <Webcam size={15} />;
  if (kind === 'microphone') return <Mic size={15} />;
  if (kind === 'desktop-audio' || kind === 'application-audio') return <Headphones size={15} />;
  if (kind === 'image') return <ImageIcon size={15} />;
  if (kind === 'slideshow') return <ImageIcon size={15} />;
  if (kind === 'media') return mediaKind === 'audio' ? <FileAudio size={15} /> : <FileVideo size={15} />;
  if (kind === 'browser') return <Globe size={15} />;
  if (kind === 'text') return <Type size={15} />;
  return <Layers2 size={15} />;
}

function defaultTransform(kind: SourceKind, output: StreamProject['output'], mediaKind?: MediaKind) {
  if (kind === 'camera') return { x: Math.round(output.baseWidth * 0.72), y: Math.round(output.baseHeight * 0.68), width: Math.round(output.baseWidth * 0.25), height: Math.round(output.baseHeight * 0.25) };
  if (kind === 'text') return { x: Math.round(output.baseWidth * 0.08), y: Math.round(output.baseHeight * 0.08), width: Math.round(output.baseWidth * 0.84), height: Math.round(output.baseHeight * 0.25) };
  if (kind === 'microphone' || kind === 'desktop-audio' || kind === 'application-audio' || (kind === 'media' && mediaKind === 'audio')) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: 0, y: 0, width: output.baseWidth, height: output.baseHeight };
}

function createSource(kind: SourceKind, output: StreamProject['output'], name?: string, extra: Partial<StreamSource> = {}): StreamSource {
  const labels: Record<SourceKind, string> = {
    display: 'Display Capture', window: 'Window Capture', camera: 'Video Capture Device',
    microphone: 'Audio Input Capture', 'desktop-audio': 'Audio Output Capture', 'application-audio': 'Application Audio Capture', image: 'Image', slideshow: 'Image Slideshow', media: 'Media Source', browser: 'Browser Source', text: 'Text', color: 'Color Source',
  };
  return {
    id: crypto.randomUUID(),
    name: name ?? labels[kind],
    kind,
    visible: true,
    locked: false,
    muted: false,
    volume: 1,
    balance: 0,
    audioMonitoring: 'off',
    audioTracks: [1],
    transform: defaultTransform(kind, output, extra.mediaKind),
    ...(kind === 'text' ? { text: 'Text', color: '#ffffff', textStyle: createDefaultTextStyle() } : {}),
    ...(kind === 'color' ? { color: '#17191f' } : {}),
    ...(kind === 'browser' ? { browserAudioEnabled: false } : {}),
    ...extra,
  };
}

function formatElapsed(startedAt: number | null, now: number): string {
  if (startedAt === null) return '00:00:00';
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${remainder}`;
}

function acceleratorFromKeyEvent(event: ReactKeyboardEvent<HTMLInputElement>): string | null {
  const key = event.key;
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;
  const modifiers = [event.ctrlKey ? 'Control' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.metaKey ? 'Super' : ''].filter(Boolean);
  let acceleratorKey = '';
  if (/^[a-z0-9]$/i.test(key)) acceleratorKey = key.toUpperCase();
  else if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(key)) acceleratorKey = key.toUpperCase();
  else if (key === ' ') acceleratorKey = 'Space';
  else if (key === '+') acceleratorKey = 'Plus';
  else if (key.startsWith('Arrow')) acceleratorKey = key.slice('Arrow'.length);
  else if (key === 'Escape') acceleratorKey = 'Escape';
  else if (key === 'Enter') acceleratorKey = 'Enter';
  else if (key.length === 1) acceleratorKey = key;
  if (!acceleratorKey || modifiers.length === 0) return null;
  return [...modifiers, acceleratorKey].join('+');
}

export function App() {
  const api = window.streamApi;
  const [project, setProject] = useState<StreamProject | null>(null);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [collections, setCollections] = useState<SceneCollectionSummary[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<StreamProfileSummary[]>([]);
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [collectionDialog, setCollectionDialog] = useState<'new' | 'duplicate' | 'rename' | 'delete' | null>(null);
  const [profileDialog, setProfileDialog] = useState<'new' | 'duplicate' | 'rename' | 'delete' | null>(null);
  const [collectionNameDraft, setCollectionNameDraft] = useState('');
  const [profileNameDraft, setProfileNameDraft] = useState('');
  const [collectionError, setCollectionError] = useState('');
  const [profileError, setProfileError] = useState('');
  const [loadingError, setLoadingError] = useState('');
  const [actionError, setActionError] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [sourceActionsMenuOpen, setSourceActionsMenuOpen] = useState(false);
  const [sourceClipboardAvailable, setSourceClipboardAvailable] = useState(false);
  const [sceneMenuOpen, setSceneMenuOpen] = useState(false);
  const [sceneDialog, setSceneDialog] = useState<'rename' | 'delete' | null>(null);
  const [sceneNameDraft, setSceneNameDraft] = useState('');
  const [captureOptions, setCaptureOptions] = useState<DesktopSourceOption[] | null>(null);
  const [captureKind, setCaptureKind] = useState<'screen' | 'window' | 'audio' | null>(null);
  const [captureTargetSourceId, setCaptureTargetSourceId] = useState<string | null>(null);
  const [applicationAudioOptions, setApplicationAudioOptions] = useState<AudioApplicationOption[] | null>(null);
  const [applicationAudioTargetSourceId, setApplicationAudioTargetSourceId] = useState<string | null>(null);
  const [inputDevicePicker, setInputDevicePicker] = useState<InputCaptureKind | null>(null);
  const [inputDeviceOptions, setInputDeviceOptions] = useState<Record<InputCaptureKind, InputDeviceOption[]>>({ camera: [], microphone: [] });
  const [browserDialogOpen, setBrowserDialogOpen] = useState(false);
  const [browserUrl, setBrowserUrl] = useState('');
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true);
  const [captureCursorMode, setCaptureCursorMode] = useState<CaptureCursorMode>('motion');
  const [working, setWorking] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingPausedAt, setRecordingPausedAt] = useState<number | null>(null);
  const [recordingAccumulatedPauseMs, setRecordingAccumulatedPauseMs] = useState(0);
  const [recordingFinalizing, setRecordingFinalizing] = useState(false);
  const [streamingStartedAt, setStreamingStartedAt] = useState<number | null>(null);
  const [replayBufferStartedAt, setReplayBufferStartedAt] = useState<number | null>(null);
  const [replayBufferDurationSeconds, setReplayBufferDurationSeconds] = useState(30);
  const [replayBufferRevision, setReplayBufferRevision] = useState(0);
  const [streamStatus, setStreamStatus] = useState<StreamRuntimeStatus>({ state: 'stopped' });
  const [streamDialogOpen, setStreamDialogOpen] = useState(false);
  const [streamDestination, setStreamDestination] = useState('');
  const [clockNow, setClockNow] = useState(Date.now());
  const [transition, setTransition] = useState<SceneTransition | null>(null);
  const [transitionType, setTransitionType] = useState<SceneTransitionType>('Fade');
  const [transitionColor, setTransitionColor] = useState('#000000');
  const [transitionMs, setTransitionMs] = useState(350);
  const [multiviewMode, setMultiviewMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [audioSettings, setAudioSettings] = useState<StreamAudioSettings>(createDefaultStreamAudioSettings);
  const [audioOutputDevices, setAudioOutputDevices] = useState<AudioOutputDeviceOption[]>([]);
  const [audioSettingsError, setAudioSettingsError] = useState('');
  const [hotkeyDraft, setHotkeyDraft] = useState<StreamGlobalHotkeys | null>(null);
  const [sceneSwitchHotkeyDraft, setSceneSwitchHotkeyDraft] = useState<Record<string, string>>({});
  const [sourceVisibilityHotkeyDraft, setSourceVisibilityHotkeyDraft] = useState<Record<string, string>>({});
  const [hotkeyError, setHotkeyError] = useState('');
  const [hotkeysWorking, setHotkeysWorking] = useState(false);
  const [meterLevels, setMeterLevels] = useState<Record<string, number>>({});
  const [mediaPlaybackStates, setMediaPlaybackStates] = useState<Record<string, { paused: boolean; ended: boolean }>>({});
  const [runtimeRevision, setRuntimeRevision] = useState(0);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [redoAvailable, setRedoAvailable] = useState(false);
  const monitorStageRef = useRef<HTMLDivElement>(null);
  const collectionTriggerRef = useRef<HTMLButtonElement>(null);
  const profileTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsOpenerRef = useRef<HTMLButtonElement | null>(null);
  const sceneMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const sourceMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const sourceActionsTriggerRef = useRef<HTMLButtonElement>(null);
  const programCanvasRef = useRef<HTMLCanvasElement>(null);
  const programProjectorRef = useRef<Window | null>(null);
  const programProjectorStreamRef = useRef<MediaStream | null>(null);
  const programProjectorWatcherRef = useRef<number | null>(null);
  const runtimes = useRef(new Map<string, MediaStream>());
  const applicationAudioInputs = useRef(new Map<string, Awaited<ReturnType<AudioMixerEngine['createApplicationAudioInput']>>>());
  const applicationAudioSessions = useRef(new Map<string, { pid: number; path: string }>());
  const multiviewRuntimeBaseline = useRef<Set<string> | null>(null);
  const videoElements = useRef(new Map<string, HTMLVideoElement>());
  const mediaElements = useRef(new Map<string, HTMLMediaElement>());
  const imageElements = useRef(new Map<string, HTMLImageElement>());
  const mixer = useRef<AudioMixerEngine | null>(null);
  const audioSettingsRef = useRef(audioSettings);
  audioSettingsRef.current = audioSettings;
  const recording = useRef<ActiveRecording | null>(null);
  const streaming = useRef<ActiveStreaming | null>(null);
  const replayBuffer = useRef<ActiveReplayBuffer | null>(null);
  const browserConfigs = useRef(new Map<string, BrowserSourceConfig>());
  const browserAudioInFlight = useRef(new Set<string>());
  const pendingBrowserFrames = useRef(new Map<string, ArrayBuffer>());
  const streamStatusRef = useRef<StreamRuntimeStatus>({ state: 'stopped' });
  const dragging = useRef<{ pointerId: number; sourceId: string; startX: number; startY: number; originX: number; originY: number; originWidth: number; originHeight: number; resizeHandle: string | null } | null>(null);
  const hotkeyDispatch = useRef<((action: StreamHotkeyAction) => void) | null>(null);
  const inputRestoreAttempts = useRef(new Set<string>());
  const sourceClipboardRef = useRef<StreamSource | null>(null);
  const sceneHistoryRef = useRef<SceneHistory | null>(null);
  sceneHistoryRef.current ??= new SceneHistory();

  const refreshAudioOutputDevices = useCallback(async () => {
    try {
      setAudioOutputDevices(audioOutputDeviceOptions(await navigator.mediaDevices.enumerateDevices()));
    } catch {
      setAudioSettingsError('Audio output devices could not be listed.');
    }
  }, []);

  const openSettings = (event: ReactMouseEvent<HTMLButtonElement>) => {
    settingsOpenerRef.current = event.currentTarget;
    setSettingsOpen(true);
    void refreshAudioOutputDevices();
  };
  const closeSettings = () => setSettingsOpen(false);
  const sceneHistorySnapshotRef = useRef<SceneEditorState | null>(null);
  const sceneHistoryResetPendingRef = useRef(false);

  useEffect(() => {
    const monitorStage = monitorStageRef.current;
    if (!monitorStage || !project) return;

    const updatePreviewSize = () => {
      const horizontalPadding = project.studioMode ? 24 : 36;
      const horizontalGap = project.studioMode ? 12 : 0;
      const availableWidth = (monitorStage.clientWidth - horizontalPadding - horizontalGap) / (project.studioMode ? 2 : 1);
      const availableHeight = monitorStage.clientHeight - 24 - 20;
      const nextSize = fitPreviewSize(availableWidth, availableHeight, project.output.width, project.output.height);
      setPreviewSize((current) => current.width === nextSize.width && current.height === nextSize.height ? current : nextSize);
    };

    const observer = new ResizeObserver(updatePreviewSize);
    observer.observe(monitorStage);
    updatePreviewSize();
    return () => observer.disconnect();
  }, [project?.studioMode, project?.output.width, project?.output.height]);

  useEffect(() => () => {
    if (programProjectorWatcherRef.current !== null) window.clearInterval(programProjectorWatcherRef.current);
    for (const track of programProjectorStreamRef.current?.getTracks() ?? []) track.stop();
    if (programProjectorRef.current && !programProjectorRef.current.closed) programProjectorRef.current.close();
  }, []);

  useEffect(() => {
    let active = true;
    void api.loadProject().then((workspace) => {
      if (!active) return;
      setActiveCollectionId(workspace.activeCollectionId);
      setCollections(workspace.collections);
      setActiveProfileId(workspace.activeProfileId);
      setProfiles(workspace.profiles);
      setProject(workspace.project);
    }).catch((error) => {
      if (active) setLoadingError(friendlyError(error));
    });
    return () => { active = false; };
  }, [api]);

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

  useEffect(() => api.onStreamStatus((status) => {
    streamStatusRef.current = status;
    setStreamStatus(status);
    if (status.state === 'error') {
      if (status.message) setActionError(status.message);
      const active = streaming.current;
      if (active?.recorder.state === 'recording') active.recorder.stop();
    }
  }), [api]);

  useEffect(() => api.onGlobalHotkey((action) => hotkeyDispatch.current?.(action)), [api]);

  useEffect(() => {
    if (!project) return;
    setHotkeyDraft({ ...project.hotkeys });
    setSceneSwitchHotkeyDraft({ ...project.sceneSwitchHotkeys });
    setSourceVisibilityHotkeyDraft({ ...project.sourceVisibilityHotkeys });
    void api.setGlobalHotkeys(project.hotkeys, project.sceneSwitchHotkeys, project.sourceVisibilityHotkeys).catch((error) => setActionError(`Global shortcuts could not be registered: ${friendlyError(error)}`));
  }, [api, project?.hotkeys, project?.sceneSwitchHotkeys, project?.sourceVisibilityHotkeys]);

  useEffect(() => api.onBrowserSourceFrame((sourceId, frame) => {
    const image = imageElements.current.get(sourceId);
    if (image) applyBrowserFrame(image, frame);
    else pendingBrowserFrames.current.set(sourceId, frame);
  }), [api]);

  useEffect(() => {
    if (!project || !activeCollectionId || !activeProfileId) return;
    const timer = window.setTimeout(() => {
      void api.saveProject(activeCollectionId, activeProfileId, project).catch((error) => setActionError(`Could not save project settings: ${friendlyError(error)}`));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [api, activeCollectionId, activeProfileId, project]);

  useEffect(() => {
    if (!project) return;
    const snapshot = sceneEditorState(project);
    const previous = sceneHistorySnapshotRef.current;
    sceneHistorySnapshotRef.current = snapshot;
    if (sceneHistoryResetPendingRef.current) sceneHistoryResetPendingRef.current = false;
    else if (previous && (previous.scenes !== snapshot.scenes || previous.activeSceneId !== snapshot.activeSceneId || previous.liveSceneId !== snapshot.liveSceneId || previous.sceneSwitchHotkeys !== snapshot.sceneSwitchHotkeys || previous.sourceVisibilityHotkeys !== snapshot.sourceVisibilityHotkeys)) {
      sceneHistoryRef.current?.record(previous, performance.now());
    }
    setUndoAvailable(sceneHistoryRef.current?.canUndo ?? false);
    setRedoAvailable(sceneHistoryRef.current?.canRedo ?? false);
  }, [project?.scenes, project?.activeSceneId, project?.liveSceneId, project?.sceneSwitchHotkeys, project?.sourceVisibilityHotkeys]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

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
    if (recording.current) stopRecordingChannels(recording.current.channels);
    if (streaming.current?.recorder.state === 'recording') streaming.current.recorder.stop();
    else if (streaming.current) void api.stopStreaming(streaming.current.id).catch(() => undefined);
    replayBuffer.current?.channels.forEach(({ recorder }) => { if (recorder.state === 'recording') recorder.stop(); });
    void mixer.current?.close();
  }, []);

  const allSources = useMemo(() => project?.scenes.flatMap((scene) => scene.sources) ?? [], [project]);
  const allSourcesRef = useRef<StreamSource[]>([]);
  allSourcesRef.current = allSources;
  const projectRef = useRef<StreamProject | null>(null);
  projectRef.current = project;
  const browserSourceSignature = JSON.stringify([...new Map(allSources.filter((source) => source.kind === 'browser' && source.url)
    .map((source) => [source.id, { id: source.id, url: source.url!, width: project?.output.baseWidth ?? 1920, height: project?.output.baseHeight ?? 1080 }] as const)).values()]);
  const browserAudioSignature = JSON.stringify(allSources.filter((source) => source.kind === 'browser')
    .map((source) => ({ id: source.id, enabled: source.browserAudioEnabled === true, url: source.url ?? '' })));
  const runtimesSnapshot = useMemo(() => new Map(runtimes.current), [runtimeRevision]);
  const activeScene = project?.scenes.find((scene) => scene.id === project.activeSceneId) ?? null;
  const liveScene = project?.scenes.find((scene) => scene.id === project.liveSceneId) ?? null;
  const activeCollection = collections.find((collection) => collection.id === activeCollectionId) ?? null;
  const selectedSource = activeScene?.sources.find((source) => source.id === selectedSourceId) ?? null;
  const activeSourceIds = useMemo(
    () => getRenderedSourceIds(project?.scenes ?? [], project?.activeSceneId ?? null, project?.liveSceneId ?? null, multiviewMode),
    [project?.scenes, project?.activeSceneId, project?.liveSceneId, multiviewMode],
  );
  const activeSourceIdsRef = useRef(activeSourceIds);
  activeSourceIdsRef.current = activeSourceIds;
  const inputRestoreSignature = JSON.stringify(allSources
    .filter((source) => activeSourceIds.has(source.id) && (source.kind === 'camera' || source.kind === 'microphone'))
    .map((source) => ({ id: source.id, kind: source.kind as InputCaptureKind, deviceId: source.deviceId ?? '', name: source.name })));

  useEffect(() => {
    const programSourceIds = new Set((liveScene?.sources ?? []).filter((source) => source.visible).map((source) => source.id));
    for (const source of allSources) {
      mixer.current?.setSettings(source.id, { volume: source.volume, muted: source.muted });
      mixer.current?.setBalance(source.id, source.balance ?? 0);
      mixer.current?.setProgramActive(source.id, programSourceIds.has(source.id));
      mixer.current?.setAudioMonitoring(source.id, source.audioMonitoring ?? 'off');
      mixer.current?.setAudioTracks(source.id, source.audioTracks ?? [1]);
      mixer.current?.setAudioFilters(source.id, source.audioFilters);
    }
  }, [allSources, liveScene]);

  const setProjectValue = useCallback((update: (current: StreamProject) => StreamProject) => {
    setProject((current) => current ? update(current) : current);
  }, []);

  const resetSceneHistory = () => {
    sceneHistoryRef.current?.clear();
    sceneHistorySnapshotRef.current = null;
    sceneHistoryResetPendingRef.current = true;
    setUndoAvailable(false);
    setRedoAvailable(false);
  };

  const undoSceneEdit = () => {
    if (!project) return;
    const previous = sceneHistoryRef.current?.undo(sceneEditorState(project));
    if (!previous) return;
    sceneHistoryResetPendingRef.current = true;
    setProject((current) => current ? { ...current, ...previous } : current);
    setUndoAvailable(sceneHistoryRef.current?.canUndo ?? false);
    setRedoAvailable(sceneHistoryRef.current?.canRedo ?? false);
  };

  const redoSceneEdit = () => {
    if (!project) return;
    const next = sceneHistoryRef.current?.redo(sceneEditorState(project));
    if (!next) return;
    sceneHistoryResetPendingRef.current = true;
    setProject((current) => current ? { ...current, ...next } : current);
    setUndoAvailable(sceneHistoryRef.current?.canUndo ?? false);
    setRedoAvailable(sceneHistoryRef.current?.canRedo ?? false);
  };

  const clearNoiseSuppressionPreference = useCallback((sourceId: string) => {
    setProjectValue((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => ({
        ...scene,
        sources: scene.sources.map((source) => source.id === sourceId
          ? { ...source, audioFilters: { ...DEFAULT_AUDIO_FILTERS, ...source.audioFilters, noiseSuppression: false } }
          : source),
      })),
    }));
  }, [setProjectValue]);

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
  }, [api, browserSourceSignature]);

  useEffect(() => () => {
    for (const id of browserConfigs.current.keys()) void api.closeBrowserSource(id).catch(() => undefined);
    browserConfigs.current.clear();
    pendingBrowserFrames.current.clear();
  }, [api]);

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
  }, [clearNoiseSuppressionPreference, ensureMixer, liveScene]);

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
  }, [clearNoiseSuppressionPreference, ensureMixer, project]);

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
  }, [allSources, attachRuntime, inputRestoreSignature]);

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

  useEffect(() => api.onApplicationAudioFrame((sourceId, frame) => {
    const input = applicationAudioInputs.current.get(sourceId);
    if (!input) return;
    if (frame instanceof ArrayBuffer) {
      input.node.port.postMessage(frame, [frame]);
      return;
    }
    stopRuntime(sourceId);
    setActionError(`Application audio capture ended: ${frame.error}`);
  }), [api, stopRuntime]);

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
          const liveScene = activeProject?.scenes.find((scene) => scene.id === activeProject.liveSceneId);
          const programActive = liveScene?.sources.some((item) => item.id === id && item.visible) ?? false;
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
  }, [api, attachRuntime, browserAudioSignature, runtimeRevision, stopRuntime]);

  const applyWorkspace = (workspace: StreamWorkspace) => {
    resetSceneHistory();
    if (workspace.activeCollectionId !== activeCollectionId) {
      for (const stream of runtimes.current.values()) stream.getTracks().forEach((track) => track.stop());
      runtimes.current.clear();
      for (const sourceId of applicationAudioInputs.current.keys()) stopRuntime(sourceId);
      for (const sourceId of mixer.current?.sourceIds() ?? []) mixer.current?.remove(sourceId);
      setRuntimeRevision((value) => value + 1);
      setMeterLevels({});
      setSelectedSourceId(null);
      setTransition(null);
      setCaptureOptions(null);
      setCaptureKind(null);
      setBrowserDialogOpen(false);
      setStreamDialogOpen(false);
      setSourceMenuOpen(false);
      setSourceActionsMenuOpen(false);
      setSceneMenuOpen(false);
      sourceClipboardRef.current = null;
      setSourceClipboardAvailable(false);
    }
    setCollections(workspace.collections);
    setActiveCollectionId(workspace.activeCollectionId);
    setProfiles(workspace.profiles);
    setActiveProfileId(workspace.activeProfileId);
    setProject(workspace.project);
  };

  const changeWorkspace = async (operation: () => Promise<StreamWorkspace | null>, onError: (message: string) => void = setCollectionError): Promise<boolean> => {
    if (!project || !activeCollectionId || !activeProfileId) return false;
    if (working || recording.current || streaming.current || replayBuffer.current) {
      const message = 'Stop recording, streaming, and replay buffer before changing profiles or collections.';
      setActionError(message);
      onError(message);
      return false;
    }
    setWorking(true);
    setActionError('');
    try {
      await api.saveProject(activeCollectionId, activeProfileId, project);
      const workspace = await operation();
      if (!workspace) return false;
      applyWorkspace(workspace);
      return true;
    } catch (error) {
      const message = friendlyError(error);
      setActionError(`Workspace could not be changed: ${message}`);
      onError(message);
      return false;
    } finally { setWorking(false); }
  };

  const activateCollection = async (id: string) => {
    setCollectionMenuOpen(false);
    if (id === activeCollectionId) return;
    await changeWorkspace(() => api.activateCollection(id));
  };

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null;
  const monitorDeviceSelectionSupported = typeof AudioContext !== 'undefined'
    && supportsAudioOutputSelection(AudioContext.prototype);

  const activateProfile = async (id: string) => {
    setProfileMenuOpen(false);
    if (id === activeProfileId) return;
    await changeWorkspace(() => api.activateProfile(id), setProfileError);
  };

  const submitCollectionDialog = async () => {
    if (!collectionDialog || !activeCollectionId || working) return;
    if (collectionDialog === 'rename') {
      setWorking(true);
      setActionError('');
      try {
        const next = await api.renameCollection(activeCollectionId, collectionNameDraft);
        setCollections(next);
        setCollectionDialog(null);
        setCollectionMenuOpen(false);
      } catch (error) {
        const message = friendlyError(error);
        setActionError(`Scene collection could not be renamed: ${message}`);
        setCollectionError(message);
      } finally { setWorking(false); }
      return;
    }
    if (collectionDialog === 'delete') {
      const changed = await changeWorkspace(() => api.deleteCollection(activeCollectionId));
      if (changed) setCollectionDialog(null);
      return;
    }
    const name = collectionNameDraft.trim();
    if (!name) return;
    const duplicateCurrent = collectionDialog === 'duplicate';
    const changed = await changeWorkspace(() => api.createCollection(name, duplicateCurrent));
    if (changed) setCollectionDialog(null);
  };

  const submitProfileDialog = async () => {
    if (!profileDialog || !activeProfileId || working) return;
    if (profileDialog === 'rename') {
      setWorking(true);
      setActionError('');
      try {
        const next = await api.renameProfile(activeProfileId, profileNameDraft);
        setProfiles(next);
        setProfileDialog(null);
        setProfileMenuOpen(false);
      } catch (error) {
        const message = friendlyError(error);
        setActionError(`Profile could not be renamed: ${message}`);
        setProfileError(message);
      } finally { setWorking(false); }
      return;
    }
    if (profileDialog === 'delete') {
      const changed = await changeWorkspace(() => api.deleteProfile(activeProfileId), setProfileError);
      if (changed) setProfileDialog(null);
      return;
    }
    const name = profileNameDraft.trim();
    if (!name) return;
    const duplicateCurrent = profileDialog === 'duplicate';
    const changed = await changeWorkspace(() => api.createProfile(name, duplicateCurrent), setProfileError);
    if (changed) setProfileDialog(null);
  };

  const importProfileFromFile = async () => {
    setProfileMenuOpen(false);
    setProfileError('');
    const changed = await changeWorkspace(() => api.importProfile(), setProfileError);
    if (changed) setProfileError('');
  };

  const importCollectionFromFile = async () => {
    setCollectionMenuOpen(false);
    setCollectionError('');
    const changed = await changeWorkspace(() => api.importCollection());
    if (changed) setCollectionError('');
  };

  const exportActiveCollection = async () => {
    if (!project || !activeCollectionId || !activeProfileId || working) return;
    setCollectionMenuOpen(false);
    setWorking(true);
    setActionError('');
    try {
      await api.saveProject(activeCollectionId, activeProfileId, project);
      await api.exportCollection(activeCollectionId);
    } catch (error) {
      setActionError(`Scene collection could not be exported: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const exportActiveProfile = async () => {
    if (!project || !activeCollectionId || !activeProfileId || working) return;
    setProfileMenuOpen(false);
    setWorking(true);
    setActionError('');
    try {
      await api.saveProject(activeCollectionId, activeProfileId, project);
      await api.exportProfile(activeProfileId);
    } catch (error) {
      setActionError(`Profile could not be exported: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const addToActiveScene = useCallback((source: StreamSource) => {
    setProjectValue((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => scene.id === current.activeSceneId ? { ...scene, sources: [...scene.sources, source] } : scene),
    }));
    setSelectedSourceId(source.id);
    setSourceMenuOpen(false);
    setActionError('');
    return source;
  }, [setProjectValue]);

  const openCapturePicker = async (kind: 'screen' | 'window' | 'audio', targetSourceId?: string) => {
    setSourceMenuOpen(false);
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
    setSourceMenuOpen(false);
    setActionError('');
    setWorking(true);
    try {
      setApplicationAudioOptions(await api.listAudioApplications());
      setApplicationAudioTargetSourceId(targetSourceId ?? null);
    } catch (error) {
      setActionError(`Could not list running applications: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

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
      const captureAudio = captureMode === 'audio' || includeSystemAudio;
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
        if (audioTracks.length === 0) throw new Error('Windows did not provide a desktop audio track.');
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
    setSourceMenuOpen(false);
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

  const addCamera = () => void openInputDevicePicker('camera');
  const addMicrophone = () => void openInputDevicePicker('microphone');

  const addText = () => {
    if (!project) return;
    addToActiveScene(createSource('text', project.output));
  };

  const addColor = () => {
    if (!project) return;
    addToActiveScene(createSource('color', project.output));
  };

  const addBrowserSource = () => {
    if (!project) return;
    let url: URL;
    try { url = new URL(browserUrl.trim()); } catch { setActionError('Enter a valid browser source URL.'); return; }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) {
      setActionError('Browser sources support HTTP and HTTPS URLs.');
      return;
    }
    addToActiveScene(createSource('browser', project.output, url.hostname, { url: url.toString() }));
    setBrowserDialogOpen(false);
    setBrowserUrl('');
  };

  const addMedia = async (kind: MediaKind) => {
    if (!project || working) return;
    setWorking(true);
    setSourceMenuOpen(false);
    setActionError('');
    try {
      const asset = await api.importMedia(kind);
      if (!asset) return;
      const sourceKind: SourceKind = asset.kind === 'image' ? 'image' : 'media';
      const source = createSource(sourceKind, project.output, asset.name.slice(0, 120), {
        assetId: asset.id,
        assetExtension: asset.extension,
        mediaKind: asset.kind,
        ...(asset.kind !== 'image' ? {
          loop: false,
          restartPlaybackWhenActive: true,
          showNothingWhenPlaybackEnds: true,
        } : {}),
        ...(asset.kind === 'audio' ? { transform: defaultTransform('media', project.output, 'audio') } : {}),
      });
      addToActiveScene(source);
    } catch (error) {
      setActionError(`Could not import ${kind}: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const toggleMediaPlayback = (sourceId: string) => {
    const element = mediaElements.current.get(sourceId);
    if (!element) return;
    if (element.paused) void element.play().catch((error) => setActionError(`Media could not play: ${friendlyError(error)}`));
    else element.pause();
  };

  const restartMediaPlayback = (sourceId: string) => {
    const element = mediaElements.current.get(sourceId);
    if (!element) return;
    element.currentTime = 0;
    void element.play().catch((error) => setActionError(`Media could not restart: ${friendlyError(error)}`));
  };

  const stopMediaPlayback = (sourceId: string) => {
    const element = mediaElements.current.get(sourceId);
    if (!element) return;
    element.pause();
    element.currentTime = 0;
  };

  const addSlideshow = async () => {
    if (!project || working) return;
    setWorking(true);
    setSourceMenuOpen(false);
    setActionError('');
    try {
      const asset = await api.importMedia('image');
      if (!asset) return;
      addToActiveScene(createSource('slideshow', project.output, 'Image Slideshow', {
        slideshowImages: [{ assetId: asset.id, assetExtension: asset.extension, name: asset.name.slice(0, 120) }],
        slideshowIntervalSeconds: 5,
        slideshowLoop: true,
      }));
    } catch (error) {
      setActionError(`Could not import slideshow image: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const addSlideshowImage = async (sourceId: string) => {
    if (working) return;
    setWorking(true);
    setActionError('');
    try {
      const asset = await api.importMedia('image');
      if (!asset) return;
      updateSource(sourceId, (source) => source.kind === 'slideshow' && (source.slideshowImages?.length ?? 0) < 100
        ? { ...source, slideshowImages: [...(source.slideshowImages ?? []), { assetId: asset.id, assetExtension: asset.extension, name: asset.name.slice(0, 120) }] }
        : source);
    } catch (error) {
      setActionError(`Could not import slideshow image: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const moveSlideshowImage = (sourceId: string, index: number, direction: -1 | 1) => updateSource(sourceId, (source) => {
    if (source.kind !== 'slideshow' || !source.slideshowImages) return source;
    const target = index + direction;
    if (target < 0 || target >= source.slideshowImages.length) return source;
    const slideshowImages = [...source.slideshowImages];
    [slideshowImages[index], slideshowImages[target]] = [slideshowImages[target]!, slideshowImages[index]!];
    return { ...source, slideshowImages };
  });

  const removeSlideshowImage = (sourceId: string, index: number) => updateSource(sourceId, (source) => {
    if (source.kind !== 'slideshow' || !source.slideshowImages || source.slideshowImages.length <= 1) return source;
    return { ...source, slideshowImages: source.slideshowImages.filter((_, itemIndex) => itemIndex !== index) };
  });

  const updateSource = (sourceId: string, update: (source: StreamSource) => StreamSource) => {
    setProjectValue((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => ({ ...scene, sources: scene.sources.map((source) => source.id === sourceId ? update(source) : source) })),
    }));
  };

  const updateTextStyle = (sourceId: string, update: (style: StreamTextStyle) => StreamTextStyle) => updateSource(sourceId, (source) => source.kind === 'text'
    ? { ...source, textStyle: update(source.textStyle ?? createDefaultTextStyle()) }
    : source);

  const toggleSourceLock = (sourceId: string) => {
    updateSource(sourceId, (source) => ({ ...source, locked: !source.locked }));
  };

  const updateSourceTransform = (sourceId: string, key: keyof StreamSource['transform'], rawValue: string) => {
    const entered = Number(rawValue);
    if (!Number.isFinite(entered) || rawValue.trim() === '') return;
    const value = key === 'x' || key === 'y'
      ? Math.max(-32768, Math.min(32768, Math.round(entered)))
      : Math.max(1, Math.min(32768, Math.round(entered)));
    updateSource(sourceId, (source) => ({ ...source, transform: { ...source.transform, [key]: value } }));
  };

  const fitSource = (source: StreamSource) => {
    if (!project) return;
    const video = videoElements.current.get(source.id);
    const slideshowImages = source.kind === 'slideshow' ? source.slideshowImages ?? [] : [];
    const slideshowIndex = source.kind === 'slideshow'
      ? currentSlideshowSlideIndex(source.id, slideshowImages.length, source.slideshowIntervalSeconds ?? 5, source.slideshowLoop ?? true)
      : -1;
    const imageKey = source.kind === 'slideshow'
      ? slideshowImageElementKey(source.id, slideshowImages, slideshowIndex)
      : source.id;
    const image = imageElements.current.get(imageKey);
    const sourceSize = {
      width: video?.videoWidth || image?.naturalWidth || source.transform.width,
      height: video?.videoHeight || image?.naturalHeight || source.transform.height,
    };
    const transform = fitSourceToCanvas(sourceSize, { width: project.output.baseWidth, height: project.output.baseHeight });
    updateSource(source.id, (current) => ({ ...current, transform }));
  };

  const centerSource = (source: StreamSource) => {
    if (!project) return;
    updateSource(source.id, (current) => ({
      ...current,
      transform: {
        ...current.transform,
        x: Math.round((project.output.baseWidth - current.transform.width) / 2),
        y: Math.round((project.output.baseHeight - current.transform.height) / 2),
      },
    }));
  };

  const updateCaptureCursorMode = async (sourceId: string, cursorMode: CaptureCursorMode) => {
    setActionError('');
    const track = runtimes.current.get(sourceId)?.getVideoTracks()[0];
    if (track?.readyState === 'live') {
      try {
        await track.applyConstraints({ cursor: cursorMode } as MediaTrackConstraints);
      } catch (error) {
        setActionError(`Cursor capture could not be changed: ${friendlyError(error)}`);
        return;
      }
    }
    updateSource(sourceId, (source) => ({ ...source, cursorMode }));
  };

  const updateSourceSettings = (sourceId: string, settings: Pick<StreamSource, 'volume' | 'muted'>) => {
    updateSource(sourceId, (source) => ({ ...source, ...settings }));
    const isProgramSource = liveScene?.sources.some((source) => source.id === sourceId && source.visible) ?? false;
    mixer.current?.setSettings(sourceId, settings);
    mixer.current?.setProgramActive(sourceId, isProgramSource);
  };

  const updateSourceMonitoring = (sourceId: string, audioMonitoring: AudioMonitoring) => {
    updateSource(sourceId, (source) => ({ ...source, audioMonitoring }));
    mixer.current?.setAudioMonitoring(sourceId, audioMonitoring);
  };

  const updateSourceAudioTrack = (sourceId: string, track: AudioTrack, enabled: boolean) => {
    const source = allSources.find((item) => item.id === sourceId);
    if (!source) return;
    const tracks = new Set<AudioTrack>(source.audioTracks ?? [1]);
    if (enabled) tracks.add(track); else tracks.delete(track);
    const next: AudioTrack[] = [...tracks].sort((left, right) => left - right);
    updateSource(sourceId, (current) => ({ ...current, audioTracks: next }));
    mixer.current?.setAudioTracks(sourceId, next);
  };

  const updateBrowserAudio = (sourceId: string, enabled: boolean) => {
    setActionError('');
    updateSource(sourceId, (source) => ({ ...source, browserAudioEnabled: enabled }));
  };

  const updateSourceFilters = (sourceId: string, filters: Partial<SourceFilters>) => {
    updateSource(sourceId, (source) => ({ ...source, filters: { ...DEFAULT_SOURCE_FILTERS, ...source.filters, ...filters } }));
  };

  const updateSourceChromaKey = (sourceId: string, chromaKey: Partial<ChromaKeyFilter>) => {
    updateSource(sourceId, (source) => ({ ...source, chromaKey: { ...DEFAULT_CHROMA_KEY, ...source.chromaKey, ...chromaKey } }));
  };

  const updateSourceCrop = (sourceId: string, crop: Partial<SourceCrop>) => {
    updateSource(sourceId, (source) => ({ ...source, crop: { ...DEFAULT_SOURCE_CROP, ...source.crop, ...crop } }));
  };

  const updateSourceAudioFilters = (sourceId: string, filters: Partial<AudioFilters>) => {
    const source = allSources.find((item) => item.id === sourceId);
    const nextFilters = { ...DEFAULT_AUDIO_FILTERS, ...source?.audioFilters, ...filters };
    if ('noiseGateOpenThresholdDb' in filters && nextFilters.noiseGateCloseThresholdDb > nextFilters.noiseGateOpenThresholdDb) {
      nextFilters.noiseGateCloseThresholdDb = nextFilters.noiseGateOpenThresholdDb;
    }
    if ('noiseGateCloseThresholdDb' in filters && nextFilters.noiseGateCloseThresholdDb > nextFilters.noiseGateOpenThresholdDb) {
      nextFilters.noiseGateOpenThresholdDb = nextFilters.noiseGateCloseThresholdDb;
    }
    updateSource(sourceId, (current) => ({ ...current, audioFilters: nextFilters }));
    if (mixer.current?.setAudioFilters(sourceId, nextFilters) === false && (nextFilters.noiseGate || nextFilters.expander)) {
      setActionError('Audio filters are unavailable in this audio runtime.');
    }
    if ('noiseSuppression' in filters && source?.kind === 'microphone') {
      const enabled = nextFilters.noiseSuppression;
      void (async () => {
        const ready = await mixer.current?.setNoiseSuppression(sourceId, enabled);
        if (ready === true || !enabled) return;
        const current = projectRef.current?.scenes.flatMap((scene) => scene.sources).find((item) => item.id === sourceId);
        if (current?.audioFilters?.noiseSuppression !== true) return;
        setActionError('Neural noise suppression could not be started for this microphone.');
        clearNoiseSuppressionPreference(sourceId);
      })();
    }
  };

  const removeSelectedSource = () => {
    if (!selectedSource || !activeScene) return;
    stopRuntime(selectedSource.id);
    setProjectValue((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => scene.id === activeScene.id ? { ...scene, sources: scene.sources.filter((source) => source.id !== selectedSource.id) } : scene),
      sourceVisibilityHotkeys: removeSourceVisibilityHotkeys(current.sourceVisibilityHotkeys, [selectedSource.id]),
    }));
    setSelectedSourceId(null);
  };

  const copySelectedSource = () => {
    if (!selectedSource) return;
    sourceClipboardRef.current = structuredClone(selectedSource);
    setSourceClipboardAvailable(true);
    setSourceActionsMenuOpen(false);
  };

  const pasteSource = async () => {
    if (!activeScene || !project || !sourceClipboardRef.current) return;
    const source = duplicateSource(sourceClipboardRef.current);
    const runtime = runtimes.current.get(sourceClipboardRef.current.id);
    setSourceActionsMenuOpen(false);
    if (runtime && source.kind !== 'browser') {
      try {
        if (source.kind === 'application-audio') {
          const session = applicationAudioSessions.current.get(sourceClipboardRef.current.id);
          if (!session) throw new Error('The application-audio capture is no longer active.');
          await startApplicationAudioRuntime(source, { ...session, name: source.name });
        } else await attachRuntime(source, runtime.clone());
      } catch (error) {
        stopRuntime(source.id);
        setActionError(`Could not duplicate source: ${friendlyError(error)}`);
        return;
      }
    }
    setProjectValue((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => scene.id === current.activeSceneId ? { ...scene, sources: [...scene.sources, source] } : scene),
    }));
    setSelectedSourceId(source.id);
  };

  const stretchSource = (source: StreamSource) => {
    if (!project) return;
    updateSource(source.id, (current) => ({ ...current, transform: { x: 0, y: 0, width: project.output.baseWidth, height: project.output.baseHeight } }));
  };

  const moveSource = (sourceId: string, direction: -1 | 1) => {
    if (!activeScene) return;
    setProjectValue((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => {
        if (scene.id !== activeScene.id) return scene;
        const index = scene.sources.findIndex((source) => source.id === sourceId);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= scene.sources.length) return scene;
        const sources = [...scene.sources];
        [sources[index], sources[nextIndex]] = [sources[nextIndex]!, sources[index]!];
        return { ...scene, sources };
      }),
    }));
  };

  const addScene = () => {
    if (!project) return;
    const scene: StreamScene = { id: crypto.randomUUID(), name: `Scene ${project.scenes.length + 1}`, sources: [] };
    setProjectValue((current) => ({
      ...current,
      activeSceneId: scene.id,
      liveSceneId: current.studioMode ? current.liveSceneId : scene.id,
      scenes: [...current.scenes, scene],
    }));
    setSelectedSourceId(null);
  };

  const renameActiveScene = () => {
    if (!project) return;
    const name = sceneNameDraft.trim().slice(0, 120);
    if (!name) return;
    setProjectValue((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => scene.id === current.activeSceneId ? { ...scene, name } : scene),
    }));
    setSceneDialog(null);
    setSceneMenuOpen(false);
  };

  const duplicateActiveScene = async () => {
    if (!project || working) return;
    const original = project.scenes.find((scene) => scene.id === project.activeSceneId);
    if (!original) return;
    setWorking(true);
    setActionError('');
    const clone = {
      ...original,
      id: crypto.randomUUID(),
      name: (original.name + ' Copy').slice(0, 120),
      sources: original.sources.map((source) => ({ ...source, id: crypto.randomUUID(), transform: { ...source.transform }, crop: source.crop ? { ...source.crop } : undefined, filters: source.filters ? { ...source.filters } : undefined, chromaKey: source.chromaKey ? { ...source.chromaKey } : undefined, audioFilters: source.audioFilters ? { ...source.audioFilters } : undefined, slideshowImages: source.slideshowImages?.map((image) => ({ ...image })), audioTracks: [...(source.audioTracks ?? [1])] })),
    } satisfies StreamScene;
    try {
      for (let index = 0; index < original.sources.length; index += 1) {
        const originalSource = original.sources[index]!;
        const runtime = runtimes.current.get(originalSource.id);
        if (!runtime) continue;
        if (originalSource.kind === 'application-audio') {
          const session = applicationAudioSessions.current.get(originalSource.id);
          if (!session) throw new Error(`The application-audio capture for ${originalSource.name} is no longer active.`);
          await startApplicationAudioRuntime(clone.sources[index]!, { ...session, name: originalSource.name });
        } else await attachRuntime(clone.sources[index]!, runtime.clone());
      }
      setProjectValue((current) => ({
        ...current,
        activeSceneId: clone.id,
        liveSceneId: current.studioMode ? current.liveSceneId : clone.id,
        scenes: [...current.scenes, clone],
      }));
      setSelectedSourceId(null);
      setSceneMenuOpen(false);
    } catch (error) {
      for (const source of clone.sources) stopRuntime(source.id);
      setActionError(`Could not duplicate scene: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const deleteActiveScene = () => {
    if (!project || project.scenes.length <= 1) return;
    const removed = project.scenes.find((scene) => scene.id === project.activeSceneId);
    if (!removed) return;
    for (const source of removed.sources) stopRuntime(source.id);
    setProjectValue((current) => {
      const scenes = current.scenes.filter((scene) => scene.id !== current.activeSceneId);
      const replacement = scenes[0]!;
      return {
        ...current,
        scenes,
        activeSceneId: replacement.id,
        liveSceneId: current.liveSceneId === removed.id ? replacement.id : current.liveSceneId,
        sceneSwitchHotkeys: Object.fromEntries(Object.entries(current.sceneSwitchHotkeys).filter(([sceneId]) => sceneId !== removed.id)),
        sourceVisibilityHotkeys: removeSourceVisibilityHotkeys(current.sourceVisibilityHotkeys, removed.sources.map((source) => source.id)),
      };
    });
    setTransition(null);
    setSelectedSourceId(null);
    setSceneDialog(null);
    setSceneMenuOpen(false);
  };

  const chooseScene = (sceneId: string) => {
    if (!project) return;
    if (project.studioMode) {
      setProjectValue((current) => ({ ...current, activeSceneId: sceneId }));
      setSelectedSourceId(null);
      return;
    }
    if (sceneId === project.liveSceneId) return;
    const nextTransition = createSceneTransition(transitionType, project.liveSceneId, performance.now(), transitionMs, transitionColor);
    setTransition(nextTransition);
    setProjectValue((current) => ({ ...current, activeSceneId: sceneId, liveSceneId: sceneId }));
    setSelectedSourceId(null);
  };

  const takeScene = () => {
    if (!project || project.activeSceneId === project.liveSceneId) return;
    const nextTransition = createSceneTransition(transitionType, project.liveSceneId, performance.now(), transitionMs, transitionColor);
    setTransition(nextTransition);
    setProjectValue((current) => ({ ...current, liveSceneId: current.activeSceneId }));
  };

  const finishTransition = useCallback(() => setTransition(null), []);

  const openProgramProjector = () => {
    const canvas = programCanvasRef.current;
    if (!canvas || !project) {
      setActionError('The program output is not ready.');
      return;
    }
    const projector = window.open('about:blank', 'lumastream-program-projector', 'popup,width=1280,height=720');
    if (!projector) {
      setActionError('The program projector could not be opened.');
      return;
    }

    if (programProjectorWatcherRef.current !== null) window.clearInterval(programProjectorWatcherRef.current);
    programProjectorWatcherRef.current = null;
    for (const track of programProjectorStreamRef.current?.getTracks() ?? []) track.stop();
    programProjectorStreamRef.current = null;
    programProjectorRef.current = null;

    let projectorDocument: Document;
    try {
      projectorDocument = projector.document;
      projectorDocument.title = 'LumaStream Program';
      projectorDocument.documentElement.style.cssText = 'width:100%;height:100%;overflow:hidden;background:#000';
      projectorDocument.body.style.cssText = 'width:100%;height:100%;margin:0;overflow:hidden;background:#000';
      const projectorVideo = projectorDocument.createElement('video');
      projectorVideo.dataset.projectorFeed = 'program';
      projectorVideo.autoplay = true;
      projectorVideo.muted = true;
      projectorVideo.playsInline = true;
      projectorVideo.style.cssText = 'display:block;width:100%;height:100%;background:#000;object-fit:contain';
      projectorVideo.addEventListener('dblclick', () => {
        if (projectorDocument.fullscreenElement) void projectorDocument.exitFullscreen().catch(() => undefined);
        else void projectorDocument.documentElement.requestFullscreen().catch(() => undefined);
      });
      projectorDocument.body.replaceChildren(projectorVideo);
    } catch {
      setActionError('The program projector could not be initialized.');
      projector.close();
      return;
    }

    let output: MediaStream;
    try { output = canvas.captureStream(project.output.frameRate); }
    catch {
      programProjectorStreamRef.current = null;
      programProjectorRef.current = null;
      setActionError('The program output could not be shared with the projector.');
      projector.close();
      return;
    }

    setActionError('');
    projector.focus();
    programProjectorRef.current = projector;
    programProjectorStreamRef.current = output;
    const deadline = Date.now() + 8000;
    const attachOutput = () => {
      if (projector.closed) {
        for (const track of output.getTracks()) track.stop();
        if (programProjectorRef.current === projector) programProjectorRef.current = null;
        if (programProjectorStreamRef.current === output) programProjectorStreamRef.current = null;
        return;
      }
      let attached = false;
      try {
        const video = projector.document.querySelector<HTMLVideoElement>('[data-projector-feed="program"]');
        if (video) {
          video.srcObject = output;
          void video.play().catch(() => undefined);
          attached = true;
        }
      } catch {
        setActionError('The program projector could not connect to the output.');
        for (const track of output.getTracks()) track.stop();
        projector.close();
        return;
      }
      if (attached) return;
      if (Date.now() >= deadline) {
        setActionError('The program projector did not become ready.');
        for (const track of output.getTracks()) track.stop();
        projector.close();
        return;
      }
      window.requestAnimationFrame(attachOutput);
    };
    window.requestAnimationFrame(attachOutput);
    programProjectorWatcherRef.current = window.setInterval(() => {
      if (!projector.closed) return;
      if (programProjectorWatcherRef.current !== null) window.clearInterval(programProjectorWatcherRef.current);
      programProjectorWatcherRef.current = null;
      for (const track of output.getTracks()) track.stop();
      if (programProjectorRef.current === projector) programProjectorRef.current = null;
      if (programProjectorStreamRef.current === output) programProjectorStreamRef.current = null;
    }, 500);
  };

  const toggleStudioMode = () => {
    if (!project) return;
    setMultiviewMode(false);
    setProjectValue((current) => ({ ...current, studioMode: !current.studioMode, activeSceneId: current.studioMode ? current.liveSceneId : current.activeSceneId }));
    setTransition(null);
  };

  const toggleMultiviewMode = () => {
    if (!project) return;
    const next = !multiviewMode;
    activeSourceIdsRef.current = getRenderedSourceIds(project.scenes, project.activeSceneId, project.liveSceneId, next);
    if (next) {
      multiviewRuntimeBaseline.current = new Set(runtimes.current.keys());
    } else {
      const baseline = multiviewRuntimeBaseline.current;
      const stillRendered = getRenderedSourceIds(project.scenes, project.activeSceneId, project.liveSceneId, false);
      for (const sourceId of runtimes.current.keys()) {
        const source = allSourcesRef.current.find((item) => item.id === sourceId);
        if (baseline?.has(sourceId) || stillRendered.has(sourceId) || (source?.kind !== 'camera' && source?.kind !== 'microphone' && source?.kind !== 'desktop-audio' && source?.kind !== 'application-audio')) continue;
        stopRuntime(sourceId);
      }
      multiviewRuntimeBaseline.current = null;
    }
    setMultiviewMode(next);
    if (next && !project.studioMode) setProjectValue((current) => ({ ...current, studioMode: true }));
    setTransition(null);
  };

  const startRecording = async () => {
    if (!project || recording.current || working) return;
    const canvas = programCanvasRef.current;
    if (!canvas) { setActionError('Program output is not ready.'); return; }
    setWorking(true);
    setActionError('');
    let file: { id: string; name: string } | null = null;
    const captureStreams: MediaStream[] = [];
    let activeSession: ActiveRecording | null = null;
    let startedChannels = 0;
    try {
      file = await api.openRecording({
        container: project.output.recordingContainer,
        frameRate: project.output.frameRate,
        videoBitrateKbps: project.output.recordingVideoBitrateKbps,
        audioBitrateKbps: project.output.recordingAudioBitrateKbps,
        audioTracks: project.output.recordingAudioTracks,
        rateControl: project.output.recordingRateControl,
        encoder: project.output.recordingVideoEncoder,
        encoderQuality: project.output.recordingEncoderQuality,
        hardwareEncoding: project.output.recordingHardwareEncoding,
        keyframeIntervalSeconds: project.output.recordingKeyframeIntervalSeconds,
      });
      if (!file) return;
      const audioMixer = ensureMixer();
      await audioMixer.resume();
      const videoMimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!videoMimeType) throw new Error('This system does not provide a supported WebM video encoder.');
      const audioMimeType = ['audio/webm;codecs=opus', 'audio/webm'].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (project.output.recordingAudioTracks.length > 0 && !audioMimeType) throw new Error('This system does not provide a supported WebM audio encoder.');
      const videoCapture = canvas.captureStream(project.output.frameRate);
      captureStreams.push(videoCapture);
      const channels: ActiveRecording['channels'] = [{
        track: 0,
        recorder: new MediaRecorder(new MediaStream(videoCapture.getVideoTracks()), { mimeType: videoMimeType, videoBitsPerSecond: project.output.recordingVideoBitrateKbps * 1000 }),
        captureStream: videoCapture,
      }];
      for (const track of project.output.recordingAudioTracks) {
        const capture = new MediaStream(audioMixer.destinationFor(track).stream.getAudioTracks().map((audioTrack) => audioTrack.clone()));
        captureStreams.push(capture);
        channels.push({
          track,
          recorder: new MediaRecorder(capture, { mimeType: audioMimeType!, audioBitsPerSecond: project.output.recordingAudioBitrateKbps * 1000 }),
          captureStream: capture,
        });
      }
      const active: ActiveRecording = { id: file.id, channels, startedAt: Date.now(), pausedAt: null, accumulatedPauseMs: 0, writeQueue: Promise.resolve(), failure: null, stoppedChannels: 0 };
      activeSession = active;
      recording.current = active;
      const stopAll = () => stopRecordingChannels(channels);
      const finish = () => {
        active.stoppedChannels += 1;
        if (active.stoppedChannels !== channels.length) return;
        setRecordingFinalizing(true);
        void (async () => {
          try {
            await active.writeQueue;
            if (active.failure) throw active.failure;
            const name = await api.closeRecording(active.id);
            setActionError(`Saved ${name}`);
          } catch (error) {
            try {
              const name = await api.closeRecording(active.id);
              setActionError(`Saved partial recording ${name}. ${friendlyError(active.failure ?? error)}`);
            } catch (closeError) {
              setActionError(`Recording could not be completed: ${friendlyError(active.failure ?? closeError)}`);
            }
          } finally {
            active.channels.forEach((channel) => channel.captureStream.getTracks().forEach((track) => track.stop()));
            if (recording.current === active) recording.current = null;
            setRecordingStartedAt(null);
            setRecordingPausedAt(null);
            setRecordingAccumulatedPauseMs(0);
            setRecordingFinalizing(false);
          }
        })();
      };
      for (const channel of channels) {
        channel.recorder.addEventListener('dataavailable', (event) => {
          if (event.data.size === 0) return;
          active.writeQueue = active.writeQueue.then(async () => {
            await api.writeRecordingChunk(active.id, channel.track, await event.data.arrayBuffer());
          }).catch((error) => {
            active.failure = error;
            setActionError(`Recording write failed: ${friendlyError(error)}`);
            stopAll();
          });
        });
        channel.recorder.addEventListener('error', () => {
          active.failure ??= new Error('A recording media encoder failed.');
          stopAll();
        });
        channel.recorder.addEventListener('stop', finish, { once: true });
      }
      for (const { recorder } of channels) {
        recorder.start(1000);
        startedChannels += 1;
      }
      setRecordingStartedAt(active.startedAt);
      setRecordingPausedAt(null);
      setRecordingAccumulatedPauseMs(0);
    } catch (error) {
      if (activeSession && startedChannels > 0) {
        activeSession.failure = error;
        activeSession.stoppedChannels += activeSession.channels.length - startedChannels;
        activeSession.channels.slice(0, startedChannels).forEach(({ recorder }) => { if (recorder.state === 'recording') recorder.stop(); });
        setRecordingStartedAt(activeSession.startedAt);
        setRecordingPausedAt(null);
        setRecordingAccumulatedPauseMs(0);
        setActionError(`Could not start every recording track: ${friendlyError(error)}`);
        return;
      }
      if (activeSession && recording.current === activeSession) recording.current = null;
      captureStreams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
      if (file) await api.abortRecording(file.id).catch(() => undefined);
      setActionError(`Could not start recording: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const stopRecording = () => {
    const active = recording.current;
    if (active) stopRecordingChannels(active.channels);
  };

  const remuxRecording = async () => {
    if (working) return;
    setActionError('');
    setWorking(true);
    try {
      const name = await api.remuxRecording();
      if (name) setActionError(`Saved remuxed recording: ${name}`);
    } catch (error) {
      setActionError(`Recording could not be remuxed: ${friendlyError(error)}`);
    } finally {
      setWorking(false);
    }
  };

  const pauseRecording = () => {
    const active = recording.current;
    if (!active) return;
    if (!pauseRecordingChannels(active.channels)) {
      setActionError('Recording tracks could not be paused together.');
      return;
    }
    active.pausedAt = Date.now();
    setRecordingPausedAt(active.pausedAt);
  };

  const resumeRecording = () => {
    const active = recording.current;
    if (!active || active.pausedAt === null) return;
    if (!resumeRecordingChannels(active.channels)) {
      setActionError('Recording tracks could not be resumed together.');
      return;
    }
    active.accumulatedPauseMs += Math.max(0, Date.now() - active.pausedAt);
    active.pausedAt = null;
    setRecordingAccumulatedPauseMs(active.accumulatedPauseMs);
    setRecordingPausedAt(null);
  };

  const startStreaming = async () => {
    if (!project || streaming.current || working) return;
    const canvas = programCanvasRef.current;
    if (!canvas) { setActionError('Program output is not ready.'); return; }
    setWorking(true);
    setActionError('');
    setStreamStatus({ state: 'connecting' });
    streamStatusRef.current = { state: 'connecting' };
    let streamId: string | null = null;
    let captureStream: MediaStream | null = null;
    try {
      const audioMixer = ensureMixer();
      await audioMixer.resume();
      const videoStream = canvas.captureStream(project.output.frameRate);
      captureStream = new MediaStream([...videoStream.getVideoTracks(), ...audioMixer.destinationFor(project.output.streamAudioTrack).stream.getAudioTracks().map((track) => track.clone())]);
      const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!mimeType) throw new Error('This system does not provide a supported WebM streaming encoder.');
      const settings: StreamOutputSettings = {
        width: project.output.width,
        height: project.output.height,
        frameRate: project.output.frameRate,
        videoBitrateKbps: project.output.streamVideoBitrateKbps,
        audioBitrateKbps: project.output.streamAudioBitrateKbps,
        rateControl: project.output.streamRateControl,
        encoder: project.output.streamVideoEncoder,
        encoderQuality: project.output.streamEncoderQuality,
        hardwareEncoding: project.output.streamHardwareEncoding,
        keyframeIntervalSeconds: project.output.streamKeyframeIntervalSeconds,
      };
      streamId = await api.startStreaming(streamDestination.trim(), settings);
      const recorder = new MediaRecorder(captureStream, { mimeType, videoBitsPerSecond: project.output.streamVideoBitrateKbps * 1000, audioBitsPerSecond: project.output.streamAudioBitrateKbps * 1000 });
      const active: ActiveStreaming = { id: streamId, recorder, captureStream, startedAt: Date.now(), writeQueue: Promise.resolve(), failure: null };
      streaming.current = active;
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size === 0) return;
        active.writeQueue = active.writeQueue.then(async () => {
          await api.writeStreamingChunk(active.id, await event.data.arrayBuffer());
        }).catch((error) => {
          active.failure = error;
          setActionError(`Stream output failed: ${friendlyError(error)}`);
          if (recorder.state === 'recording') recorder.stop();
        });
      });
      recorder.addEventListener('stop', () => {
        void (async () => {
          try {
            await active.writeQueue;
            await api.stopStreaming(active.id);
          } catch (error) {
            setActionError(`Stream could not stop cleanly: ${friendlyError(active.failure ?? error)}`);
          } finally {
            active.captureStream.getTracks().forEach((track) => track.stop());
            if (streaming.current === active) streaming.current = null;
            setStreamingStartedAt(null);
          }
        })();
      }, { once: true });
      recorder.start(1000);
      setStreamingStartedAt(active.startedAt);
      setStreamDialogOpen(false);
      if (streamStatusRef.current.state === 'error') recorder.stop();
    } catch (error) {
      captureStream?.getTracks().forEach((track) => track.stop());
      if (streamId) await api.stopStreaming(streamId).catch(() => undefined);
      setStreamStatus({ state: 'error', message: friendlyError(error) });
      streamStatusRef.current = { state: 'error', message: friendlyError(error) };
      setActionError(`Could not start streaming: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const stopStreaming = () => {
    const active = streaming.current;
    if (active?.recorder.state === 'recording') active.recorder.stop();
  };

  const startReplayBuffer = async () => {
    if (!project || replayBuffer.current || working) return;
    const canvas = programCanvasRef.current;
    if (!canvas) { setActionError('Program output is not ready.'); return; }
    setWorking(true);
    setActionError('');
    const captureStreams: MediaStream[] = [];
    let activeSession: ActiveReplayBuffer | null = null;
    let startedChannels = 0;
    try {
      const audioMixer = ensureMixer();
      await audioMixer.resume();
      const videoStream = canvas.captureStream(project.output.frameRate);
      captureStreams.push(videoStream);
      const videoMimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!videoMimeType) throw new Error('This system does not provide a supported WebM replay video encoder.');
      const audioMimeType = ['audio/webm;codecs=opus', 'audio/webm'].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (project.output.recordingAudioTracks.length > 0 && !audioMimeType) throw new Error('This system does not provide a supported WebM replay audio encoder.');
      const channels: ReplayChannel[] = [{
        track: 0,
        recorder: new MediaRecorder(new MediaStream(videoStream.getVideoTracks()), { mimeType: videoMimeType, videoBitsPerSecond: 8_000_000 }),
        captureStream: videoStream,
        header: null,
        chunks: [],
      }];
      for (const track of project.output.recordingAudioTracks) {
        const capture = new MediaStream(audioMixer.destinationFor(track).stream.getAudioTracks().map((audioTrack) => audioTrack.clone()));
        captureStreams.push(capture);
        channels.push({
          track,
          recorder: new MediaRecorder(capture, { mimeType: audioMimeType!, audioBitsPerSecond: project.output.recordingAudioBitrateKbps * 1000 }),
          captureStream: capture,
          header: null,
          chunks: [],
        });
      }
      const active: ActiveReplayBuffer = { channels, startedAt: Date.now(), stoppedChannels: 0 };
      activeSession = active;
      replayBuffer.current = active;
      const stopAll = () => channels.forEach(({ recorder }) => { if (recorder.state === 'recording') recorder.stop(); });
      for (const channel of channels) {
        channel.recorder.addEventListener('dataavailable', (event) => {
          if (event.data.size === 0) return;
          channel.header ??= event.data;
          channel.chunks.push({ at: Date.now(), blob: event.data });
          const cutoff = Date.now() - replayBufferDurationSeconds * 1000;
          while (channel.chunks.length > 1 && channel.chunks[1]!.at < cutoff) channel.chunks.splice(1, 1);
          setReplayBufferRevision((value) => value + 1);
        });
        channel.recorder.addEventListener('error', () => {
          setActionError('Replay buffer stopped because a media encoder failed.');
          stopAll();
        });
        channel.recorder.addEventListener('stop', () => {
          active.stoppedChannels += 1;
          if (active.stoppedChannels !== channels.length) return;
          active.channels.forEach((item) => item.captureStream.getTracks().forEach((track) => track.stop()));
          if (replayBuffer.current === active) replayBuffer.current = null;
          setReplayBufferStartedAt(null);
          setReplayBufferRevision((value) => value + 1);
        }, { once: true });
      }
      for (const { recorder } of channels) {
        recorder.start(1000);
        startedChannels += 1;
      }
      setReplayBufferStartedAt(active.startedAt);
    } catch (error) {
      if (activeSession && startedChannels > 0) {
        activeSession.stoppedChannels += activeSession.channels.length - startedChannels;
        activeSession.channels.slice(0, startedChannels).forEach(({ recorder }) => { if (recorder.state === 'recording') recorder.stop(); });
        setReplayBufferStartedAt(activeSession.startedAt);
        setActionError(`Could not start every replay track: ${friendlyError(error)}`);
        return;
      }
      if (activeSession && replayBuffer.current === activeSession) replayBuffer.current = null;
      captureStreams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
      setActionError(`Could not start replay buffer: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const stopReplayBuffer = () => {
    const active = replayBuffer.current;
    active?.channels.forEach(({ recorder }) => { if (recorder.state === 'recording') recorder.stop(); });
  };

  const saveReplay = async () => {
    const active = replayBuffer.current;
    const videoChannel = active?.channels.find((channel) => channel.track === 0);
    if (!project || !active || !videoChannel?.header || videoChannel.chunks.length === 0 || working) return;
    setWorking(true);
    setActionError('');
    let file: { id: string; name: string } | null = null;
    try {
      const channelsToSave = active.channels.filter((channel) => channel.track === 0 || (channel.header !== null && channel.chunks.length > 0));
      file = await api.openRecording({
        container: project.output.recordingContainer,
        frameRate: project.output.frameRate,
        videoBitrateKbps: project.output.recordingVideoBitrateKbps,
        audioBitrateKbps: project.output.recordingAudioBitrateKbps,
        audioTracks: channelsToSave.filter((channel) => channel.track !== 0).map((channel) => channel.track as AudioTrack),
        rateControl: project.output.recordingRateControl,
        encoder: project.output.recordingVideoEncoder,
        encoderQuality: project.output.recordingEncoderQuality,
        hardwareEncoding: project.output.recordingHardwareEncoding,
        keyframeIntervalSeconds: project.output.recordingKeyframeIntervalSeconds,
      });
      if (!file) return;
      const cutoff = Date.now() - replayBufferDurationSeconds * 1000;
      for (const channel of channelsToSave) {
        const payloads = [channel.header!, ...channel.chunks.filter((chunk) => chunk.at >= cutoff && chunk.blob !== channel.header).map((chunk) => chunk.blob)];
        for (const payload of payloads) await api.writeRecordingChunk(file.id, channel.track, await payload.arrayBuffer());
      }
      const name = await api.closeRecording(file.id);
      file = null;
      setActionError(`Saved replay ${name}`);
    } catch (error) {
      if (file) await api.closeRecording(file.id).catch(() => undefined);
      setActionError(`Replay could not be saved: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  hotkeyDispatch.current = (action) => {
    if (action.startsWith('toggleSourceVisibility:')) {
      const sourceId = action.slice('toggleSourceVisibility:'.length);
      updateSource(sourceId, (source) => ({ ...source, visible: !source.visible }));
    } else if (action.startsWith('switchScene:')) {
      chooseScene(action.slice('switchScene:'.length));
    } else if (action === 'toggleStreaming') {
      if (streaming.current) stopStreaming();
      else setStreamDialogOpen(true);
    } else if (action === 'toggleRecording') {
      if (recording.current) stopRecording(); else void startRecording();
    } else if (action === 'toggleReplayBuffer') {
      if (replayBuffer.current) stopReplayBuffer(); else void startReplayBuffer();
    } else if (replayBuffer.current) {
      void saveReplay();
    } else {
      setActionError('Start the replay buffer before saving a replay.');
    }
  };

  const applyHotkeys = async () => {
    if (!project || !hotkeyDraft || hotkeysWorking) return;
    setHotkeysWorking(true);
    setHotkeyError('');
    try {
      await api.setGlobalHotkeys(hotkeyDraft, sceneSwitchHotkeyDraft, sourceVisibilityHotkeyDraft);
      setProjectValue((current) => ({ ...current, hotkeys: hotkeyDraft, sceneSwitchHotkeys: sceneSwitchHotkeyDraft, sourceVisibilityHotkeys: sourceVisibilityHotkeyDraft }));
    } catch (error) {
      setHotkeyError(friendlyError(error));
    } finally { setHotkeysWorking(false); }
  };

  const captureHotkey = (action: StreamHotkeyAction, event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || !hotkeyDraft) return;
    const accelerator = acceleratorFromKeyEvent(event);
    if (!accelerator) {
      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) setHotkeyError('Use a modifier key and one shortcut key.');
      return;
    }
    setHotkeyError('');
    setHotkeyDraft((current) => current ? { ...current, [action]: accelerator } : current);
  };

  const captureSceneSwitchHotkey = (sceneId: string, event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (event.key === 'Escape') {
      setHotkeyError('');
      setSceneSwitchHotkeyDraft((current) => ({ ...current, [sceneId]: '' }));
      return;
    }
    const accelerator = acceleratorFromKeyEvent(event);
    if (!accelerator) {
      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) setHotkeyError('Use a modifier key and one shortcut key.');
      return;
    }
    setHotkeyError('');
    setSceneSwitchHotkeyDraft((current) => ({ ...current, [sceneId]: accelerator }));
  };

  const captureSourceVisibilityHotkey = (sourceId: string, event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (event.key === 'Escape') {
      setHotkeyError('');
      setSourceVisibilityHotkeyDraft((current) => ({ ...current, [sourceId]: '' }));
      return;
    }
    const accelerator = acceleratorFromKeyEvent(event);
    if (!accelerator) {
      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) setHotkeyError('Use a modifier key and one shortcut key.');
      return;
    }
    setHotkeyError('');
    setSourceVisibilityHotkeyDraft((current) => ({ ...current, [sourceId]: accelerator }));
  };

  const handleStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>, scene: StreamScene) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const output = { width: project?.output.width ?? 1920, height: project?.output.height ?? 1080 };
    const canvas = { width: project?.output.baseWidth ?? 1920, height: project?.output.baseHeight ?? 1080 };
    const point = canvasPointFromOutputPoint({
      x: ((event.clientX - rect.left) / rect.width) * output.width,
      y: ((event.clientY - rect.top) / rect.height) * output.height,
    }, canvas, output);
    const { x, y } = point;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const resizeHandle = target?.closest('[data-resize-handle]')?.getAttribute('data-resize-handle') ?? null;
    const selected = resizeHandle && selectedSourceId ? scene.sources.find((source) => source.id === selectedSourceId) : null;
    const withinCanvas = x >= 0 && y >= 0 && x <= canvas.width && y <= canvas.height;
    const source = selected ?? (withinCanvas ? hitTestSource(scene, x, y) : null);
    setSelectedSourceId(source?.id ?? null);
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
    if (!source || !canTransformSource(source.locked)) {
      dragging.current = null;
      return;
    }
    dragging.current = {
      pointerId: event.pointerId, sourceId: source.id, startX: x, startY: y,
      originX: source.transform.x, originY: source.transform.y,
      originWidth: source.transform.width, originHeight: source.transform.height,
      resizeHandle: source.id === selectedSourceId ? resizeHandle : null,
    };
  };

  const handleStagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const activeDrag = dragging.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const output = { width: project?.output.width ?? 1920, height: project?.output.height ?? 1080 };
    const canvas = { width: project?.output.baseWidth ?? 1920, height: project?.output.baseHeight ?? 1080 };
    const { x, y } = canvasPointFromOutputPoint({
      x: ((event.clientX - rect.left) / rect.width) * output.width,
      y: ((event.clientY - rect.top) / rect.height) * output.height,
    }, canvas, output);
    const dx = x - activeDrag.startX;
    const dy = y - activeDrag.startY;
    if (!activeDrag.resizeHandle) {
      updateSource(activeDrag.sourceId, (source) => ({
        ...source,
        transform: { ...source.transform, x: Math.round(activeDrag.originX + dx), y: Math.round(activeDrag.originY + dy) },
      }));
      return;
    }
    const handle = activeDrag.resizeHandle;
    let width = activeDrag.originWidth + (handle.includes('e') ? dx : handle.includes('w') ? -dx : 0);
    let height = activeDrag.originHeight + (handle.includes('s') ? dy : handle.includes('n') ? -dy : 0);
    width = Math.max(16, width);
    height = Math.max(16, height);
    const left = activeDrag.originX + (handle.includes('w') ? activeDrag.originWidth - width : 0);
    const top = activeDrag.originY + (handle.includes('n') ? activeDrag.originHeight - height : 0);
    updateSource(activeDrag.sourceId, (source) => ({ ...source, transform: { ...source.transform, x: Math.round(left), y: Math.round(top), width: Math.round(width), height: Math.round(height) } }));
  };

  const handleStagePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current?.pointerId === event.pointerId) dragging.current = null;
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
        event.preventDefault();
        if (event.shiftKey) redoSceneEdit(); else undoSceneEdit();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') {
        event.preventDefault();
        redoSceneEdit();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyC' && selectedSource) {
        event.preventDefault();
        sourceClipboardRef.current = structuredClone(selectedSource);
        setSourceClipboardAvailable(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyV' && sourceClipboardRef.current) {
        event.preventDefault();
        void pasteSource();
        return;
      }
      if (event.code === 'Delete' && selectedSource) {
        event.preventDefault();
        removeSelectedSource();
        return;
      }
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyR') {
        event.preventDefault();
        if (recording.current?.channels.some(({ recorder }) => recorder.state === 'recording')) stopRecording(); else void startRecording();
      }
      if (!selectedSource || !project) return;
      const delta = event.shiftKey ? 10 : 1;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && selectedSource) {
        if (event.code === 'KeyF') { event.preventDefault(); fitSource(selectedSource); return; }
        if (event.code === 'KeyS') { event.preventDefault(); stretchSource(selectedSource); return; }
        if (event.code === 'KeyD') { event.preventDefault(); centerSource(selectedSource); return; }
        if (event.code === 'KeyR') { event.preventDefault(); updateSource(selectedSource.id, (source) => ({ ...source, transform: defaultTransform(source.kind, project.output, source.mediaKind) })); return; }
      }
      const shifts: Record<string, [number, number]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
      const shift = shifts[event.code];
      if (shift) {
        event.preventDefault();
        if (!canTransformSource(selectedSource.locked)) return;
        updateSource(selectedSource.id, (source) => ({ ...source, transform: { ...source.transform, x: source.transform.x + shift[0], y: source.transform.y + shift[1] } }));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (loadingError) return <main className="fatal"><div className="fatal-mark"><Radio size={24} /></div><h1>Stream could not start</h1><p>{loadingError}</p></main>;
  if (!project || !activeScene || !liveScene) return <main className="loading"><div className="brand-pulse"><Radio size={22} /></div><span>Starting Stream</span></main>;

  const sourceInScene = activeScene.sources.find((source) => source.id === selectedSourceId);
  const previewTransform = sourceInScene?.transform;
  const previewOutputRect = previewTransform ? outputRectFromCanvasRect(
    previewTransform,
    { width: project.output.baseWidth, height: project.output.baseHeight },
    { width: project.output.width, height: project.output.height },
  ) : null;
  const previewScene = activeScene;
  const duration = formatElapsed(recordingStartedAt, recordingElapsedTime(clockNow, recordingPausedAt, recordingAccumulatedPauseMs));
  const streamDuration = formatElapsed(streamingStartedAt, clockNow);
  const totalSourceCount = activeScene.sources.length;
  const canSaveReplay = replayBufferRevision > 0 && Boolean(replayBuffer.current?.channels.some((channel) => channel.track === 0 && channel.header));
  const collectionOperationBlocked = working || recordingStartedAt !== null || streamingStartedAt !== null || replayBufferStartedAt !== null;
  const selectedFilters = { ...DEFAULT_SOURCE_FILTERS, ...selectedSource?.filters };
  const selectedTextStyle = selectedSource?.kind === 'text' ? selectedSource.textStyle ?? createDefaultTextStyle() : null;
  const selectedCrop = { ...DEFAULT_SOURCE_CROP, ...selectedSource?.crop };
  const selectedChromaKey = { ...DEFAULT_CHROMA_KEY, ...selectedSource?.chromaKey };
  const selectionHandles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const openCollectionDialog = (kind: 'new' | 'duplicate' | 'rename' | 'delete') => {
    const currentName = activeCollection?.name ?? 'Scene Collection';
    setCollectionNameDraft(kind === 'rename' ? currentName : kind === 'duplicate' ? `${currentName} Copy`.slice(0, 80) : 'Scene Collection');
    setCollectionError('');
    setCollectionMenuOpen(false);
    setCollectionDialog(kind);
  };
  const openProfileDialog = (kind: 'new' | 'duplicate' | 'rename' | 'delete') => {
    const currentName = activeProfile?.name ?? 'Profile 1';
    setProfileNameDraft(kind === 'rename' ? currentName : kind === 'duplicate' ? `${currentName} Copy`.slice(0, 80) : 'Profile');
    setProfileError('');
    setProfileMenuOpen(false);
    setProfileDialog(kind);
  };

  return (
    <main className="app-shell">
      <RuntimeVideoBank sources={allSources} runtimes={runtimesSnapshot} elements={videoElements.current} mediaElements={mediaElements.current} images={imageElements.current} activeSourceIds={activeSourceIds} onMediaElement={connectMediaElement} onMediaPlaybackState={onMediaPlaybackState} onBrowserElement={onBrowserElement} />
      <header className="topbar">
        <button className="icon-button top-icon top-settings-button" type="button" aria-label="Settings" onClick={openSettings}><Settings2 size={16} /></button>
        <span className="topbar-divider" />
        <div className="topbar-title collection-picker">
          <button ref={collectionTriggerRef} className="collection-toggle" type="button" aria-haspopup="menu" aria-expanded={collectionMenuOpen} onClick={() => setCollectionMenuOpen((open) => !open)}>
            <span className="collection-mark"><Layers2 size={14} /></span><span>{activeCollection?.name ?? 'Scene Collection'}</span><span className="subtle-caret"><ChevronDown size={13} /></span>
          </button>
          <AnchoredPopover open={collectionMenuOpen} anchor={collectionTriggerRef.current} className="collection-menu" role="menu" label="Scene collections" onClose={() => setCollectionMenuOpen(false)}>
            <div className="collection-menu-list">{collections.map((collection) => <button key={collection.id} role="menuitemradio" aria-checked={collection.id === activeCollectionId} disabled={collectionOperationBlocked} onClick={() => void activateCollection(collection.id)}>
              <Layers2 size={13} /><span>{collection.name}</span>{collection.id === activeCollectionId && <i />}
            </button>)}</div>
            <div className="collection-menu-separator" />
            <button role="menuitem" disabled={collectionOperationBlocked || collections.length >= MAX_STREAM_SCENE_COLLECTIONS} onClick={() => openCollectionDialog('new')}><Plus size={13} />New Collection</button>
            <button role="menuitem" disabled={collectionOperationBlocked || collections.length >= MAX_STREAM_SCENE_COLLECTIONS} onClick={() => openCollectionDialog('duplicate')}><Copy size={13} />Duplicate Collection</button>
            <button role="menuitem" disabled={working || !activeCollectionId} onClick={() => openCollectionDialog('rename')}><Type size={13} />Rename Collection</button>
            <button role="menuitem" className="collection-menu-danger" disabled={collectionOperationBlocked || collections.length <= 1} onClick={() => openCollectionDialog('delete')}><X size={13} />Delete Collection</button>
            <div className="collection-menu-separator" />
            <button role="menuitem" disabled={collectionOperationBlocked || collections.length >= MAX_STREAM_SCENE_COLLECTIONS} onClick={() => void importCollectionFromFile()}><ArrowDownToLine size={13} />Import Collection</button>
            <button role="menuitem" disabled={collectionOperationBlocked || !activeCollectionId} onClick={() => void exportActiveCollection()}><ArrowUpFromLine size={13} />Export Collection</button>
          </AnchoredPopover>
        </div>
        <div className="topbar-title collection-picker profile-picker">
          <button ref={profileTriggerRef} className="collection-toggle" type="button" aria-haspopup="menu" aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen((open) => !open)}>
            <span className="collection-mark"><Settings2 size={13} /></span><span>{activeProfile?.name ?? 'Profile 1'}</span><span className="subtle-caret"><ChevronDown size={13} /></span>
          </button>
          <AnchoredPopover open={profileMenuOpen} anchor={profileTriggerRef.current} className="collection-menu" role="menu" label="Profiles" onClose={() => setProfileMenuOpen(false)}>
            <div className="collection-menu-list">{profiles.map((profile) => <button key={profile.id} role="menuitemradio" aria-checked={profile.id === activeProfileId} disabled={collectionOperationBlocked} onClick={() => void activateProfile(profile.id)}>
              <Settings2 size={13} /><span>{profile.name}</span>{profile.id === activeProfileId && <i />}
            </button>)}</div>
            <div className="collection-menu-separator" />
            <button role="menuitem" disabled={collectionOperationBlocked || profiles.length >= MAX_STREAM_PROFILES} onClick={() => openProfileDialog('new')}><Plus size={13} />New Profile</button>
            <button role="menuitem" disabled={collectionOperationBlocked || profiles.length >= MAX_STREAM_PROFILES} onClick={() => openProfileDialog('duplicate')}><Copy size={13} />Duplicate Profile</button>
            <button role="menuitem" disabled={working || !activeProfileId} onClick={() => openProfileDialog('rename')}><Type size={13} />Rename Profile</button>
            <button role="menuitem" className="collection-menu-danger" disabled={collectionOperationBlocked || profiles.length <= 1} onClick={() => openProfileDialog('delete')}><X size={13} />Delete Profile</button>
            <div className="collection-menu-separator" />
            <button role="menuitem" disabled={collectionOperationBlocked || profiles.length >= MAX_STREAM_PROFILES} onClick={() => void importProfileFromFile()}><ArrowDownToLine size={13} />Import Profile</button>
            <button role="menuitem" disabled={working || !activeProfileId} onClick={() => void exportActiveProfile()}><ArrowUpFromLine size={13} />Export Profile</button>
          </AnchoredPopover>
        </div>
      </header>

      {settingsOpen && <ModalDialog className="settings-modal" backdropClassName="modal-backdrop settings-backdrop" labelledBy="settings-modal-title" openerRef={settingsOpenerRef} onClose={closeSettings}>
        <div className="modal-heading settings-modal-heading"><div><span className="modal-eyebrow">STREAM</span><h2 id="settings-modal-title">Settings</h2></div><button className="icon-button" aria-label="Close settings" onClick={closeSettings}><X size={16} /></button></div>
        <div className="settings-modal-body">
        <div className="popover-heading"><strong>Audio</strong></div>
        <label>Monitoring device<select aria-label="Monitoring device" disabled={!monitorDeviceSelectionSupported} value={audioSettings.monitoringDeviceId} onChange={(event) => void updateMonitoringDevice(event.target.value)}>
          <option value="">System Default</option>
          {audioSettings.monitoringDeviceId && !audioOutputDevices.some((device) => device.deviceId === audioSettings.monitoringDeviceId)
            && <option value={audioSettings.monitoringDeviceId}>Saved device unavailable</option>}
          {audioOutputDevices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
        </select></label>
        {audioSettingsError && <p className="hotkey-error" role="alert">{audioSettingsError}</p>}
        {!monitorDeviceSelectionSupported && <p className="hotkey-error" role="status">Audio output device selection is unavailable.</p>}
        <div className="popover-heading"><strong>Output</strong></div>
        <label>Replay buffer<select value={replayBufferDurationSeconds} disabled={replayBufferStartedAt !== null} onChange={(event) => setReplayBufferDurationSeconds(Number(event.target.value))}><option value={5}>5 seconds</option><option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={60}>60 seconds</option></select></label>
        <div className="popover-heading video-heading"><strong>Video</strong></div>
        <div className="settings-number-grid">
          <label>Base (Canvas) width<input aria-label="Base canvas width" type="number" min="320" max="16384" step="1" key={`base-width-${project.output.baseWidth}`} defaultValue={project.output.baseWidth} onBlur={(event) => {
            const entered = Number(event.currentTarget.value);
            if (!Number.isFinite(entered) || event.currentTarget.value.trim() === '') return;
            const width = Math.max(320, Math.min(16384, Math.round(entered)));
            setProjectValue((current) => ({ ...current, output: { ...current.output, baseWidth: width } }));
          }} /></label>
          <label>Base (Canvas) height<input aria-label="Base canvas height" type="number" min="180" max="16384" step="1" key={`base-height-${project.output.baseHeight}`} defaultValue={project.output.baseHeight} onBlur={(event) => {
            const entered = Number(event.currentTarget.value);
            if (!Number.isFinite(entered) || event.currentTarget.value.trim() === '') return;
            const height = Math.max(180, Math.min(16384, Math.round(entered)));
            setProjectValue((current) => ({ ...current, output: { ...current.output, baseHeight: height } }));
          }} /></label>
          <label>Output (Scaled) width<input aria-label="Output scaled width" type="number" min={SCALED_OUTPUT_LIMITS.minWidth} max={SCALED_OUTPUT_LIMITS.maxWidth} step="2" key={`output-width-${project.output.width}`} defaultValue={project.output.width} onBlur={(event) => {
            const entered = Number(event.currentTarget.value);
            if (!Number.isFinite(entered) || event.currentTarget.value.trim() === '') return;
            const width = clampScaledOutputSize({ width: entered, height: project.output.height }).width;
            setProjectValue((current) => ({ ...current, output: { ...current.output, width } }));
          }} /></label>
          <label>Output (Scaled) height<input aria-label="Output scaled height" type="number" min={SCALED_OUTPUT_LIMITS.minHeight} max={SCALED_OUTPUT_LIMITS.maxHeight} step="2" key={`output-height-${project.output.height}`} defaultValue={project.output.height} onBlur={(event) => {
            const entered = Number(event.currentTarget.value);
            if (!Number.isFinite(entered) || event.currentTarget.value.trim() === '') return;
            const height = clampScaledOutputSize({ width: project.output.width, height: entered }).height;
            setProjectValue((current) => ({ ...current, output: { ...current.output, height } }));
          }} /></label>
        </div>
        <label>Frame rate (FPS)<input aria-label="Frame rate" type="number" min="1" max="240" step="0.01" key={`frame-rate-${project.output.frameRate}`} defaultValue={project.output.frameRate} onBlur={(event) => {
          const entered = Number(event.currentTarget.value);
          if (!Number.isFinite(entered) || event.currentTarget.value.trim() === '') return;
          const frameRate = Math.max(1, Math.min(240, Math.round(entered * 100) / 100));
          setProjectValue((current) => ({ ...current, output: { ...current.output, frameRate } }));
        }} /></label>
        <div className="popover-heading video-heading"><strong>Recording</strong></div>
        <details className="filter-details settings-audio-tracks"><summary>Recording audio tracks</summary>
          <div className="audio-track-grid">{AUDIO_TRACKS.map((track) => <label key={track} className="audio-track-toggle"><input type="checkbox" disabled={recordingStartedAt !== null || recordingFinalizing || replayBufferStartedAt !== null} checked={project.output.recordingAudioTracks.includes(track)} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, recordingAudioTracks: event.target.checked ? [...new Set([...current.output.recordingAudioTracks, track])].sort((left, right) => left - right) : current.output.recordingAudioTracks.filter((item) => item !== track) } }))} /><span>Track {track}</span></label>)}</div>
        </details>
        <label>Recording video bitrate (kb/s)<input type="number" min="500" max="50000" step="500" disabled={project.output.recordingContainer === 'mp4' && project.output.recordingRateControl === 'quality'} value={project.output.recordingVideoBitrateKbps} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, recordingVideoBitrateKbps: Math.max(500, Math.min(50000, Math.round(Number(event.target.value) || 500))) } }))} /></label>
        <label>Recording format<select value={project.output.recordingContainer} disabled={recordingStartedAt !== null || recordingFinalizing} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, recordingContainer: event.target.value as StreamProject['output']['recordingContainer'] } }))}><option value="mkv">Matroska (.mkv)</option><option value="mp4">MPEG-4 (.mp4)</option><option value="webm">WebM (.webm)</option></select></label>
        <label>Audio bitrate per track (kb/s)<input type="number" min="32" max="320" step="16" value={project.output.recordingAudioBitrateKbps} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, recordingAudioBitrateKbps: Math.max(32, Math.min(320, Math.round(Number(event.target.value) || 32))) } }))} /></label>
        <label>MP4 encoder<select value={project.output.recordingVideoEncoder} disabled={project.output.recordingContainer !== 'mp4' || recordingStartedAt !== null || recordingFinalizing} onChange={(event) => {
          const encoder = event.target.value as VideoEncoderFamily;
          setProjectValue((current) => ({ ...current, output: {
            ...current.output,
            recordingVideoEncoder: encoder,
            recordingRateControl: normalizeVideoRateControl(encoder, current.output.recordingRateControl),
          } }));
        }}>{VIDEO_ENCODER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>MP4 rate control<select value={project.output.recordingRateControl} disabled={project.output.recordingContainer !== 'mp4' || recordingStartedAt !== null || recordingFinalizing} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, recordingRateControl: event.target.value as StreamProject['output']['recordingRateControl'] } }))}>{VIDEO_RATE_CONTROL_OPTIONS.filter((option) => getVideoEncoderRateControlModes(project.output.recordingVideoEncoder).includes(option.value)).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>MP4 encoder quality<input className="encoder-range" type="range" min="0" max="100" disabled={project.output.recordingContainer !== 'mp4' || project.output.recordingVideoEncoder === 'libopenh264' || recordingStartedAt !== null || recordingFinalizing} value={project.output.recordingEncoderQuality} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, recordingEncoderQuality: Number(event.target.value) } }))} /><span className="range-value">{project.output.recordingEncoderQuality}</span></label>
        <label>MP4 keyframe interval (seconds)<input type="number" min="1" max="10" step="1" disabled={project.output.recordingContainer !== 'mp4' || recordingStartedAt !== null || recordingFinalizing} value={project.output.recordingKeyframeIntervalSeconds} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, recordingKeyframeIntervalSeconds: Math.max(1, Math.min(10, Math.round(Number(event.target.value) || 1))) } }))} /></label>
        <label className="encoder-toggle"><input type="checkbox" checked={project.output.recordingHardwareEncoding} disabled={project.output.recordingContainer !== 'mp4' || project.output.recordingVideoEncoder !== 'h264_mf' || recordingStartedAt !== null || recordingFinalizing} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, recordingHardwareEncoding: event.target.checked } }))} /><span>MP4 hardware encoding</span></label>
        <div className="popover-heading video-heading"><strong>Global Hotkeys</strong></div>
        <label>Toggle streaming<input aria-label="Toggle streaming shortcut" readOnly value={hotkeyDraft?.toggleStreaming ?? project.hotkeys.toggleStreaming} onKeyDown={(event) => captureHotkey('toggleStreaming', event)} /></label>
        <label>Toggle recording<input aria-label="Toggle recording shortcut" readOnly value={hotkeyDraft?.toggleRecording ?? project.hotkeys.toggleRecording} onKeyDown={(event) => captureHotkey('toggleRecording', event)} /></label>
        <label>Toggle replay buffer<input aria-label="Toggle replay buffer shortcut" readOnly value={hotkeyDraft?.toggleReplayBuffer ?? project.hotkeys.toggleReplayBuffer} onKeyDown={(event) => captureHotkey('toggleReplayBuffer', event)} /></label>
        <label>Save replay<input aria-label="Save replay shortcut" readOnly value={hotkeyDraft?.saveReplay ?? project.hotkeys.saveReplay} onKeyDown={(event) => captureHotkey('saveReplay', event)} /></label>
        <div className="popover-heading video-heading"><strong>Scene Switches</strong></div>
        {project.scenes.map((scene) => <label key={scene.id}>{scene.name}<input aria-label={`Switch to ${scene.name} shortcut`} readOnly value={sceneSwitchHotkeyDraft[scene.id] ?? ''} onKeyDown={(event) => captureSceneSwitchHotkey(scene.id, event)} /></label>)}
        <div className="popover-heading video-heading"><strong>Source Visibility</strong></div>
        {project.scenes.flatMap((scene) => scene.sources.map((source) => (
          <label key={source.id}>{scene.name} · {source.name}<input aria-label={`Toggle visibility for ${source.name} in ${scene.name} shortcut`} readOnly value={sourceVisibilityHotkeyDraft[source.id] ?? ''} onKeyDown={(event) => captureSourceVisibilityHotkey(source.id, event)} /></label>
        )))}
        {hotkeyError && <p className="hotkey-error" role="alert">{hotkeyError}</p>}
        <button className="apply-hotkeys" type="button" disabled={hotkeysWorking || !hotkeyDraft} onClick={() => void applyHotkeys()}>{hotkeysWorking ? 'Applying…' : 'Apply Hotkeys'}</button>
        </div>
      </ModalDialog>}

      <section className="workbench">
        <aside className="dock scenes-dock">
          <div className="dock-title"><span>Scenes</span><span className="dock-count">{project.scenes.length}</span><div className="dock-actions"><button className="mini-icon" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!undoAvailable} onClick={undoSceneEdit}><Undo2 size={14} /></button><button className="mini-icon" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!redoAvailable} onClick={redoSceneEdit}><Redo2 size={14} /></button><button className="mini-icon" aria-label="Add scene" onClick={addScene}><Plus size={15} /></button></div></div>
          <div className="scene-list">
            {project.scenes.map((scene) => <button key={scene.id} className={`scene-row ${scene.id === project.activeSceneId ? 'selected' : ''} ${scene.id === project.liveSceneId ? 'live' : ''}`} onClick={() => chooseScene(scene.id)}>
              <span className="scene-swatch"><Layers2 size={14} /></span><span className="scene-name">{scene.name}</span>{scene.id === project.liveSceneId && <span className="live-tag">LIVE</span>}
            </button>)}
          </div>
          <div className="scene-dock-footer"><span className="scene-dots"><i /><i /><i /></span><span>{project.scenes.length} scenes</span><button ref={sceneMenuTriggerRef} className="mini-icon" aria-label="Scene options" aria-haspopup="menu" aria-expanded={sceneMenuOpen} onClick={() => setSceneMenuOpen((open) => !open)}><MoreHorizontal size={16} /></button></div>
          <AnchoredPopover open={sceneMenuOpen} anchor={sceneMenuTriggerRef.current} className="scene-menu" side="top" alignment="end" role="menu" onClose={() => setSceneMenuOpen(false)}>
            <button role="menuitem" onClick={() => { setSceneNameDraft(activeScene.name); setSceneDialog('rename'); }}><Type size={14} />Rename Scene</button>
            <button role="menuitem" disabled={working} onClick={() => void duplicateActiveScene()}><Copy size={14} />Duplicate Scene</button>
            <button role="menuitem" className="scene-menu-danger" disabled={project.scenes.length <= 1} onClick={() => setSceneDialog('delete')}><X size={14} />Delete Scene</button>
          </AnchoredPopover>
        </aside>

        <section className="monitor-dock">
          <div ref={monitorStageRef} className={`monitor-stage ${project.studioMode ? 'studio' : ''} ${multiviewMode ? 'multiview' : ''}`}>
            {project.studioMode && !multiviewMode && <div key="preview-panel" className="stage-panel">
              <div className="stage-label"><span>PREVIEW</span><b>{activeScene.name}</b></div>
              <div className="stage-surface" style={previewSize} onPointerDown={(event) => handleStagePointerDown(event, previewScene)} onPointerMove={handleStagePointerMove} onPointerUp={handleStagePointerUp} onPointerCancel={handleStagePointerUp}>
                <CanvasComposition project={project} scene={previewScene} videoElements={videoElements.current} imageElements={imageElements.current} />
                {previewOutputRect && <div className={`selection-frame ${sourceInScene?.locked ? 'locked' : ''}`} style={{ left: `${(previewOutputRect.x / project.output.width) * 100}%`, top: `${(previewOutputRect.y / project.output.height) * 100}%`, width: `${(previewOutputRect.width / project.output.width) * 100}%`, height: `${(previewOutputRect.height / project.output.height) * 100}%` }}>{canTransformSource(sourceInScene?.locked) && selectionHandles.map((handle) => <span key={handle} className={`resize-handle resize-${handle}`} data-resize-handle={handle} />)}</div>}
              </div>
            </div>}
            <div key="program-panel" className={`stage-panel program-panel ${multiviewMode ? 'multiview-tile program-tile' : ''}`}>
              <div className={`stage-label ${multiviewMode ? 'program-stage-label-hidden' : ''}`}><span><i className="program-dot" />PROGRAM</span><b>{liveScene.name}</b></div>
              <div className={`stage-surface ${multiviewMode ? 'multiview-canvas' : ''}`} style={multiviewMode ? { aspectRatio: `${project.output.width} / ${project.output.height}` } : previewSize} onPointerDown={!project.studioMode && !multiviewMode ? (event) => handleStagePointerDown(event, liveScene) : undefined} onPointerMove={!project.studioMode && !multiviewMode ? handleStagePointerMove : undefined} onPointerUp={!project.studioMode && !multiviewMode ? handleStagePointerUp : undefined} onPointerCancel={!project.studioMode && !multiviewMode ? handleStagePointerUp : undefined}>
                <CanvasComposition ref={programCanvasRef} project={project} scene={liveScene} videoElements={videoElements.current} imageElements={imageElements.current} transition={transition} onTransitionEnd={finishTransition} />
                {!project.studioMode && !multiviewMode && previewOutputRect && <div className={`selection-frame ${sourceInScene?.locked ? 'locked' : ''}`} style={{ left: `${(previewOutputRect.x / project.output.width) * 100}%`, top: `${(previewOutputRect.y / project.output.height) * 100}%`, width: `${(previewOutputRect.width / project.output.width) * 100}%`, height: `${(previewOutputRect.height / project.output.height) * 100}%` }}>{canTransformSource(sourceInScene?.locked) && selectionHandles.map((handle) => <span key={handle} className={`resize-handle resize-${handle}`} data-resize-handle={handle} />)}</div>}
              </div>
              {multiviewMode && <div className="multiview-caption"><span><i className="program-dot" />PROGRAM</span><b>{liveScene.name}</b></div>}
            </div>
            {multiviewMode && project.scenes.map((scene) => <button key={scene.id} className={`multiview-tile ${scene.id === project.activeSceneId ? 'preview-tile' : ''} ${scene.id === project.liveSceneId ? 'live-tile' : ''}`} onClick={() => chooseScene(scene.id)} aria-label={`Preview scene ${scene.name}`}>
              <div className="multiview-canvas" style={{ aspectRatio: `${project.output.width} / ${project.output.height}` }}>
                <CanvasComposition project={project} scene={scene} videoElements={videoElements.current} imageElements={imageElements.current} renderScale={0.2} />
              </div>
              <div className="multiview-caption"><span>{scene.id === project.activeSceneId ? <><i className="preview-dot" />PREVIEW</> : scene.id === project.liveSceneId ? <><i className="program-dot" />LIVE</> : 'SCENE'}</span><b>{scene.name}</b></div>
            </button>)}
          </div>
          <div className="monitor-status">
            <span className="status-online"><i />Preview active</span>
            <div className="monitor-status-actions">
              <label className="transition-inline"><span>Transition</span><select aria-label="Scene transition" value={transitionType} onChange={(event) => setTransitionType(event.target.value as SceneTransitionType)}><option value="Fade">Fade</option><option value="Cut">Cut</option><option value="Swipe">Swipe</option><option value="Slide">Slide</option><option value="FadeToColor">Fade to Color</option></select></label>
              {transitionType === 'FadeToColor' && <label className="transition-color-inline"><span>Color</span><input aria-label="Transition color" type="color" value={transitionColor} onChange={(event) => setTransitionColor(event.target.value)} /></label>}
              <label className="transition-duration-inline"><input aria-label="Transition duration in milliseconds" type="number" min="50" max="5000" step="50" value={transitionMs} onChange={(event) => setTransitionMs(Math.max(50, Math.min(5000, Number(event.target.value) || 50)))} /><span>ms</span></label>
              {project.studioMode && <button className="take-button toolbar-take" disabled={project.activeSceneId === project.liveSceneId} onClick={takeScene}>Take <Clapperboard size={13} /></button>}
              <button className={`studio-toggle ${multiviewMode ? 'enabled' : ''}`} aria-pressed={multiviewMode} onClick={toggleMultiviewMode}><Grid2X2 size={13} />Multiview</button>
              <button className={`studio-toggle ${project.studioMode ? 'enabled' : ''}`} aria-pressed={project.studioMode} onClick={toggleStudioMode}><Clapperboard size={14} />Studio Mode</button>
              <button className="icon-button projector-button" aria-label="Open program projector" title="Open program projector" onClick={openProgramProjector}><ExternalLink size={14} /></button>
            </div>
            <span className="monitor-zoom">{project.output.width ? Math.round((previewSize.width / project.output.width) * 100) : 0}%</span>
          </div>
        </section>

        <aside className="dock controls-dock">
          <div className="dock-title"><span>Controls</span><MoreHorizontal size={16} className="title-more" /></div>
          <div className="control-action-grid">
            {streamingStartedAt === null ? <button className="control-action live-action" disabled={working} onClick={() => setStreamDialogOpen(true)}><Radio size={13} />Go Live</button> : <button className="control-action live-action active-action" onClick={stopStreaming}><Square size={11} fill="currentColor" />Stop Live</button>}
            {recordingFinalizing ? <button className="control-action" disabled><span className="record-button-dot" />Finalizing</button> : recordingStartedAt === null ? <button className="control-action record-action" disabled={working} onClick={() => void startRecording()}><span className="record-button-dot" />Record</button> : <>
              {recordingPausedAt === null
                ? <button className="control-action pause-action" onClick={pauseRecording}><Pause size={12} fill="currentColor" />Pause</button>
                : <button className="control-action pause-action" onClick={resumeRecording}><Play size={12} fill="currentColor" />Resume</button>}
              <button className="control-action active-action" onClick={stopRecording}><Square size={11} fill="currentColor" />Stop Rec</button>
            </>}
            {replayBufferStartedAt === null ? <button className="control-action" disabled={working} onClick={() => void startReplayBuffer()}><Radio size={13} />Start Replay Buffer</button> : <button className="control-action active-action" onClick={stopReplayBuffer}><Square size={11} />Stop Replay Buffer</button>}
            <button className="control-action" disabled={!canSaveReplay || working} onClick={() => void saveReplay()}><Copy size={13} />Save Replay</button>
          </div>
          <div className="control-status-lines">
            <span><i className={`control-status-dot ${streamStatus.state === 'live' ? 'live-dot' : ''}`} />{streamStatus.state === 'live' ? `Live · ${streamDuration}` : streamStatus.state === 'connecting' ? 'Connecting…' : streamStatus.state === 'error' ? 'Stream error' : 'Offline'}</span>
            <span><i className={`control-status-dot ${recordingStartedAt !== null || recordingFinalizing ? 'record-dot' : ''}`} />{recordingFinalizing ? 'Finalizing' : recordingStartedAt === null ? 'Recording stopped' : `${recordingPausedAt === null ? 'Recording' : 'Recording paused'} · ${duration}`}</span>
            {streamStatus.state === 'live' && <span className="control-bitrate">{streamStatus.bitrateKbps ?? 0} kb/s</span>}
          </div>
          <div className="control-bottom"><button className="control-small" onClick={toggleStudioMode}><Clapperboard size={14} />{project.studioMode ? 'Exit Studio Mode' : 'Studio Mode'}</button><button className="control-small" aria-label="Remux recording" title="Remux recording" disabled={working} onClick={() => void remuxRecording()}><FileVideo size={14} />Remux</button><button className="control-small" onClick={openSettings}><Settings2 size={14} />Settings</button></div>
        </aside>

        <section className="dock sources-dock">
          <div className="dock-title"><span>Sources</span><span className="dock-count">{totalSourceCount}</span><div className="dock-actions"><button ref={sourceMenuTriggerRef} className="mini-icon" aria-label="Add source" aria-haspopup="menu" aria-expanded={sourceMenuOpen} onClick={() => setSourceMenuOpen((open) => !open)}><Plus size={15} /></button><button ref={sourceActionsTriggerRef} className="mini-icon" aria-label="More source actions" aria-haspopup="menu" aria-expanded={sourceActionsMenuOpen} onClick={() => setSourceActionsMenuOpen((open) => !open)}><MoreHorizontal size={16} /></button></div></div>
          <AnchoredPopover open={sourceActionsMenuOpen} anchor={sourceActionsTriggerRef.current} className="source-menu" side="top" alignment="end" role="menu" label="Source actions" onClose={() => setSourceActionsMenuOpen(false)}>
            <button role="menuitem" disabled={!selectedSource} onClick={copySelectedSource}><Copy size={14} />Copy Source</button>
            <button role="menuitem" disabled={!sourceClipboardAvailable || working} onClick={() => void pasteSource()}><Plus size={14} />Paste Source</button>
            <div className="source-menu-separator" />
            <button role="menuitem" disabled={!selectedSource || selectedSource.locked || !supportsSourceTransform(selectedSource)} onClick={() => selectedSource && fitSource(selectedSource)}><Move size={14} />Fit to Canvas</button>
            <button role="menuitem" disabled={!selectedSource || selectedSource.locked || !supportsSourceTransform(selectedSource)} onClick={() => selectedSource && centerSource(selectedSource)}><Move size={14} />Center</button>
            <button role="menuitem" disabled={!selectedSource || selectedSource.locked || !supportsSourceTransform(selectedSource)} onClick={() => selectedSource && stretchSource(selectedSource)}><Move size={14} />Stretch to Canvas</button>
            <button role="menuitem" disabled={!selectedSource || selectedSource.locked || !supportsSourceTransform(selectedSource)} onClick={() => selectedSource && updateSource(selectedSource.id, (source) => ({ ...source, transform: defaultTransform(source.kind, project.output, source.mediaKind) }))}><Move size={14} />Reset Transform</button>
            <div className="source-menu-separator" />
            <button role="menuitem" disabled={!selectedSource} onClick={removeSelectedSource}><X size={14} />Delete Source</button>
          </AnchoredPopover>
          <div className="source-list">
            {activeScene.sources.length === 0 && <div className="source-empty"><span className="empty-stack"><Layers2 size={18} /></span><b>No sources yet</b><span>Add a source to this scene.</span></div>}
            {[...activeScene.sources].reverse().map((source, displayIndex) => {
              const realIndex = activeScene.sources.length - 1 - displayIndex;
              return <div key={source.id} className={`source-row ${selectedSourceId === source.id ? 'selected' : ''} ${source.locked ? 'source-locked' : ''}`} onClick={() => setSelectedSourceId(source.id)}>
                <button className="visibility-toggle" title={source.visible ? 'Hide source' : 'Show source'} onClick={(event) => { event.stopPropagation(); updateSource(source.id, (current) => ({ ...current, visible: !current.visible })); }}>
                  {source.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <span className={`source-type-icon ${source.kind}`}>{sourceIcon(source.kind, source.mediaKind)}</span>
                <span className="source-label">{source.name}</span>
                {meterLevels[source.id] !== undefined && <span className="source-level-mini"><i style={{ width: `${Math.round((meterLevels[source.id] ?? 0) * 100)}%` }} /></span>}
                <span className="source-actions"><button aria-label={source.locked ? 'Unlock source' : 'Lock source'} title={source.locked ? 'Unlock source' : 'Lock source'} onClick={(event) => { event.stopPropagation(); toggleSourceLock(source.id); }}>{source.locked ? <Lock size={12} /> : <LockOpen size={12} />}</button><button aria-label="Move source up" title="Move source up" disabled={realIndex === activeScene.sources.length - 1} onClick={(event) => { event.stopPropagation(); moveSource(source.id, 1); }}><ChevronUp size={13} /></button><button aria-label="Move source down" title="Move source down" disabled={realIndex === 0} onClick={(event) => { event.stopPropagation(); moveSource(source.id, -1); }}><ChevronDown size={13} /></button></span>
              </div>;
            })}
          </div>
          <AnchoredPopover open={sourceMenuOpen} anchor={sourceMenuTriggerRef.current} className="source-menu" alignment="end" role="menu" onClose={() => setSourceMenuOpen(false)}>
            <div className="menu-label">Capture</div>
            <button role="menuitem" onClick={() => void openCapturePicker('screen')}><Monitor size={15} />Display Capture</button>
            <button role="menuitem" onClick={() => void openCapturePicker('window')}><Grid2X2 size={15} />Window Capture</button>
            <button role="menuitem" onClick={() => void openCapturePicker('audio')}><Headphones size={15} />Audio Output Capture</button>
            <button role="menuitem" onClick={() => void openApplicationAudioPicker()}><Headphones size={15} />Application Audio Capture</button>
            <button role="menuitem" onClick={() => void addCamera()}><Webcam size={15} />Video Capture Device</button>
            <button role="menuitem" onClick={() => void addMicrophone()}><Mic size={15} />Audio Input Capture</button>
            <div className="menu-label menu-label-separator">Media</div>
            <button role="menuitem" onClick={() => void addMedia('image')}><ImageIcon size={15} />Image</button>
            <button role="menuitem" onClick={() => void addSlideshow()}><ImageIcon size={15} />Image Slideshow</button>
            <button role="menuitem" onClick={() => void addMedia('video')}><FileVideo size={15} />Media Source</button>
            <button role="menuitem" onClick={() => void addMedia('audio')}><FileAudio size={15} />Audio File</button>
            <button role="menuitem" onClick={() => { setSourceMenuOpen(false); setBrowserDialogOpen(true); }}><Globe size={15} />Browser Source</button>
            <div className="menu-label menu-label-separator">Graphics</div>
            <button role="menuitem" onClick={addText}><Type size={15} />Text</button>
            <button role="menuitem" onClick={addColor}><Layers2 size={15} />Color Source</button>
          </AnchoredPopover>
          {selectedSource && <div className="source-properties">
            <div className="property-heading"><span>{sourceIcon(selectedSource.kind, selectedSource.mediaKind)}{selectedSource.name}</span><button className="mini-icon danger" aria-label="Remove source" onClick={removeSelectedSource}><X size={14} /></button></div>
            {(selectedSource.kind === 'camera' || selectedSource.kind === 'microphone') && <label className="device-property">Device<select aria-label="Capture device" disabled={working} value={selectedSource.deviceId ?? ''} onChange={(event) => void switchInputDevice(selectedSource, event.target.value || undefined)}>
              {selectedSource.deviceId && !inputDeviceOptions[selectedSource.kind].some((device) => device.deviceId === selectedSource.deviceId) && <option value={selectedSource.deviceId}>{selectedSource.name} (Unavailable)</option>}
              <option value="">Default Device</option>
              {inputDeviceOptions[selectedSource.kind].map((device) => <option key={device.deviceId || device.label} value={device.deviceId}>{device.label}</option>)}
            </select></label>}
            {selectedSource.kind === 'camera' && <>
              <label className="device-property">Resolution<select aria-label="Camera resolution" disabled={working} value={selectedSource.cameraResolution ?? 'device-default'} onChange={(event) => void updateCameraCaptureSettings(selectedSource, { cameraResolution: event.target.value as CameraResolutionPreset })}>
                {CAMERA_RESOLUTION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select></label>
              <label className="device-property">FPS<select aria-label="Camera frame rate" disabled={working} value={selectedSource.cameraFrameRate ?? ''} onChange={(event) => void updateCameraCaptureSettings(selectedSource, { cameraFrameRate: event.target.value ? Number(event.target.value) as CameraFrameRatePreset : undefined })}>
                <option value="">Device Default</option>
                {CAMERA_FRAME_RATE_OPTIONS.map((rate) => <option key={rate} value={rate}>{rate} FPS</option>)}
              </select></label>
            </>}
            {selectedSource.kind === 'desktop-audio' && !runtimesSnapshot.has(selectedSource.id) && <button className="secondary-button device-property" disabled={working} onClick={() => void openCapturePicker('audio', selectedSource.id)}>Start Capture</button>}
            {selectedSource.kind === 'application-audio' && <>
              <button className="secondary-button device-property" disabled={working} onClick={() => void openApplicationAudioPicker(selectedSource.id)}>{runtimesSnapshot.has(selectedSource.id) ? 'Change Application' : 'Reconnect Application'}</button>
              <label className="device-property">Application path<input value={selectedSource.applicationPath ?? ''} readOnly title={selectedSource.applicationPath} /></label>
            </>}
            {(selectedSource.kind === 'display' || selectedSource.kind === 'window') && <>
              <button className="secondary-button device-property" disabled={working} onClick={() => void openCapturePicker(selectedSource.kind === 'display' ? 'screen' : 'window', selectedSource.id)}>{runtimesSnapshot.has(selectedSource.id) ? 'Change Capture' : 'Reconnect Capture'}</button>
              <label className="device-property">Capture Cursor<select aria-label="Capture cursor" disabled={working} value={selectedSource.cursorMode ?? 'motion'} onChange={(event) => void updateCaptureCursorMode(selectedSource.id, event.target.value as CaptureCursorMode)}><option value="always">Always</option><option value="motion">Only when moving</option><option value="never">Never</option></select></label>
            </>}
            {supportsSourceTransform(selectedSource) && <details className="filter-details"><summary>Transform</summary>
              <div className="source-transform-grid">
                {(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key}>{key === 'x' ? 'Position X' : key === 'y' ? 'Position Y' : key === 'width' ? 'Width' : 'Height'}<input aria-label={`Source ${key}`} disabled={selectedSource.locked} type="number" min={key === 'x' || key === 'y' ? -32768 : 1} max="32768" step="1" key={`${selectedSource.id}-${key}-${selectedSource.transform[key]}`} defaultValue={selectedSource.transform[key]} onBlur={(event) => updateSourceTransform(selectedSource.id, key, event.currentTarget.value)} /></label>)}
              </div>
              <div className="transform-actions"><button type="button" disabled={selectedSource.locked} onClick={() => fitSource(selectedSource)}>Fit to Canvas</button><button type="button" disabled={selectedSource.locked} onClick={() => centerSource(selectedSource)}>Center</button><button type="button" disabled={selectedSource.locked} onClick={() => updateSource(selectedSource.id, (source) => ({ ...source, transform: defaultTransform(source.kind, project.output, source.mediaKind) }))}>Reset</button></div>
            </details>}
            {selectedSource.kind === 'text' && selectedTextStyle && <>
              <label className="text-property text-property-stack">Text<textarea rows={3} value={selectedSource.text ?? ''} onChange={(event) => updateSource(selectedSource.id, (source) => ({ ...source, text: event.target.value }))} /></label>
              <label className="device-property">Font<select aria-label="Text font" value={selectedTextStyle.fontFamily} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, fontFamily: event.target.value }))}>{['Segoe UI', 'Arial', 'Arial Black', 'Calibri', 'Consolas', 'Georgia', 'Impact', 'Tahoma', 'Verdana'].map((font) => <option key={font} value={font}>{font}</option>)}</select></label>
              <label className="device-property">Size<input aria-label="Text font size" type="number" min="1" max="512" value={selectedTextStyle.fontSize} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, fontSize: Math.max(1, Math.min(512, Number(event.target.value) || 1)) }))} /></label>
              <div className="text-style-toggles">
                <label><input type="checkbox" checked={selectedTextStyle.bold} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, bold: event.target.checked }))} /><span>Bold</span></label>
                <label><input type="checkbox" checked={selectedTextStyle.italic} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, italic: event.target.checked }))} /><span>Italic</span></label>
              </div>
              <label className="device-property">Align<select aria-label="Text alignment" value={selectedTextStyle.horizontalAlignment} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, horizontalAlignment: event.target.value as StreamTextStyle['horizontalAlignment'] }))}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
              <label className="device-property">Vertical<select aria-label="Text vertical alignment" value={selectedTextStyle.verticalAlignment} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, verticalAlignment: event.target.value as StreamTextStyle['verticalAlignment'] }))}><option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option></select></label>
              <label className="color-property">Color<input aria-label="Text color" type="color" value={selectedSource.color ?? '#ffffff'} onChange={(event) => updateSource(selectedSource.id, (source) => ({ ...source, color: event.target.value }))} /></label>
              <details className="filter-details text-style-details"><summary>Outline</summary>
                <label className="audio-filter-toggle"><input type="checkbox" checked={selectedTextStyle.outline.enabled} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, outline: { ...style.outline, enabled: event.target.checked } }))} /><span>Enabled</span></label>
                <label className="color-property">Color<input aria-label="Text outline color" type="color" disabled={!selectedTextStyle.outline.enabled} value={selectedTextStyle.outline.color} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, outline: { ...style.outline, color: event.target.value } }))} /></label>
                <label className="filter-control"><span>Width</span><input aria-label="Text outline width" type="range" min="0" max="32" value={selectedTextStyle.outline.width} disabled={!selectedTextStyle.outline.enabled} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, outline: { ...style.outline, width: Number(event.target.value) } }))} /><b>{selectedTextStyle.outline.width}px</b></label>
              </details>
              <details className="filter-details text-style-details"><summary>Drop Shadow</summary>
                <label className="audio-filter-toggle"><input type="checkbox" checked={selectedTextStyle.shadow.enabled} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, shadow: { ...style.shadow, enabled: event.target.checked } }))} /><span>Enabled</span></label>
                <label className="color-property">Color<input aria-label="Text shadow color" type="color" disabled={!selectedTextStyle.shadow.enabled} value={selectedTextStyle.shadow.color} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, shadow: { ...style.shadow, color: event.target.value } }))} /></label>
                <label className="filter-control"><span>Blur</span><input aria-label="Text shadow blur" type="range" min="0" max="100" value={selectedTextStyle.shadow.blur} disabled={!selectedTextStyle.shadow.enabled} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, shadow: { ...style.shadow, blur: Number(event.target.value) } }))} /><b>{selectedTextStyle.shadow.blur}px</b></label>
                <label className="device-property">Offset X<input aria-label="Text shadow offset X" type="number" min="-128" max="128" disabled={!selectedTextStyle.shadow.enabled} value={selectedTextStyle.shadow.offsetX} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, shadow: { ...style.shadow, offsetX: Math.max(-128, Math.min(128, Number(event.target.value) || 0)) } }))} /></label>
                <label className="device-property">Offset Y<input aria-label="Text shadow offset Y" type="number" min="-128" max="128" disabled={!selectedTextStyle.shadow.enabled} value={selectedTextStyle.shadow.offsetY} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, shadow: { ...style.shadow, offsetY: Math.max(-128, Math.min(128, Number(event.target.value) || 0)) } }))} /></label>
              </details>
              <details className="filter-details text-style-details"><summary>Background</summary>
                <label className="color-property">Color<input aria-label="Text background color" type="color" value={selectedTextStyle.background.color} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, background: { ...style.background, color: event.target.value } }))} /></label>
                <label className="filter-control"><span>Opacity</span><input aria-label="Text background opacity" type="range" min="0" max="100" value={Math.round(selectedTextStyle.background.opacity * 100)} onChange={(event) => updateTextStyle(selectedSource.id, (style) => ({ ...style, background: { ...style.background, opacity: Number(event.target.value) / 100 } }))} /><b>{Math.round(selectedTextStyle.background.opacity * 100)}%</b></label>
              </details>
            </>}
            {selectedSource.kind === 'color' && <label className="color-property">Color<input type="color" value={selectedSource.color ?? '#ffffff'} onChange={(event) => updateSource(selectedSource.id, (source) => ({ ...source, color: event.target.value }))} /></label>}
            {selectedSource.kind === 'media' && <>
              <div className="media-playback-controls">
                <button className="secondary-button" disabled={!mediaElements.current.has(selectedSource.id)} onClick={() => toggleMediaPlayback(selectedSource.id)}>{mediaPlaybackStates[selectedSource.id]?.paused ? <Play size={12} /> : <Pause size={12} />}{mediaPlaybackStates[selectedSource.id]?.paused ? 'Play' : 'Pause'}</button>
                <button className="secondary-button" disabled={!mediaElements.current.has(selectedSource.id)} onClick={() => restartMediaPlayback(selectedSource.id)}><Play size={12} />Restart</button>
                <button className="secondary-button" disabled={!mediaElements.current.has(selectedSource.id)} onClick={() => stopMediaPlayback(selectedSource.id)}><Square size={11} />Stop</button>
              </div>
              <label className="media-loop-property"><input type="checkbox" checked={selectedSource.loop ?? false} onChange={(event) => updateSource(selectedSource.id, (source) => ({ ...source, loop: event.target.checked }))} /><span>Loop</span></label>
              <label className="media-loop-property"><input type="checkbox" checked={selectedSource.restartPlaybackWhenActive ?? true} onChange={(event) => updateSource(selectedSource.id, (source) => ({ ...source, restartPlaybackWhenActive: event.target.checked }))} /><span>Restart playback when source becomes active</span></label>
              <label className="media-loop-property"><input type="checkbox" checked={selectedSource.showNothingWhenPlaybackEnds ?? true} onChange={(event) => updateSource(selectedSource.id, (source) => ({ ...source, showNothingWhenPlaybackEnds: event.target.checked }))} /><span>Show nothing when playback ends</span></label>
            </>}
            {selectedSource.kind === 'slideshow' && <div className="slideshow-properties">
              <label className="device-property">Slide duration (seconds)<input aria-label="Slide duration in seconds" type="number" min="1" max="600" value={selectedSource.slideshowIntervalSeconds ?? 5} onChange={(event) => updateSource(selectedSource.id, (source) => ({ ...source, slideshowIntervalSeconds: Math.max(1, Math.min(600, Number(event.target.value) || 1)) }))} /></label>
              <label className="media-loop-property"><input type="checkbox" checked={selectedSource.slideshowLoop ?? true} onChange={(event) => updateSource(selectedSource.id, (source) => ({ ...source, slideshowLoop: event.target.checked }))} /><span>Loop</span></label>
              <div className="slideshow-list" aria-label="Slideshow images">{(selectedSource.slideshowImages ?? []).map((image, index) => <div className="slideshow-image-row" key={image.assetId}>
                <span title={image.name}>{index + 1}. {image.name}</span>
                <div><button className="mini-icon" aria-label={`Move ${image.name} up`} disabled={index === 0} onClick={() => moveSlideshowImage(selectedSource.id, index, -1)}><ChevronUp size={12} /></button><button className="mini-icon" aria-label={`Move ${image.name} down`} disabled={index === (selectedSource.slideshowImages?.length ?? 0) - 1} onClick={() => moveSlideshowImage(selectedSource.id, index, 1)}><ChevronDown size={12} /></button><button className="mini-icon danger" aria-label={`Remove ${image.name}`} disabled={(selectedSource.slideshowImages?.length ?? 0) <= 1} onClick={() => removeSlideshowImage(selectedSource.id, index)}><X size={12} /></button></div>
              </div>)}</div>
              <button className="slideshow-add-image" disabled={working || (selectedSource.slideshowImages?.length ?? 0) >= 100} onClick={() => void addSlideshowImage(selectedSource.id)}><Plus size={12} />Add Image</button>
            </div>}
            {selectedSource.kind === 'browser' && <label className="text-property">URL<input value={selectedSource.url ?? ''} readOnly title={selectedSource.url} /></label>}
            {selectedSource.kind === 'browser' && <label className="audio-filter-toggle"><input type="checkbox" checked={selectedSource.browserAudioEnabled ?? false} onChange={(event) => updateBrowserAudio(selectedSource.id, event.target.checked)} /><span>Capture Audio</span></label>}
            {meterLevels[selectedSource.id] !== undefined && <label className="volume-property"><span>Volume</span><input type="range" min="0" max="200" value={selectedSource.muted ? 0 : selectedSource.volume * 100} onChange={(event) => updateSourceSettings(selectedSource.id, { volume: Number(event.target.value) / 100, muted: false })} /><button className="mini-icon" aria-label={selectedSource.muted ? 'Unmute source' : 'Mute source'} onClick={() => updateSourceSettings(selectedSource.id, { volume: selectedSource.volume, muted: !selectedSource.muted })}>{selectedSource.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button></label>}
            {meterLevels[selectedSource.id] !== undefined && <label className="balance-property"><span>Balance</span><input aria-label="Audio balance" type="range" min="-100" max="100" value={Math.round((selectedSource.balance ?? 0) * 100)} onChange={(event) => updateSource(selectedSource.id, (source) => ({ ...source, balance: Number(event.target.value) / 100 }))} /><b>{(selectedSource.balance ?? 0) < -0.02 ? 'Left' : (selectedSource.balance ?? 0) > 0.02 ? 'Right' : 'Center'}</b></label>}
            {meterLevels[selectedSource.id] !== undefined && <label className="monitoring-property">Audio Monitoring<select aria-label="Audio monitoring" value={selectedSource.audioMonitoring ?? 'off'} onChange={(event) => updateSourceMonitoring(selectedSource.id, event.target.value as AudioMonitoring)}><option value="off">Off</option><option value="monitor-only">Monitor Only</option><option value="monitor-and-output">Monitor and Output</option></select></label>}
            {meterLevels[selectedSource.id] !== undefined && <details className="filter-details"><summary>Audio Tracks</summary>
              <div className="audio-track-grid">{AUDIO_TRACKS.map((track) => <label key={track} className="audio-track-toggle"><input type="checkbox" checked={(selectedSource.audioTracks ?? [1]).includes(track)} onChange={(event) => updateSourceAudioTrack(selectedSource.id, track, event.target.checked)} /><span>Track {track}</span></label>)}</div>
            </details>}
            {meterLevels[selectedSource.id] !== undefined && <details className="filter-details"><summary>Audio Filters</summary>
              <label className="filter-control"><span>Gain</span><input type="range" min="-30" max="30" step="0.5" value={selectedSource.audioFilters?.gainDb ?? 0} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { gainDb: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.gainDb ?? 0} dB</b></label>
              {selectedSource.kind === 'microphone' && <label className="audio-filter-toggle"><input type="checkbox" checked={selectedSource.audioFilters?.noiseSuppression ?? false} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { noiseSuppression: event.target.checked })} /><span>Neural Noise Suppression</span></label>}
              <label className="audio-filter-toggle"><input type="checkbox" checked={selectedSource.audioFilters?.noiseGate ?? false} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { noiseGate: event.target.checked })} /><span>Noise Gate</span></label>
              <label className="filter-control"><span>Gate opens</span><input type="range" min="-80" max="0" value={selectedSource.audioFilters?.noiseGateOpenThresholdDb ?? -26} disabled={!selectedSource.audioFilters?.noiseGate} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { noiseGateOpenThresholdDb: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.noiseGateOpenThresholdDb ?? -26} dB</b></label>
              <label className="filter-control"><span>Gate closes</span><input type="range" min="-80" max={selectedSource.audioFilters?.noiseGateOpenThresholdDb ?? -26} value={selectedSource.audioFilters?.noiseGateCloseThresholdDb ?? -32} disabled={!selectedSource.audioFilters?.noiseGate} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { noiseGateCloseThresholdDb: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.noiseGateCloseThresholdDb ?? -32} dB</b></label>
              <label className="filter-control"><span>Attack</span><input type="range" min="1" max="100" value={selectedSource.audioFilters?.noiseGateAttackMs ?? 10} disabled={!selectedSource.audioFilters?.noiseGate} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { noiseGateAttackMs: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.noiseGateAttackMs ?? 10} ms</b></label>
              <label className="filter-control"><span>Hold</span><input type="range" min="0" max="1000" step="10" value={selectedSource.audioFilters?.noiseGateHoldMs ?? 150} disabled={!selectedSource.audioFilters?.noiseGate} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { noiseGateHoldMs: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.noiseGateHoldMs ?? 150} ms</b></label>
              <label className="filter-control"><span>Release</span><input type="range" min="10" max="1000" step="10" value={selectedSource.audioFilters?.noiseGateReleaseMs ?? 250} disabled={!selectedSource.audioFilters?.noiseGate} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { noiseGateReleaseMs: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.noiseGateReleaseMs ?? 250} ms</b></label>
              <label className="audio-filter-toggle"><input type="checkbox" checked={selectedSource.audioFilters?.expander ?? false} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { expander: event.target.checked })} /><span>Expander</span></label>
              <label className="filter-control"><span>Threshold</span><input type="range" min="-80" max="0" value={selectedSource.audioFilters?.expanderThresholdDb ?? -40} disabled={!selectedSource.audioFilters?.expander} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { expanderThresholdDb: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.expanderThresholdDb ?? -40} dB</b></label>
              <label className="filter-control"><span>Ratio</span><input type="range" min="1" max="10" step="0.5" value={selectedSource.audioFilters?.expanderRatio ?? 2} disabled={!selectedSource.audioFilters?.expander} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { expanderRatio: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.expanderRatio ?? 2}:1</b></label>
              <label className="filter-control"><span>Attack</span><input type="range" min="1" max="100" value={selectedSource.audioFilters?.expanderAttackMs ?? 10} disabled={!selectedSource.audioFilters?.expander} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { expanderAttackMs: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.expanderAttackMs ?? 10} ms</b></label>
              <label className="filter-control"><span>Release</span><input type="range" min="10" max="1000" step="10" value={selectedSource.audioFilters?.expanderReleaseMs ?? 150} disabled={!selectedSource.audioFilters?.expander} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { expanderReleaseMs: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.expanderReleaseMs ?? 150} ms</b></label>
              <label className="audio-filter-toggle"><input type="checkbox" checked={selectedSource.audioFilters?.compressor ?? false} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { compressor: event.target.checked })} /><span>Compressor</span></label>
              <label className="filter-control"><span>Threshold</span><input type="range" min="-60" max="0" value={selectedSource.audioFilters?.compressorThresholdDb ?? -18} disabled={!selectedSource.audioFilters?.compressor} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { compressorThresholdDb: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.compressorThresholdDb ?? -18} dB</b></label>
              <label className="filter-control"><span>Ratio</span><input type="range" min="1" max="20" step="1" value={selectedSource.audioFilters?.compressorRatio ?? 4} disabled={!selectedSource.audioFilters?.compressor} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { compressorRatio: Number(event.target.value) })} /><b>{selectedSource.audioFilters?.compressorRatio ?? 4}:1</b></label>
              <label className="audio-filter-toggle"><input type="checkbox" checked={selectedSource.audioFilters?.limiter ?? false} onChange={(event) => updateSourceAudioFilters(selectedSource.id, { limiter: event.target.checked })} /><span>Limiter</span></label>
            </details>}
            <details className="filter-details"><summary>Color Correction</summary>
              <label className="filter-control"><span>Brightness</span><input type="range" min="0" max="200" value={selectedFilters.brightness} onChange={(event) => updateSourceFilters(selectedSource.id, { brightness: Number(event.target.value) })} /><b>{selectedFilters.brightness}%</b></label>
              <label className="filter-control"><span>Contrast</span><input type="range" min="0" max="200" value={selectedFilters.contrast} onChange={(event) => updateSourceFilters(selectedSource.id, { contrast: Number(event.target.value) })} /><b>{selectedFilters.contrast}%</b></label>
              <label className="filter-control"><span>Saturation</span><input type="range" min="0" max="200" value={selectedFilters.saturation} onChange={(event) => updateSourceFilters(selectedSource.id, { saturation: Number(event.target.value) })} /><b>{selectedFilters.saturation}%</b></label>
              <label className="filter-control"><span>Opacity</span><input type="range" min="0" max="100" value={selectedFilters.opacity} onChange={(event) => updateSourceFilters(selectedSource.id, { opacity: Number(event.target.value) })} /><b>{selectedFilters.opacity}%</b></label>
              <label className="filter-control"><span>Blur</span><input type="range" min="0" max="20" value={selectedFilters.blur} onChange={(event) => updateSourceFilters(selectedSource.id, { blur: Number(event.target.value) })} /><b>{selectedFilters.blur}px</b></label>
            </details>
            {supportsChromaKey(selectedSource) && <details className="filter-details"><summary>Crop</summary>
              <label className="crop-control"><span>Top</span><input type="number" min="0" max="16384" step="1" value={selectedCrop.top} onChange={(event) => updateSourceCrop(selectedSource.id, { top: Math.max(0, Math.min(16384, Math.trunc(Number(event.target.value) || 0))) })} /><b>px</b></label>
              <label className="crop-control"><span>Right</span><input type="number" min="0" max="16384" step="1" value={selectedCrop.right} onChange={(event) => updateSourceCrop(selectedSource.id, { right: Math.max(0, Math.min(16384, Math.trunc(Number(event.target.value) || 0))) })} /><b>px</b></label>
              <label className="crop-control"><span>Bottom</span><input type="number" min="0" max="16384" step="1" value={selectedCrop.bottom} onChange={(event) => updateSourceCrop(selectedSource.id, { bottom: Math.max(0, Math.min(16384, Math.trunc(Number(event.target.value) || 0))) })} /><b>px</b></label>
              <label className="crop-control"><span>Left</span><input type="number" min="0" max="16384" step="1" value={selectedCrop.left} onChange={(event) => updateSourceCrop(selectedSource.id, { left: Math.max(0, Math.min(16384, Math.trunc(Number(event.target.value) || 0))) })} /><b>px</b></label>
            </details>}
            {supportsChromaKey(selectedSource) && <details className="filter-details"><summary>Chroma Key</summary>
              <label className="audio-filter-toggle"><input type="checkbox" checked={selectedChromaKey.enabled} onChange={(event) => updateSourceChromaKey(selectedSource.id, { enabled: event.target.checked })} /><span>Enable</span></label>
              <label className="color-property"><span>Key Color</span><input type="color" value={selectedChromaKey.keyColor} onChange={(event) => updateSourceChromaKey(selectedSource.id, { keyColor: event.target.value })} /></label>
              <label className="filter-control"><span>Similarity</span><input type="range" min="0" max="100" value={selectedChromaKey.similarity} disabled={!selectedChromaKey.enabled} onChange={(event) => updateSourceChromaKey(selectedSource.id, { similarity: Number(event.target.value) })} /><b>{selectedChromaKey.similarity}</b></label>
              <label className="filter-control"><span>Smoothness</span><input type="range" min="0" max="100" value={selectedChromaKey.smoothness} disabled={!selectedChromaKey.enabled} onChange={(event) => updateSourceChromaKey(selectedSource.id, { smoothness: Number(event.target.value) })} /><b>{selectedChromaKey.smoothness}</b></label>
            </details>}
          </div>}
        </section>

        <section className="dock mixer-dock">
          <div className="dock-title"><span>Audio Mixer</span><span className="meter-scale">−60&nbsp; &nbsp; −20&nbsp; &nbsp; 0 dB</span><button className="mini-icon" aria-label="Audio settings" onClick={openSettings}><Settings2 size={14} /></button></div>
          {activeScene.sources.filter((source) => meterLevels[source.id] !== undefined).length === 0
            ? <div className="mixer-empty"><AudioLines size={20} /><span>Add a microphone or capture source with system audio.</span></div>
            : <div className="mixer-channels">{activeScene.sources.filter((source) => meterLevels[source.id] !== undefined).map((source) => {
              const level = meterLevels[source.id] ?? 0;
              const width = Math.max(0, Math.min(100, level * 100));
              return <div className="mixer-channel" key={source.id}>
                <div className="channel-top"><span className="channel-icon">{sourceIcon(source.kind, source.mediaKind)}</span><span className="channel-name" title={source.name}>{source.name}</span><button className="channel-mute" title={source.muted ? 'Unmute' : 'Mute'} onClick={() => updateSourceSettings(source.id, { volume: source.volume, muted: !source.muted })}>{source.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}</button></div>
                <div className="meter-track"><div className="meter-fill" style={{ width: `${width}%` }} /><span className="meter-yellow" /><span className="meter-red" /></div>
                <input aria-label={`${source.name} volume`} type="range" min="0" max="200" value={source.muted ? 0 : source.volume * 100} onChange={(event) => updateSourceSettings(source.id, { volume: Number(event.target.value) / 100, muted: false })} />
                <div className="channel-db"><span>{source.muted ? 'Muted' : `${Math.round(20 * Math.log10(Math.max(0.0001, source.volume)) * 10) / 10} dB`}</span><span>{Math.round(width)}%</span></div>
              </div>;
            })}</div>}
        </section>

      </section>

      <footer className="statusbar"><div className="status-left"><span className="status-indicator" /><span>Ready</span>{working && <span className="status-busy">Working…</span>}</div><div className="status-center">{actionError && <span className={actionError.startsWith('Saved ') ? 'notice' : 'error'}>{actionError}</span>}</div><div className="status-right"><span>Canvas {project.output.baseWidth} × {project.output.baseHeight}</span><span className="status-divider" /><span>Output {project.output.width} × {project.output.height}</span><span className="status-divider" /><span>{project.output.frameRate} FPS</span></div></footer>

      {sceneDialog && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSceneDialog(null); }}>
        <section className="capture-modal scene-modal" role="dialog" aria-modal="true" aria-labelledby="scene-dialog-title">
          <div className="modal-heading"><div><span className="modal-eyebrow">SCENE</span><h2 id="scene-dialog-title">{sceneDialog === 'rename' ? 'Rename Scene' : 'Delete Scene'}</h2></div><button className="icon-button" aria-label="Close" onClick={() => setSceneDialog(null)}><X size={17} /></button></div>
          {sceneDialog === 'rename' ? <form onSubmit={(event) => { event.preventDefault(); renameActiveScene(); }}>
            <div className="stream-form-fields"><label>Name<input autoFocus maxLength={120} value={sceneNameDraft} onChange={(event) => setSceneNameDraft(event.target.value)} required /></label></div>
            <div className="modal-footer"><button className="secondary-button" type="button" onClick={() => setSceneDialog(null)}>Cancel</button><button className="primary-button" type="submit">Save</button></div>
          </form> : <>
            <div className="scene-delete-copy">Delete “{activeScene.name}” and remove its sources from this scene collection?</div>
            <div className="modal-footer"><button className="secondary-button" onClick={() => setSceneDialog(null)}>Cancel</button><button className="primary-button danger-button" onClick={deleteActiveScene}>Delete Scene</button></div>
          </>}
        </section>
      </div>}

      {collectionDialog && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) setCollectionDialog(null); }}>
        <section className="capture-modal scene-modal" role="dialog" aria-modal="true" aria-labelledby="collection-dialog-title">
          <div className="modal-heading"><div><span className="modal-eyebrow">SCENE COLLECTION</span><h2 id="collection-dialog-title">{collectionDialog === 'new' ? 'New Collection' : collectionDialog === 'duplicate' ? 'Duplicate Collection' : collectionDialog === 'rename' ? 'Rename Collection' : 'Delete Collection'}</h2></div><button className="icon-button" aria-label="Close" disabled={working} onClick={() => setCollectionDialog(null)}><X size={17} /></button></div>
          {collectionDialog === 'delete' ? <>
            <div className="scene-delete-copy">Delete “{activeCollection?.name}”? Its scene collection will be removed. Imported media remains available to other collections.</div>
            {collectionError && <p className="collection-error" role="alert">{collectionError}</p>}
            <div className="modal-footer"><button className="secondary-button" disabled={working} onClick={() => setCollectionDialog(null)}>Cancel</button><button className="primary-button danger-button" disabled={working || collections.length <= 1} onClick={() => void submitCollectionDialog()}>{working ? 'Deleting…' : 'Delete Collection'}</button></div>
          </> : <form onSubmit={(event) => { event.preventDefault(); void submitCollectionDialog(); }}>
            <div className="stream-form-fields"><label>Name<input autoFocus maxLength={80} value={collectionNameDraft} onChange={(event) => setCollectionNameDraft(event.target.value)} required /></label></div>
            {collectionError && <p className="collection-error" role="alert">{collectionError}</p>}
            <div className="modal-footer"><button className="secondary-button" type="button" disabled={working} onClick={() => setCollectionDialog(null)}>Cancel</button><button className="primary-button" type="submit" disabled={working}>{working ? 'Saving…' : 'Save'}</button></div>
          </form>}
        </section>
      </div>}

      {profileDialog && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) setProfileDialog(null); }}>
        <section className="capture-modal scene-modal" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title">
          <div className="modal-heading"><div><span className="modal-eyebrow">OUTPUT PROFILE</span><h2 id="profile-dialog-title">{profileDialog === 'new' ? 'New Profile' : profileDialog === 'duplicate' ? 'Duplicate Profile' : profileDialog === 'rename' ? 'Rename Profile' : 'Delete Profile'}</h2></div><button className="icon-button" aria-label="Close" disabled={working} onClick={() => setProfileDialog(null)}><X size={17} /></button></div>
          {profileDialog === 'delete' ? <>
            <div className="scene-delete-copy">Delete “{activeProfile?.name}”? Output settings and hotkeys saved in this profile will be removed.</div>
            {profileError && <p className="collection-error" role="alert">{profileError}</p>}
            <div className="modal-footer"><button className="secondary-button" disabled={working} onClick={() => setProfileDialog(null)}>Cancel</button><button className="primary-button danger-button" disabled={working || profiles.length <= 1} onClick={() => void submitProfileDialog()}>{working ? 'Deleting…' : 'Delete Profile'}</button></div>
          </> : <form onSubmit={(event) => { event.preventDefault(); void submitProfileDialog(); }}>
            <div className="stream-form-fields"><label>Name<input autoFocus maxLength={80} value={profileNameDraft} onChange={(event) => setProfileNameDraft(event.target.value)} required /></label></div>
            {profileError && <p className="collection-error" role="alert">{profileError}</p>}
            <div className="modal-footer"><button className="secondary-button" type="button" disabled={working} onClick={() => setProfileDialog(null)}>Cancel</button><button className="primary-button" type="submit" disabled={working}>{working ? 'Saving…' : 'Save'}</button></div>
          </form>}
        </section>
      </div>}

      {browserDialogOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setBrowserDialogOpen(false); }}>
        <section className="capture-modal stream-modal" role="dialog" aria-modal="true" aria-labelledby="browser-title">
          <div className="modal-heading"><div><span className="modal-eyebrow">NEW SOURCE</span><h2 id="browser-title">Browser Source</h2></div><button className="icon-button" aria-label="Close" onClick={() => setBrowserDialogOpen(false)}><X size={17} /></button></div>
          <form onSubmit={(event) => { event.preventDefault(); addBrowserSource(); }}>
            <div className="stream-form-fields"><label>URL<input autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="https://example.com" value={browserUrl} onChange={(event) => setBrowserUrl(event.target.value)} required /></label></div>
            <div className="modal-footer"><button className="secondary-button" type="button" onClick={() => setBrowserDialogOpen(false)}>Cancel</button><button className="primary-button" type="submit">Add Source</button></div>
          </form>
        </section>
      </div>}

      {streamDialogOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) setStreamDialogOpen(false); }}>
        <section className="capture-modal stream-modal" role="dialog" aria-modal="true" aria-labelledby="stream-title">
          <div className="modal-heading"><div><span className="modal-eyebrow">LIVE OUTPUT</span><h2 id="stream-title">Stream settings</h2></div><button className="icon-button" aria-label="Close" disabled={working} onClick={() => setStreamDialogOpen(false)}><X size={17} /></button></div>
          <form onSubmit={(event) => { event.preventDefault(); void startStreaming(); }}>
            <div className="stream-form-fields">
              <label>Server URL<input autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="RTMP(S) URL, srt://host:port, or rist://host:port" value={streamDestination} onChange={(event) => setStreamDestination(event.target.value)} required /></label>
              <div className="stream-bitrate-grid">
                <label>Video bitrate<input type="number" min="250" max="50000" step="250" disabled={project.output.streamRateControl === 'quality'} value={project.output.streamVideoBitrateKbps} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, streamVideoBitrateKbps: Math.max(250, Math.min(50000, Math.round(Number(event.target.value) || 250))) } }))} required /><span>kb/s</span></label>
                <label>Audio bitrate<input type="number" min="32" max="320" step="16" value={project.output.streamAudioBitrateKbps} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, streamAudioBitrateKbps: Math.max(32, Math.min(320, Math.round(Number(event.target.value) || 32))) } }))} required /><span>kb/s</span></label>
              </div>
              <label>Audio track<select value={project.output.streamAudioTrack} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, streamAudioTrack: Number(event.target.value) as AudioTrack } }))}>{AUDIO_TRACKS.map((track) => <option key={track} value={track}>Track {track}</option>)}</select></label>
              <label>Video encoder<select value={project.output.streamVideoEncoder} onChange={(event) => {
                const encoder = event.target.value as VideoEncoderFamily;
                setProjectValue((current) => ({ ...current, output: {
                  ...current.output,
                  streamVideoEncoder: encoder,
                  streamRateControl: normalizeVideoRateControl(encoder, current.output.streamRateControl),
                } }));
              }}>{VIDEO_ENCODER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label>Rate control<select value={project.output.streamRateControl} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, streamRateControl: event.target.value as StreamProject['output']['streamRateControl'] } }))}>{VIDEO_RATE_CONTROL_OPTIONS.filter((option) => getVideoEncoderRateControlModes(project.output.streamVideoEncoder).includes(option.value)).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label>Encoder quality<input className="encoder-range" type="range" min="0" max="100" disabled={project.output.streamVideoEncoder === 'libopenh264'} value={project.output.streamEncoderQuality} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, streamEncoderQuality: Number(event.target.value) } }))} /><span className="range-value">{project.output.streamEncoderQuality}</span></label>
              <label>Keyframe interval (seconds)<input type="number" min="1" max="10" step="1" value={project.output.streamKeyframeIntervalSeconds} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, streamKeyframeIntervalSeconds: Math.max(1, Math.min(10, Math.round(Number(event.target.value) || 1))) } }))} /></label>
              <label className="encoder-toggle"><input type="checkbox" checked={project.output.streamHardwareEncoding} disabled={project.output.streamVideoEncoder !== 'h264_mf'} onChange={(event) => setProjectValue((current) => ({ ...current, output: { ...current.output, streamHardwareEncoding: event.target.checked } }))} /><span>Use Media Foundation hardware encoding</span></label>
            </div>
            <div className="modal-footer"><span>{project.output.width} × {project.output.height} · {project.output.frameRate} FPS</span><button className="secondary-button" type="button" disabled={working} onClick={() => setStreamDialogOpen(false)}>Cancel</button><button className="primary-button" type="submit" disabled={working}>{working ? 'Connecting…' : 'Start Streaming'}</button></div>
          </form>
        </section>
      </div>}

      {captureOptions && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setCaptureOptions(null); setCaptureKind(null); setCaptureTargetSourceId(null); } }}>
        <section className="capture-modal" role="dialog" aria-modal="true" aria-labelledby="capture-title">
          <div className="modal-heading"><div><span className="modal-eyebrow">{captureTargetSourceId ? (runtimesSnapshot.has(captureTargetSourceId) ? 'CHANGE CAPTURE' : 'RECONNECT CAPTURE') : 'NEW SOURCE'}</span><h2 id="capture-title">{captureKind === 'audio' ? 'Select a display for audio' : captureKind === 'screen' ? 'Select a display' : 'Select a window'}</h2></div><button className="icon-button" aria-label="Close" onClick={() => { setCaptureOptions(null); setCaptureKind(null); setCaptureTargetSourceId(null); }}><X size={17} /></button></div>
          <div className="capture-grid">{captureOptions.length === 0 ? <div className="capture-empty">No {captureKind === 'window' ? 'windows' : 'displays'} are available.</div> : captureOptions.map((option) => <button key={option.id} className="capture-option" disabled={working} onClick={() => void addDesktopCapture(option)}>
            <img src={option.thumbnail} alt="" /><span className="capture-option-name">{option.name}</span>
          </button>)}</div>
          {captureKind !== 'audio' && <label className="system-audio-option"><input type="checkbox" checked={includeSystemAudio} onChange={(event) => setIncludeSystemAudio(event.target.checked)} /><span>Capture system audio</span><Headphones size={15} /></label>}
          {captureKind !== 'audio' && <label className="capture-cursor-option"><span>Capture Cursor</span><select aria-label="Capture cursor" value={captureCursorMode} onChange={(event) => setCaptureCursorMode(event.target.value as CaptureCursorMode)}><option value="always">Always</option><option value="motion">Only when moving</option><option value="never">Never</option></select></label>}
          <div className="modal-footer"><button className="secondary-button" onClick={() => { setCaptureOptions(null); setCaptureKind(null); setCaptureTargetSourceId(null); }}>Cancel</button></div>
        </section>
      </div>}

      {inputDevicePicker && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) setInputDevicePicker(null); }}>
        <section className="capture-modal device-modal" role="dialog" aria-modal="true" aria-labelledby="input-device-title">
          <div className="modal-heading"><div><span className="modal-eyebrow">NEW SOURCE</span><h2 id="input-device-title">Select a {inputDevicePicker === 'camera' ? 'camera' : 'microphone'}</h2></div><button className="icon-button" aria-label="Close" disabled={working} onClick={() => setInputDevicePicker(null)}><X size={17} /></button></div>
          <div className="device-picker-list">{inputDeviceOptions[inputDevicePicker].length === 0
            ? <div className="capture-empty">No devices are available.</div>
            : inputDeviceOptions[inputDevicePicker].map((device) => <button key={device.deviceId || device.label} disabled={working} onClick={() => void chooseInputDevice(device)}><span>{device.label}</span><ChevronDown size={14} /></button>)}</div>
          <div className="modal-footer"><button className="secondary-button" disabled={working} onClick={() => setInputDevicePicker(null)}>Cancel</button></div>
        </section>
      </div>}

      {applicationAudioOptions && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) { setApplicationAudioOptions(null); setApplicationAudioTargetSourceId(null); } }}>
        <section className="capture-modal device-modal" role="dialog" aria-modal="true" aria-labelledby="application-audio-title">
          <div className="modal-heading"><div><span className="modal-eyebrow">{applicationAudioTargetSourceId ? (runtimesSnapshot.has(applicationAudioTargetSourceId) ? 'CHANGE APPLICATION' : 'RECONNECT APPLICATION') : 'NEW SOURCE'}</span><h2 id="application-audio-title">Select an application</h2></div><button className="icon-button" aria-label="Close" disabled={working} onClick={() => { setApplicationAudioOptions(null); setApplicationAudioTargetSourceId(null); }}><X size={17} /></button></div>
          <div className="device-picker-list">{applicationAudioOptions.length === 0
            ? <div className="capture-empty">No applications are available.</div>
            : applicationAudioOptions.map((application) => <button key={`${application.pid}:${application.path}`} disabled={working} onClick={() => void chooseAudioApplication(application)}><span title={`${application.path} · PID ${application.pid}`}>{application.name} · PID {application.pid}</span><ChevronDown size={14} /></button>)}</div>
          <div className="modal-footer"><button className="secondary-button" disabled={working} onClick={() => { setApplicationAudioOptions(null); setApplicationAudioTargetSourceId(null); }}>Cancel</button></div>
        </section>
      </div>}
    </main>
  );
}

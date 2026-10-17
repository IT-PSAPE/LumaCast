export type CaptureKind = 'screen' | 'window';
export type CaptureCursorMode = 'never' | 'motion' | 'always';
export type SourceKind = 'display' | 'window' | 'camera' | 'microphone' | 'desktop-audio' | 'application-audio' | 'image' | 'slideshow' | 'media' | 'browser' | 'text' | 'color' | 'group';
export type MediaKind = 'image' | 'video' | 'audio';
export type RecordingContainer = 'webm' | 'mkv' | 'mp4';
export type AudioMonitoring = 'off' | 'monitor-only' | 'monitor-and-output';
export interface StreamAudioSettings {
  monitoringDeviceId: string;
}

export interface StreamRecordingPreferences {
  directory: string;
  filenameFormat: string;
}

export function createDefaultStreamAudioSettings(): StreamAudioSettings {
  return { monitoringDeviceId: '' };
}

export function createDefaultStreamRecordingPreferences(): StreamRecordingPreferences {
  return { directory: '', filenameFormat: 'LumaStream %CCYY-%MM-%DD %hh-%mm-%ss' };
}
export const CAMERA_RESOLUTION_OPTIONS = [
  { value: 'device-default', label: 'Device Default' },
  { value: '640x360', label: '640 × 360' },
  { value: '854x480', label: '854 × 480' },
  { value: '1280x720', label: '1280 × 720' },
  { value: '1920x1080', label: '1920 × 1080' },
  { value: '2560x1440', label: '2560 × 1440' },
  { value: '3840x2160', label: '3840 × 2160' },
] as const;
export type CameraResolutionPreset = typeof CAMERA_RESOLUTION_OPTIONS[number]['value'];
export const CAMERA_FRAME_RATE_OPTIONS = [15, 24, 25, 30, 50, 60] as const;
export type CameraFrameRatePreset = typeof CAMERA_FRAME_RATE_OPTIONS[number];
export type AudioTrack = 1 | 2 | 3 | 4 | 5 | 6;
export type RecordingTrackId = 0 | AudioTrack;
export const AUDIO_TRACKS: readonly AudioTrack[] = [1, 2, 3, 4, 5, 6];
export type VideoEncoderFamily = 'h264_mf' | 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'libopenh264';
export type VideoRateControlMode = 'cbr' | 'pc_vbr' | 'u_vbr' | 'quality';

export const VIDEO_ENCODER_OPTIONS: ReadonlyArray<{ value: VideoEncoderFamily; label: string }> = [
  { value: 'h264_mf', label: 'Media Foundation' },
  { value: 'h264_nvenc', label: 'NVIDIA NVENC' },
  { value: 'h264_qsv', label: 'Intel Quick Sync' },
  { value: 'h264_amf', label: 'AMD AMF' },
  { value: 'libopenh264', label: 'OpenH264 Software' },
];

export const VIDEO_RATE_CONTROL_OPTIONS: ReadonlyArray<{ value: VideoRateControlMode; label: string }> = [
  { value: 'cbr', label: 'CBR' },
  { value: 'pc_vbr', label: 'Constrained VBR' },
  { value: 'u_vbr', label: 'Unconstrained VBR' },
  { value: 'quality', label: 'Quality-based' },
];

const VIDEO_ENCODER_RATE_CONTROLS: Record<VideoEncoderFamily, readonly VideoRateControlMode[]> = {
  h264_mf: ['cbr', 'pc_vbr', 'u_vbr', 'quality'],
  h264_nvenc: ['cbr', 'pc_vbr', 'u_vbr', 'quality'],
  h264_qsv: ['cbr', 'pc_vbr', 'u_vbr'],
  h264_amf: ['cbr', 'pc_vbr', 'u_vbr', 'quality'],
  libopenh264: ['cbr'],
};

export function isVideoEncoderFamily(value: unknown): value is VideoEncoderFamily {
  return typeof value === 'string' && Object.hasOwn(VIDEO_ENCODER_RATE_CONTROLS, value);
}

export function supportsVideoRateControl(encoder: VideoEncoderFamily, mode: VideoRateControlMode): boolean {
  return VIDEO_ENCODER_RATE_CONTROLS[encoder].includes(mode);
}

export function getVideoEncoderRateControlModes(encoder: VideoEncoderFamily): readonly VideoRateControlMode[] {
  return VIDEO_ENCODER_RATE_CONTROLS[encoder];
}

export function normalizeVideoRateControl(encoder: VideoEncoderFamily, mode: VideoRateControlMode): VideoRateControlMode {
  return supportsVideoRateControl(encoder, mode) ? mode : 'cbr';
}

export function isAudioTrack(value: unknown): value is AudioTrack {
  return Number.isInteger(value) && AUDIO_TRACKS.includes(value as AudioTrack);
}

export function normalizeAudioTracks(value: unknown): AudioTrack[] {
  if (!Array.isArray(value)) return [1];
  return [...new Set(value.filter(isAudioTrack))];
}

export interface MediaAsset {
  id: string;
  name: string;
  kind: MediaKind;
  extension: string;
}

export interface DesktopSourceOption {
  id: string;
  name: string;
  kind: CaptureKind;
  thumbnail: string;
}

export interface AudioApplicationOption {
  pid: number;
  name: string;
  path: string;
}

export interface SourceTransform {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SlideshowImage {
  assetId: string;
  assetExtension: string;
  name: string;
}

export interface SourceCrop {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface SourceFilters {
  brightness: number;
  contrast: number;
  saturation: number;
  opacity: number;
  blur: number;
}

export interface AudioFilters {
  gainDb: number;
  noiseSuppression: boolean;
  noiseGate: boolean;
  noiseGateOpenThresholdDb: number;
  noiseGateCloseThresholdDb: number;
  noiseGateAttackMs: number;
  noiseGateHoldMs: number;
  noiseGateReleaseMs: number;
  expander: boolean;
  expanderThresholdDb: number;
  expanderRatio: number;
  expanderAttackMs: number;
  expanderReleaseMs: number;
  compressor: boolean;
  compressorThresholdDb: number;
  compressorRatio: number;
  limiter: boolean;
}

export interface ChromaKeyFilter {
  enabled: boolean;
  keyColor: string;
  similarity: number;
  smoothness: number;
}

export type TextHorizontalAlignment = 'left' | 'center' | 'right';
export type TextVerticalAlignment = 'top' | 'center' | 'bottom';

export interface StreamTextStyle {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  horizontalAlignment: TextHorizontalAlignment;
  verticalAlignment: TextVerticalAlignment;
  outline: { enabled: boolean; color: string; width: number };
  shadow: { enabled: boolean; color: string; blur: number; offsetX: number; offsetY: number };
  background: { color: string; opacity: number };
}

export function createDefaultTextStyle(): StreamTextStyle {
  return {
    fontFamily: 'Segoe UI', fontSize: 48, bold: true, italic: false,
    horizontalAlignment: 'left', verticalAlignment: 'top',
    outline: { enabled: false, color: '#000000', width: 2 },
    shadow: { enabled: false, color: '#000000', blur: 4, offsetX: 2, offsetY: 2 },
    background: { color: '#000000', opacity: 0 },
  };
}

export interface StreamSource {
  id: string;
  name: string;
  kind: SourceKind;
  visible: boolean;
  locked?: boolean;
  muted: boolean;
  volume: number;
  balance?: number;
  transform: SourceTransform;
  /** Sources inside a group, kept in the scene's back-to-front stacking order. */
  children?: StreamSource[];
  crop?: SourceCrop;
  filters?: SourceFilters;
  chromaKey?: ChromaKeyFilter;
  audioFilters?: AudioFilters;
  audioMonitoring?: AudioMonitoring;
  audioTracks?: AudioTrack[];
  captureId?: string;
  applicationPath?: string;
  cursorMode?: CaptureCursorMode;
  deviceId?: string;
  cameraResolution?: CameraResolutionPreset;
  cameraFrameRate?: CameraFrameRatePreset;
  url?: string;
  browserAudioEnabled?: boolean;
  assetId?: string;
  assetExtension?: string;
  mediaKind?: MediaKind;
  loop?: boolean;
  restartPlaybackWhenActive?: boolean;
  showNothingWhenPlaybackEnds?: boolean;
  slideshowImages?: SlideshowImage[];
  slideshowIntervalSeconds?: number;
  slideshowLoop?: boolean;
  text?: string;
  textStyle?: StreamTextStyle;
  color?: string;
}

export interface StreamScene {
  id: string;
  name: string;
  sources: StreamSource[];
}

export interface StreamGlobalHotkeys {
  toggleStreaming: string;
  toggleRecording: string;
  toggleReplayBuffer: string;
  saveReplay: string;
}

export type StreamHotkeyAction = keyof StreamGlobalHotkeys | `switchScene:${string}` | `toggleSourceVisibility:${string}`;

export const DEFAULT_STREAM_GLOBAL_HOTKEYS: StreamGlobalHotkeys = {
  toggleStreaming: 'Control+Alt+F9',
  toggleRecording: 'Control+Alt+F10',
  toggleReplayBuffer: 'Control+Alt+F11',
  saveReplay: 'Control+Alt+F12',
};

export interface StreamOutputConfiguration {
  baseWidth: number;
  baseHeight: number;
  width: number;
  height: number;
  frameRate: number;
  streamVideoBitrateKbps: number;
  streamAudioBitrateKbps: number;
  streamAudioTrack: AudioTrack;
  streamRateControl: VideoRateControlMode;
  streamVideoEncoder: VideoEncoderFamily;
  streamEncoderQuality: number;
  streamHardwareEncoding: boolean;
  streamKeyframeIntervalSeconds: number;
  recordingVideoBitrateKbps: number;
  recordingAudioBitrateKbps: number;
  recordingAudioTracks: AudioTrack[];
  recordingContainer: RecordingContainer;
  recordingRateControl: VideoRateControlMode;
  recordingVideoEncoder: VideoEncoderFamily;
  recordingEncoderQuality: number;
  recordingHardwareEncoding: boolean;
  recordingKeyframeIntervalSeconds: number;
}

export interface StreamProject {
  version: 1;
  output: StreamOutputConfiguration;
  studioMode: boolean;
  activeSceneId: string;
  liveSceneId: string;
  hotkeys: StreamGlobalHotkeys;
  sceneSwitchHotkeys: Record<string, string>;
  sourceVisibilityHotkeys: Record<string, string>;
  scenes: StreamScene[];
}

export interface SceneCollectionSummary {
  id: string;
  name: string;
}

export interface StreamProfileSummary {
  id: string;
  name: string;
}

export interface StreamProfile extends StreamProfileSummary {
  output: StreamOutputConfiguration;
  hotkeys: StreamGlobalHotkeys;
}

export interface StreamProfileDocument {
  format: 'lumastream-profile';
  version: 1;
  name: string;
  output: StreamOutputConfiguration;
  hotkeys: StreamGlobalHotkeys;
}

export const MAX_STREAM_SCENE_COLLECTIONS = 100;
export const MAX_STREAM_PROFILES = 100;

export interface StreamWorkspace {
  activeCollectionId: string;
  collections: SceneCollectionSummary[];
  activeProfileId: string;
  profiles: StreamProfileSummary[];
  project: StreamProject;
}

export interface StreamOutputSettings {
  width: number;
  height: number;
  frameRate: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  rateControl: VideoRateControlMode;
  encoder: VideoEncoderFamily;
  encoderQuality: number;
  hardwareEncoding: boolean;
  keyframeIntervalSeconds: number;
}

export interface RecordingOutputSettings {
  container: RecordingContainer;
  frameRate: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  audioTracks: AudioTrack[];
  rateControl: VideoRateControlMode;
  encoder: VideoEncoderFamily;
  encoderQuality: number;
  hardwareEncoding: boolean;
  keyframeIntervalSeconds: number;
}

export interface StreamRuntimeStatus {
  state: 'connecting' | 'live' | 'stopped' | 'error';
  bitrateKbps?: number;
  message?: string;
}

export interface StreamAPI {
  loadProject(): Promise<StreamWorkspace>;
  saveProject(collectionId: string, profileId: string, project: StreamProject): Promise<void>;
  loadAudioSettings(): Promise<StreamAudioSettings>;
  saveAudioSettings(settings: StreamAudioSettings): Promise<void>;
  loadRecordingPreferences(): Promise<StreamRecordingPreferences>;
  saveRecordingFilenameFormat(filenameFormat: string): Promise<StreamRecordingPreferences>;
  chooseRecordingDirectory(): Promise<StreamRecordingPreferences | null>;
  useDefaultRecordingDirectory(): Promise<StreamRecordingPreferences>;
  createCollection(name: string, duplicateCurrent: boolean): Promise<StreamWorkspace>;
  activateCollection(id: string): Promise<StreamWorkspace>;
  renameCollection(id: string, name: string): Promise<SceneCollectionSummary[]>;
  deleteCollection(id: string): Promise<StreamWorkspace>;
  importCollection(): Promise<StreamWorkspace | null>;
  exportCollection(id: string): Promise<boolean>;
  createProfile(name: string, duplicateCurrent: boolean): Promise<StreamWorkspace>;
  activateProfile(id: string): Promise<StreamWorkspace>;
  renameProfile(id: string, name: string): Promise<StreamProfileSummary[]>;
  deleteProfile(id: string): Promise<StreamWorkspace>;
  importProfile(): Promise<StreamWorkspace | null>;
  exportProfile(id: string): Promise<boolean>;
  listDesktopSources(kind: CaptureKind): Promise<DesktopSourceOption[]>;
  prepareDesktopCapture(sourceId: string, includeSystemAudio: boolean): Promise<void>;
  listAudioApplications(): Promise<AudioApplicationOption[]>;
  startApplicationAudioCapture(sourceId: string, pid: number, applicationPath: string): Promise<void>;
  stopApplicationAudioCapture(sourceId: string): Promise<void>;
  onApplicationAudioFrame(listener: (sourceId: string, frame: ArrayBuffer | { error: string }) => void): () => void;
  importMedia(kind: MediaKind): Promise<MediaAsset | null>;
  remuxRecording(): Promise<string | null>;
  openRecording(settings: RecordingOutputSettings): Promise<{ id: string; name: string } | null>;
  writeRecordingChunk(id: string, track: RecordingTrackId, bytes: ArrayBuffer): Promise<void>;
  closeRecording(id: string): Promise<string>;
  abortRecording(id: string): Promise<void>;
  startStreaming(destination: string, settings: StreamOutputSettings): Promise<string>;
  writeStreamingChunk(id: string, bytes: ArrayBuffer): Promise<void>;
  stopStreaming(id: string): Promise<void>;
  setGlobalHotkeys(hotkeys: StreamGlobalHotkeys, sceneSwitchHotkeys: Record<string, string>, sourceVisibilityHotkeys: Record<string, string>): Promise<void>;
  onGlobalHotkey(listener: (action: StreamHotkeyAction) => void): () => void;
  onStreamStatus(listener: (status: StreamRuntimeStatus) => void): () => void;
  createBrowserSource(id: string, url: string, width: number, height: number): Promise<void>;
  getBrowserSourceAudioCaptureId(id: string): Promise<string>;
  closeBrowserSource(id: string): Promise<void>;
  onBrowserSourceFrame(listener: (id: string, frame: ArrayBuffer) => void): () => void;
}

export function mediaAssetUrl(id: string, extension: string): string {
  return `lumastream://media/${encodeURIComponent(id)}.${encodeURIComponent(extension)}`;
}

export function createDefaultProject(): StreamProject {
  const sceneId = crypto.randomUUID();
  return {
    version: 1,
    output: {
      baseWidth: 1920,
      baseHeight: 1080,
      width: 1920,
      height: 1080,
      frameRate: 30,
      streamVideoBitrateKbps: 6000,
      streamAudioBitrateKbps: 160,
      streamAudioTrack: 1,
      streamRateControl: 'cbr',
      streamVideoEncoder: 'h264_mf',
      streamEncoderQuality: 60,
      streamHardwareEncoding: false,
      streamKeyframeIntervalSeconds: 2,
      recordingVideoBitrateKbps: 8000,
      recordingAudioBitrateKbps: 160,
      recordingAudioTracks: [1],
      recordingContainer: 'webm',
      recordingRateControl: 'cbr',
      recordingVideoEncoder: 'h264_mf',
      recordingEncoderQuality: 60,
      recordingHardwareEncoding: false,
      recordingKeyframeIntervalSeconds: 2,
    },
    studioMode: false,
    activeSceneId: sceneId,
    liveSceneId: sceneId,
    hotkeys: { ...DEFAULT_STREAM_GLOBAL_HOTKEYS },
    sceneSwitchHotkeys: {},
    sourceVisibilityHotkeys: {},
    scenes: [{ id: sceneId, name: 'Scene 1', sources: [] }],
  };
}

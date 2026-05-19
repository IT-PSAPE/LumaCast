export type Id = string;

export interface Library {
  id: Id;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Playlist {
  id: Id;
  libraryId: Id;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistGroup {
  id: Id;
  playlistId: Id;
  name: string;
  colorKey: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistEntry {
  id: Id;
  groupId: Id;
  presentationId: Id | null;
  lyricId: Id | null;
  talkId: Id | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export type DeckItemType = 'presentation' | 'lyric' | 'talk';
export type ThemeKind = 'slides' | 'lyrics' | 'overlays';

interface DeckItemBase {
  id: Id;
  title: string;
  themeId?: Id | null;
  collectionId: Id;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Presentation extends DeckItemBase {
  type: 'presentation';
}

export interface Lyric extends DeckItemBase {
  type: 'lyric';
}

export interface Talk extends DeckItemBase {
  type: 'talk';
}

export type DeckItem = Presentation | Lyric | Talk;

export type SlideKind = 'presentation' | 'lyric' | 'talk' | 'theme' | 'overlay' | 'stage';

export type SlideBackgroundFit = 'cover' | 'contain' | 'fill';

export interface GradientStop {
  color: string;
  position: number; // 0–100
}

export interface SlideGradient {
  kind: 'linear' | 'radial';
  angle?: number; // degrees, linear only (measured from +x axis)
  stops: GradientStop[]; // at least 2, ordered by position
}

export type SlideBackground =
  | { type: 'color'; color: string }
  | { type: 'gradient'; gradient: SlideGradient }
  | { type: 'image'; mediaAssetId: Id | null; src: string; fit: SlideBackgroundFit }
  | { type: 'video'; mediaAssetId: Id | null; src: string; fit: SlideBackgroundFit };

export interface SlideBackgroundUpdateInput {
  slideId: Id;
  background: SlideBackground | null;
}

export interface Slide {
  id: Id;
  background?: SlideBackground | null;
  // Exactly one of the parent FKs is set; the rest are null.
  presentationId: Id | null;
  lyricId: Id | null;
  talkId: Id | null;
  themeId: Id | null;
  overlayId: Id | null;
  stageId: Id | null;
  kind: SlideKind;
  width: number;
  height: number;
  notes: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export type SlideElementType = 'text' | 'image' | 'video' | 'shape' | 'group';

export interface SlideElementBase {
  id: Id;
  slideId: Id;
  type: SlideElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  layer: 'background' | 'media' | 'content';
  createdAt: string;
  updatedAt: string;
}

export type TextHorizontalAlign = CanvasTextAlign | 'justify';
export type TextVerticalAlign = 'top' | 'middle' | 'bottom';
export type TextCaseTransform = 'none' | 'uppercase' | 'sentence';
export type StrokePosition = 'inside' | 'center' | 'outside';

export type TextBindingKind =
  | 'timer'
  | 'clock'
  | 'current-slide-text'
  | 'next-slide-text'
  | 'slide-notes'
  | 'talk-script-current'
  | 'talk-script-progress';

export type ClockFormat = '12h' | '12h-seconds' | '24h' | '24h-seconds';
export type TimerFormat = 'mm:ss' | 'hh:mm:ss';

export interface TextBinding {
  kind: TextBindingKind;
  timerDurationSeconds?: number;
  timerFormat?: TimerFormat;
  clockFormat?: ClockFormat;
}

export interface ElementVisualPayload {
  name?: string;
  visible?: boolean;
  locked?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  fillEnabled?: boolean;
  fillColor?: string;
  strokeEnabled?: boolean;
  strokeColor?: string;
  strokeWidth?: number;
  strokePosition?: StrokePosition;
  shadowEnabled?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
}

export interface TextElementPayload extends ElementVisualPayload {
  text: string;
  borderRadius?: number;
  fontFamily: string;
  fontSize: number;
  color: string;
  alignment: TextHorizontalAlign;
  verticalAlign?: TextVerticalAlign;
  autoFit?: boolean;
  autoFitMaxFontSize?: number;
  caseTransform?: TextCaseTransform;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  lineHeight?: number;
  weight?: string;
  textStrokeEnabled?: boolean;
  textStrokeColor?: string;
  textStrokeWidth?: number;
  textStrokePosition?: StrokePosition;
  textShadowEnabled?: boolean;
  textShadowColor?: string;
  textShadowBlur?: number;
  textShadowOffsetX?: number;
  textShadowOffsetY?: number;
  binding?: TextBinding;
}

export interface ImageElementPayload extends ElementVisualPayload {
  src: string;
}

export interface VideoElementPayload extends ElementVisualPayload {
  src: string;
  autoplay: boolean;
  loop: boolean;
  muted?: boolean;
  playbackRate?: number;
}

export interface ShapeElementPayload extends ElementVisualPayload {
  fillColor: string;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
}

export interface GroupElementPayload extends ElementVisualPayload {
  children: SlideElement[];
}

export type SlideElementPayload =
  | TextElementPayload
  | ImageElementPayload
  | VideoElementPayload
  | ShapeElementPayload
  | GroupElementPayload;

export interface SlideElement extends SlideElementBase {
  payload: SlideElementPayload;
}

export type MediaAssetType = 'image' | 'video' | 'audio';

export interface MediaAsset {
  id: Id;
  name: string;
  type: MediaAssetType;
  src: string;
  collectionId: Id;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export type OverlayType = 'image' | 'shape' | 'text' | 'video';

export interface OverlayAnimation {
  kind: 'none' | 'dissolve' | 'fade' | 'pulse';
  durationMs: number;
  autoClearDurationMs?: number | null;
}

export interface Overlay {
  id: Id;
  slideId: Id;
  name: string;
  enabled: boolean;
  background?: SlideBackground | null;
  elements: SlideElement[];
  animation: OverlayAnimation;
  collectionId: Id;
  createdAt: string;
  updatedAt: string;
}

export interface Theme {
  id: Id;
  slideId: Id;
  name: string;
  kind: ThemeKind;
  width: number;
  height: number;
  background?: SlideBackground | null;
  elements: SlideElement[];
  collectionId: Id;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Stage {
  id: Id;
  slideId: Id;
  name: string;
  width: number;
  height: number;
  background?: SlideBackground | null;
  elements: SlideElement[];
  collectionId: Id;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface TalkScriptBlock {
  id: Id;
  slideId: Id;
  text: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export type CollectionBinKind = 'deck' | 'image' | 'video' | 'audio' | 'theme' | 'overlay' | 'stage' | 'macro';

export interface Collection {
  id: Id;
  binKind: CollectionBinKind;
  name: string;
  order: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionCreateInput {
  binKind: CollectionBinKind;
  name: string;
}

export interface CollectionRenameInput {
  binKind: CollectionBinKind;
  id: Id;
  name: string;
}

export interface CollectionDeleteInput {
  binKind: CollectionBinKind;
  id: Id;
}

export interface CollectionReorderInput {
  binKind: CollectionBinKind;
  ids: Id[];
}

export type CollectionItemType =
  | 'presentation'
  | 'lyric'
  | 'talk'
  | 'media_asset'
  | 'theme'
  | 'overlay'
  | 'stage'
  | 'macro';

export interface CollectionAssignmentInput {
  itemType: CollectionItemType;
  itemId: Id;
  collectionId: Id;
}

export interface DeckBundleTheme {
  id: Id;
  name: string;
  kind: ThemeKind;
  width: number;
  height: number;
  order: number;
  elements: SlideElement[];
}

export interface DeckBundleSlide {
  id: Id;
  width: number;
  height: number;
  notes: string;
  order: number;
  elements: SlideElement[];
  scriptBlocks?: DeckBundleTalkScriptBlock[];
}

export interface DeckBundleTalkScriptBlock {
  id: Id;
  text: string;
  order: number;
}

export interface DeckBundleItem {
  id: Id;
  type: DeckItemType;
  title: string;
  themeId: Id | null;
  order: number;
  slides: DeckBundleSlide[];
}

export interface DeckBundleMediaReference {
  source: string;
  elementTypes: Array<'image' | 'video'>;
  occurrenceCount: number;
}

export interface DeckBundleStage {
  id: Id;
  name: string;
  width: number;
  height: number;
  order: number;
  elements: SlideElement[];
}

export interface DeckBundleOverlay {
  id: Id;
  name: string;
  type: OverlayType;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  zIndex: number;
  enabled: boolean;
  elements: SlideElement[];
  animation: OverlayAnimation;
}

export interface DeckBundlePlaylistEntry {
  id: Id;
  presentationId: Id | null;
  lyricId: Id | null;
  talkId?: Id | null;
  order: number;
}

export interface DeckBundlePlaylistGroup {
  id: Id;
  name: string;
  colorKey: string | null;
  order: number;
  entries: DeckBundlePlaylistEntry[];
}

export interface DeckBundlePlaylist {
  id: Id;
  name: string;
  libraryName: string;
  order: number;
  groups: DeckBundlePlaylistGroup[];
}

export interface DeckBundleManifest {
  format: 'cast-deck-bundle';
  version: 1;
  exportedAt: string;
  items: DeckBundleItem[];
  themes: DeckBundleTheme[];
  mediaReferences: DeckBundleMediaReference[];
  overlays?: DeckBundleOverlay[];
  stages?: DeckBundleStage[];
  playlists?: DeckBundlePlaylist[];
}

export interface DeckBundleExportOptions {
  includeAllThemes?: boolean;
  includeOverlays?: boolean;
  includeStages?: boolean;
  playlistIds?: Id[];
}

export interface DeckBundleInspectionItem {
  id: Id;
  title: string;
  type: DeckItemType;
  slideCount: number;
  themeId: Id | null;
}

export interface DeckBundleInspectionTheme {
  id: Id;
  name: string;
  kind: ThemeKind;
}

export interface DeckBundleInspectionOverlay {
  id: Id;
  name: string;
  type: OverlayType;
}

export interface DeckBundleInspectionStage {
  id: Id;
  name: string;
}

export interface DeckBundleInspectionPlaylist {
  id: Id;
  name: string;
  libraryName: string;
  groupCount: number;
  entryCount: number;
}

export interface BrokenDeckBundleReference {
  source: string;
  elementTypes: Array<'image' | 'video'>;
  occurrenceCount: number;
  itemTitles: string[];
  themeNames: string[];
  overlayNames: string[];
  stageNames: string[];
}

export interface DeckBundleInspection {
  exportedAt: string;
  itemCount: number;
  themeCount: number;
  mediaReferenceCount: number;
  overlayCount: number;
  stageCount: number;
  playlistCount: number;
  items: DeckBundleInspectionItem[];
  themes: DeckBundleInspectionTheme[];
  overlays: DeckBundleInspectionOverlay[];
  stages: DeckBundleInspectionStage[];
  playlists: DeckBundleInspectionPlaylist[];
  mediaReferences: DeckBundleMediaReference[];
  brokenReferences: BrokenDeckBundleReference[];
}

export type DeckBundleBrokenReferenceAction = 'replace' | 'remove' | 'leave';

export interface DeckBundleBrokenReferenceDecision {
  source: string;
  action: DeckBundleBrokenReferenceAction;
  replacementPath?: string;
}

export interface PlaylistTree {
  playlist: Playlist;
  groups: Array<{
    group: PlaylistGroup;
    entries: Array<{
      entry: PlaylistEntry;
      item: DeckItem;
    }>;
  }>;
}

export interface LibraryPlaylistBundle {
  library: Library;
  playlists: PlaylistTree[];
}

export type CueFailurePolicy = 'continue' | 'abort';
export type CueClearLayer = 'media' | 'video' | 'content' | 'overlay';
export type CueKind =
  | 'overlay.activate'
  | 'overlay.clear'
  | 'overlay.clearAll'
  | 'mediaLayer.set'
  | 'video.arm'
  | 'video.clear'
  | 'audio.arm'
  | 'audio.clear'
  | 'stage.set'
  | 'stage.clear'
  | 'layer.clear'
  | 'layer.clearAll'
  | 'flow.wait';
export type TriggerType = 'slide.take' | 'slide.activate';
export type TriggerBindingTargetType = 'cue' | 'macro';

export type CuePayload =
  | { overlayId: Id }
  | { assetId: Id }
  | { stageId: Id }
  | { layer: CueClearLayer }
  | { ms: number }
  | Record<string, never>;

export interface Cue {
  id: Id;
  kind: CueKind;
  payload: CuePayload;
  failurePolicy: CueFailurePolicy;
  createdAt: string;
  updatedAt: string;
}

export interface MacroCue {
  id: Id;
  macroId: Id;
  cueId: Id;
  cue: Cue;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface Macro {
  id: Id;
  name: string;
  description: string;
  collectionId: Id;
  cues: MacroCue[];
  createdAt: string;
  updatedAt: string;
}

export interface TriggerBinding {
  id: Id;
  triggerType: TriggerType;
  sourceId: Id | null;
  targetType: TriggerBindingTargetType;
  targetId: Id;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CueCreateInput {
  kind: CueKind;
  payload: CuePayload;
  failurePolicy?: CueFailurePolicy;
}

export interface CueUpdateInput {
  id: Id;
  kind?: CueKind;
  payload?: CuePayload;
  failurePolicy?: CueFailurePolicy;
}

export interface MacroCreateInput {
  name: string;
  description?: string;
  collectionId?: Id;
  cues?: Array<{
    cueId: Id;
    orderIndex: number;
  }>;
}

export interface MacroUpdateInput {
  id: Id;
  name?: string;
  description?: string;
  cues?: Array<{
    id?: Id;
    cueId: Id;
    orderIndex: number;
  }>;
}

export interface TriggerBindingCreateInput {
  triggerType: TriggerType;
  sourceId: Id | null;
  targetType: TriggerBindingTargetType;
  targetId: Id;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface AppSnapshot {
  libraries: Library[];
  libraryBundles: LibraryPlaylistBundle[];
  presentations: Presentation[];
  lyrics: Lyric[];
  talks: Talk[];
  slides: Slide[];
  talkScriptBlocks: TalkScriptBlock[];
  slideElements: SlideElement[];
  mediaAssets: MediaAsset[];
  overlays: Overlay[];
  themes: Theme[];
  stages: Stage[];
  collections: Collection[];
  cues: Cue[];
  macros: Macro[];
  triggerBindings: TriggerBinding[];
}

export interface PlaybackState {
  playlistId: Id | null;
  deckItemId: Id | null;
  slideIndex: number;
}

export type SlideBrowserMode = 'library' | 'playlist' | 'deck' | 'deck-editor';

export interface SlideCreateInput {
  presentationId?: Id | null;
  lyricId?: Id | null;
  talkId?: Id | null;
  width?: number;
  height?: number;
}

export interface TalkScriptBlockCreateInput {
  slideId: Id;
  text?: string;
  order?: number;
}

export interface TalkScriptBlockUpdateInput {
  id: Id;
  text: string;
}

export interface TalkScriptBlockOrderUpdateInput {
  id: Id;
  newOrder: number;
}

export interface SlideNotesUpdateInput {
  slideId: Id;
  notes: string;
}

export interface SlideOrderUpdateInput {
  slideId: Id;
  newOrder: number;
}

export interface ElementCreateInput {
  id?: Id;
  slideId: Id;
  type: SlideElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  zIndex?: number;
  layer?: SlideElementBase['layer'];
  payload: SlideElementPayload;
}

export interface ElementUpdateInput {
  id: Id;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  zIndex?: number;
  layer?: SlideElementBase['layer'];
  payload?: SlideElementPayload;
}

export type NdiOutputName = 'audience' | 'stage';

export interface NdiOutputState {
  audience: boolean;
  stage: boolean;
}

export type NdiSourceStatus = 'idle' | 'live';

export interface NdiOutputConfig {
  senderName: string;
  withAlpha: boolean;
}

export type NdiOutputConfigMap = Record<NdiOutputName, NdiOutputConfig>;

export interface NdiTallyState {
  onProgram: boolean;
  onPreview: boolean;
}

export interface NdiActiveSenderDiagnostics {
  senderName: string;
  width: number;
  height: number;
  withAlpha: boolean;
  asyncVideoSend: boolean;
  connectionCount: number | null;
  // Bidirectional NDI tally signal (receiver tells sender "I'm on program /
  // preview"). Null if the loaded runtime doesn't expose tally polling.
  tally: NdiTallyState | null;
  startedAtMs: number;
  performance: NdiSenderPerformanceDiagnostics;
  audio: NdiSenderAudioDiagnostics;
}

export interface NdiFrameTelemetry {
  captureDurationMs: number;
  readbackDurationMs: number;
  skippedCaptures: number;
  framesDroppedBackpressure: number;
  // Cross-process Date.now() timestamps. Each stage stamps as the frame
  // travels: renderer sets signature/capture/rendererSend; main sets
  // mainReceived and proxyForwarded; utility sets hostReceived. The native
  // send timestamp is computed inside the service and not echoed back.
  // Optional — older telemetry shapes still validate.
  signatureChangedAtMs?: number | null;
  captureStartedAtMs?: number;
  rendererSendAtMs?: number;
  mainReceivedAtMs?: number;
  proxyForwardedAtMs?: number;
  hostReceivedAtMs?: number;
}

export interface NdiPipelineStageStats {
  p50: number;
  p95: number;
  lastMs: number;
  count: number;
}

export interface NdiPipelineLatencyDiagnostics {
  // Headline numbers — the user's symptom is sender-side latency, and
  // signatureToWire is how long between a state change and bits on the wire.
  frameAgeAtWire: NdiPipelineStageStats;
  signatureToWire: NdiPipelineStageStats;
  // Per-stage spans — for attributing where time goes when the headline
  // numbers are too high.
  captureToRendererSend: NdiPipelineStageStats;
  rendererToMainIpc: NdiPipelineStageStats;
  mainHandler: NdiPipelineStageStats;
  mainToHostIpc: NdiPipelineStageStats;
  hostToNative: NdiPipelineStageStats;
}

export interface NdiSenderPerformanceDiagnostics {
  framesCaptured: number;
  framesSent: number;
  framesReplayed: number;
  framesRejected: number;
  framesSkippedNoConnections: number;
  skippedCaptures: number;
  framesDroppedBackpressure: number;
  bytesReceived: number;
  cacheCopyBytes: number;
  avgCaptureDurationMs: number;
  avgReadbackDurationMs: number;
  avgSendDurationMs: number;
  // p50/p95/p99 of send durations over the rolling window — captures
  // latency tail not visible from the average.
  p50SendDurationMs: number;
  p95SendDurationMs: number;
  p99SendDurationMs: number;
  // Standard deviation of the inter-send interval. High jitter is a
  // strong signal that something upstream (capture, IPC, GC) is stalling.
  sendIntervalJitterMs: number;
  lastFrameBytes: number;
  minFrameBytes: number;
  maxFrameBytes: number;
  blackoutFramesSent: number;
  // Stage-by-stage pipeline latency for diagnosing where sender-side time
  // is going (renderer capture → IPC → utility process → native send).
  pipeline: NdiPipelineLatencyDiagnostics;
}

export interface NdiSenderAudioDiagnostics {
  audioFramesReceived: number;
  audioFramesSent: number;
  audioFramesRejected: number;
  audioSamplesSent: number;
  audioSilenceFramesSent: number;
  lastSampleRate: number;
  lastChannels: number;
}

export interface NdiDiagnostics {
  outputState: NdiOutputState;
  outputConfig: NdiOutputConfig;
  outputConfigs: NdiOutputConfigMap;
  runtimeLoaded: boolean;
  runtimePath: string | null;
  activeSender: NdiActiveSenderDiagnostics | null;
  senders: Record<NdiOutputName, NdiActiveSenderDiagnostics | null>;
  sourceStatus: NdiSourceStatus;
  lastError: string | null;
}

export interface OverlayCreateInput {
  name: string;
  elements?: SlideElement[];
  animation?: OverlayAnimation;
  collectionId?: Id;
}

export interface OverlayUpdateInput {
  id: Id;
  name?: string;
  elements?: SlideElement[];
  animation?: OverlayAnimation;
}

export interface ThemeCreateInput {
  name: string;
  kind: ThemeKind;
  width?: number;
  height?: number;
  elements?: SlideElement[];
  collectionId?: Id;
}

export interface ThemeUpdateInput {
  id: Id;
  name?: string;
  kind?: ThemeKind;
  width?: number;
  height?: number;
  elements?: SlideElement[];
}

export interface StageCreateInput {
  name: string;
  width?: number;
  height?: number;
  elements?: SlideElement[];
  collectionId?: Id;
}

export interface StageUpdateInput {
  id: Id;
  name?: string;
  width?: number;
  height?: number;
  elements?: SlideElement[];
}

export interface MediaAssetCreateInput {
  name: string;
  type: MediaAssetType;
  src: string;
  collectionId?: Id;
}

export interface SystemProcessMetrics {
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  cpuPercent: number;
}

export interface SystemMetricsSnapshot {
  capturedAtMs: number;
  uptimeSeconds: number;
  main: SystemProcessMetrics;
}

export interface LogSessionSummary {
  path: string;
  fileName: string;
  sizeBytes: number;
  modifiedAtMs: number;
  isCurrent: boolean;
}

export interface LogReadResult {
  totalBytes: number;
  // Byte offset returned to the caller for incremental reads. Pass back as
  // `offset` to fetch the next chunk after `lines`.
  nextOffset: number;
  lines: string[];
}

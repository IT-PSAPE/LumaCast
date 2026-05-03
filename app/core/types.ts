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

export interface PlaylistSegment {
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
  segmentId: Id;
  presentationId: Id | null;
  lyricId: Id | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export type DeckItemType = 'presentation' | 'lyric';
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

export type DeckItem = Presentation | Lyric;

export type SlideKind = 'presentation' | 'lyric' | 'theme' | 'overlay' | 'stage';

export interface Slide {
  id: Id;
  // Exactly one of the parent FKs is set; the rest are null.
  presentationId: Id | null;
  lyricId: Id | null;
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
  | 'slide-notes';

export type ClockFormat = '12h' | '12h-seconds' | '24h' | '24h-seconds';
export type TimerFormat = 'mm:ss' | 'hh:mm:ss';

export interface TextBinding {
  kind: TextBindingKind;
  timerDurationSeconds?: number;
  timerFormat?: TimerFormat;
  clockFormat?: ClockFormat;
}

export interface ElementVisualPayload {
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
  elements: SlideElement[];
  collectionId: Id;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export type CollectionBinKind = 'deck' | 'image' | 'video' | 'audio' | 'theme' | 'overlay' | 'stage';

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
  | 'media_asset'
  | 'theme'
  | 'overlay'
  | 'stage';

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

export interface DeckBundleManifest {
  format: 'cast-deck-bundle';
  version: 1;
  exportedAt: string;
  items: DeckBundleItem[];
  themes: DeckBundleTheme[];
  mediaReferences: DeckBundleMediaReference[];
  overlays?: DeckBundleOverlay[];
  stages?: DeckBundleStage[];
}

export interface DeckBundleExportOptions {
  includeAllThemes?: boolean;
  includeOverlays?: boolean;
  includeStages?: boolean;
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
  items: DeckBundleInspectionItem[];
  themes: DeckBundleInspectionTheme[];
  overlays: DeckBundleInspectionOverlay[];
  stages: DeckBundleInspectionStage[];
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
  segments: Array<{
    segment: PlaylistSegment;
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

export interface AppSnapshot {
  libraries: Library[];
  libraryBundles: LibraryPlaylistBundle[];
  presentations: Presentation[];
  lyrics: Lyric[];
  slides: Slide[];
  slideElements: SlideElement[];
  mediaAssets: MediaAsset[];
  overlays: Overlay[];
  themes: Theme[];
  stages: Stage[];
  collections: Collection[];
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
  width?: number;
  height?: number;
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

export interface NdiActiveSenderDiagnostics {
  senderName: string;
  width: number;
  height: number;
  withAlpha: boolean;
  asyncVideoSend: boolean;
  connectionCount: number | null;
  performance: NdiSenderPerformanceDiagnostics;
}

export interface NdiFrameTelemetry {
  captureDurationMs: number;
  readbackDurationMs: number;
  skippedCaptures: number;
  heartbeatCaptures: number;
}

export interface NdiSenderPerformanceDiagnostics {
  framesCaptured: number;
  framesSent: number;
  framesReplayed: number;
  framesRejected: number;
  framesSkippedNoConnections: number;
  skippedCaptures: number;
  heartbeatCaptures: number;
  bytesReceived: number;
  cacheCopyBytes: number;
  avgCaptureDurationMs: number;
  avgReadbackDurationMs: number;
  avgSendDurationMs: number;
  lastFrameBytes: number;
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

import type { Id } from '@lumacast/kernel';
import type {
  ItemType,
  ItemRef,
  LyricBlankSlideMode,
  ThemeOwnerType,
  Presentation,
  Lyric,
  Slide,
  SlideKind,
  SlideBackgroundSource,
  SlideBackgroundFit,
  SlideElement,
  TextElementPayload,
  ImageElementPayload,
  VideoElementPayload,
  ShapeElementPayload,
  GroupElementPayload,
  SlideTag,
  MediaAsset,
  MediaAssetType,
  OverlayType,
  Overlay,
  OverlayAnimation,
  PresentationTheme,
  LyricTheme,
  OverlayTheme,
  Stage,
  Playlist,
  PlaylistRow,
  Timer,
} from '@lumacast/composition';
import type { Cue, Macro, PlaybackSchedule, TriggerBinding } from '@lumacast/automation';
import type { BundleMediaReference } from './deck-bundle-manifest';

// ---------------------------------------------------------------------------
// RPC query/result shapes (issue #154, parent #116): the return-value side of
// `RpcMethodSignatures` (app/core/ipc.ts) that isn't itself a domain entity
// array — full-state snapshots, deck-bundle inspection summaries, and the
// broken-reference reconciliation shapes surfaced by deck-bundle import.
// Kept separate from `rpc-inputs.ts` (the argument side of the same
// operations) and from `deck-bundle-manifest.ts` (the on-disk file format
// these inspection shapes summarize, not reuse).
// ---------------------------------------------------------------------------

/**
 * Full application state (issue #151). This type is genuinely dual-natured
 * and load-bearing across three zones, not just an ordinary RPC result:
 *
 * - It is the wire payload of `getSnapshot`/`restoreFromSnapshot`, and nests
 *   inside `finalizeImportBundle`'s return and `ProjectRestoreResult.snapshot`
 *   (app/core/ipc.ts) — this is why it is classified as an IPC contract
 *   rather than an application-only type.
 * - `app/database/store.ts` also uses it as its own native full-application-
 *   state representation for undo/redo bookkeeping (snapshot diffing).
 * - The renderer holds it as cached application state.
 *
 * Its wire use is what forces the shape (hence its home here), but changing
 * this type also changes the database layer's undo representation and the
 * renderer's cache — treat it accordingly.
 *
 * #219 item-model refactor decisions D3/D4/D2/D5: `libraries`,
 * `libraryBundles`, and `collections` are gone (no library or collection
 * concept survives anywhere on the wire); `themes` splits into three
 * per-owner arrays; playlists ship as flat, ordinary tables
 * (`playlists`/`playlistEntries`) instead of a derived tree — any tree the
 * renderer needs is derived client-side, not carried on the wire.
 */
export interface AppSnapshot {
  presentations: Presentation[];
  lyrics: Lyric[];
  slides: Slide[];
  slideElements: SlideElement[];
  mediaAssets: MediaAsset[];
  overlays: Overlay[];
  presentationThemes: PresentationTheme[];
  lyricThemes: LyricTheme[];
  overlayThemes: OverlayTheme[];
  stages: Stage[];
  playlists: Playlist[];
  playlistEntries: PlaylistRow[];
  cues: Cue[];
  macros: Macro[];
  triggerBindings: TriggerBinding[];
  playbackSchedules?: PlaybackSchedule[];
  slideTags?: SlideTag[];
  timers?: Timer[];
}

export interface BundleInspectionItem {
  id: Id;
  title: string;
  type: ItemType;
  slideCount: number;
  themeId: Id | null;
}

export interface BundleInspectionTheme {
  id: Id;
  name: string;
  themeType: ThemeOwnerType;
}

export interface BundleInspectionOverlay {
  id: Id;
  name: string;
  type: OverlayType;
}

export interface BundleInspectionStage {
  id: Id;
  name: string;
}

export interface BundleInspectionPlaylist {
  id: Id;
  name: string;
  separatorCount: number;
  entryCount: number;
}

export interface BrokenBundleReference {
  source: string;
  elementTypes: Array<'image' | 'video'>;
  occurrenceCount: number;
  itemTitles: string[];
  themeNames: string[];
  overlayNames: string[];
  stageNames: string[];
}

export interface BundleInspection {
  exportedAt: string;
  itemCount: number;
  themeCount: number;
  mediaReferenceCount: number;
  overlayCount: number;
  stageCount: number;
  playlistCount: number;
  items: BundleInspectionItem[];
  themes: BundleInspectionTheme[];
  overlays: BundleInspectionOverlay[];
  stages: BundleInspectionStage[];
  playlists: BundleInspectionPlaylist[];
  mediaReferences: BundleMediaReference[];
  brokenReferences: BrokenBundleReference[];
}

export type BundleBrokenReferenceAction = 'replace' | 'remove' | 'leave';

export interface BundleBrokenReferenceDecision {
  source: string;
  action: BundleBrokenReferenceAction;
  replacementPath?: string;
}

// ---------------------------------------------------------------------------
// Read-projection RPC results: the return shapes of the selective,
// paginated, name-resolvable read operations that give an AI agent (or any
// other caller) an alternative to reading the whole `getSnapshot()`
// document. Every summary here deliberately omits `src`/`thumbnailSrc` —
// only stable ids cross this boundary, because a `src` string is a
// session-scoped `cast-media://` token minted by the managed-media RPC
// layer (app/main/media-capability.ts), not a durable reference a caller
// can hold onto or resolve later.
// ---------------------------------------------------------------------------

export interface PlaylistSummary {
  id: Id;
  name: string;
  order: number;
  rowCount: number;
  itemCount: number;
  separatorCount: number;
}

export interface PlaylistRowItemDetail {
  rowId: Id;
  order: number;
  kind: 'item';
  itemRef: ItemRef;
  title: string;
  slideCount: number;
}

export interface PlaylistRowSeparatorDetail {
  rowId: Id;
  order: number;
  kind: 'separator';
  label: string;
  colorKey: string | null;
}

export type PlaylistRowDetail = PlaylistRowItemDetail | PlaylistRowSeparatorDetail;

export interface PlaylistDetail {
  id: Id;
  name: string;
  order: number;
  rows: PlaylistRowDetail[];
}

export interface ItemSummary {
  ref: ItemRef;
  title: string;
  slideCount: number;
  themeId: Id | null;
  blankSlideMode?: LyricBlankSlideMode;
  playlistIds: Id[];
  updatedAt: string;
}

export interface ItemDetail {
  ref: ItemRef;
  title: string;
  themeId: Id | null;
  blankSlideMode?: LyricBlankSlideMode;
  order: number;
  createdAt: string;
  updatedAt: string;
  slides?: SlideDetail[];
}

/**
 * A slide's background, summarized: media is a resolved `assetId`, resolved
 * by matching the background's stored `src` against the media asset tables
 * — never the `src` itself. `type: 'none'` is part of the shape for callers
 * that narrow on `background.type`, but `getSlide`/`getItem` return the
 * whole field as `null` for "no background" rather than this variant (see
 * `SlideDetail.background`) since that already round-trips through the
 * persisted `SlideBackground | null` domain shape.
 */
export interface SlideBackgroundSummary {
  type: 'none' | 'color' | 'gradient' | 'image' | 'video';
  assetId: Id | null;
  fit?: SlideBackgroundFit;
}

export interface SlideElementDetailBase {
  id: Id;
  slideId: Id;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  layer: 'background' | 'media' | 'content';
  sourceThemeElementId?: Id | null;
  themeOverrideKeys?: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface TextSlideElementDetail extends SlideElementDetailBase {
  type: 'text';
  payload: TextElementPayload;
}

export interface ImageSlideElementDetail extends SlideElementDetailBase {
  type: 'image';
  payload: Omit<ImageElementPayload, 'src'> & { assetId: Id | null };
}

export interface VideoSlideElementDetail extends SlideElementDetailBase {
  type: 'video';
  payload: Omit<VideoElementPayload, 'src'> & { assetId: Id | null };
}

export interface ShapeSlideElementDetail extends SlideElementDetailBase {
  type: 'shape';
  payload: ShapeElementPayload;
}

export interface GroupSlideElementDetail extends SlideElementDetailBase {
  type: 'group';
  payload: Omit<GroupElementPayload, 'children'> & { children: SlideElementDetail[] };
}

/**
 * `SlideElement` with every image/video payload's `src` replaced by a
 * resolved `assetId` (never the stored source), recursively through group
 * children. Defined explicitly (issue: read-projection RPC surface) rather
 * than reusing `SlideElement`, since the payload shape genuinely differs at
 * this boundary.
 */
export type SlideElementDetail =
  | TextSlideElementDetail
  | ImageSlideElementDetail
  | VideoSlideElementDetail
  | ShapeSlideElementDetail
  | GroupSlideElementDetail;

export interface SlideDetail {
  id: Id;
  kind: SlideKind;
  order: number;
  /** Null for a theme/overlay/stage container slide — those are not item-owned. */
  ownerRef: ItemRef | null;
  width: number;
  height: number;
  notes: string;
  tagId: Id | null;
  backgroundSource: SlideBackgroundSource;
  background: SlideBackgroundSummary | null;
  elements?: SlideElementDetail[];
}

export interface MediaAssetSummary {
  id: Id;
  name: string;
  type: MediaAssetType;
  width: number | null;
  height: number | null;
  duration: number | null;
  /**
   * Whether a generated thumbnail derivative exists. Always `false`: the
   * thumbnail cache is a main-process, filesystem-backed concern
   * (app/main/media-derivatives.ts) never persisted to SQLite, so this
   * Electron-free repository layer has no durable signal to read it from.
   */
  hasThumbnail: boolean;
  createdAt: string;
}

export interface ThemeSummary {
  id: Id;
  ownerType: ThemeOwnerType;
  name: string;
  width: number;
  height: number;
  order: number;
  /** Always 0 for an overlay theme — overlays have no linked-item concept. */
  linkedItemCount: number;
}

export interface OverlaySummary {
  id: Id;
  name: string;
  enabled: boolean;
  order: number;
  animation: OverlayAnimation;
}

export interface StageSummary {
  id: Id;
  name: string;
  width: number;
  height: number;
  order: number;
}

export interface ProjectOverviewCounts {
  playlists: number;
  presentations: number;
  lyrics: number;
  slides: number;
  mediaAssets: number;
  themes: number;
  overlays: number;
  stages: number;
  macros: number;
  cues: number;
}

export interface ProjectOverview {
  counts: ProjectOverviewCounts;
  playlists: Array<{ id: Id; name: string }>;
  /** The 10 most recently updated items across both item tables. */
  recentItems: ItemSummary[];
  schemaVersion: number;
}

export type SearchResultKind = 'playlist' | 'item' | 'slide' | 'media' | 'theme' | 'overlay' | 'stage' | 'macro';

export interface SearchResult {
  kind: SearchResultKind;
  id: Id;
  title: string;
  snippet: string | null;
  itemRef?: ItemRef;
  slideId?: Id;
}

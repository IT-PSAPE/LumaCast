import type { Id } from '@lumacast/kernel';
import type {
  ItemType,
  ThemeOwnerType,
  Presentation,
  Lyric,
  Talk,
  Slide,
  TalkScriptBlock,
  SlideElement,
  MediaAsset,
  OverlayType,
  Overlay,
  PresentationTheme,
  LyricTheme,
  TalkTheme,
  OverlayTheme,
  Stage,
  Playlist,
  PlaylistRow,
} from '@lumacast/composition';
import type { Cue, Macro, TriggerBinding } from '@lumacast/automation';
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
 * concept survives anywhere on the wire); `themes` splits into four
 * per-owner arrays; playlists ship as flat, ordinary tables
 * (`playlists`/`playlistEntries`) instead of a derived tree — any tree the
 * renderer needs is derived client-side, not carried on the wire.
 */
export interface AppSnapshot {
  presentations: Presentation[];
  lyrics: Lyric[];
  talks: Talk[];
  slides: Slide[];
  talkScriptBlocks: TalkScriptBlock[];
  slideElements: SlideElement[];
  mediaAssets: MediaAsset[];
  overlays: Overlay[];
  presentationThemes: PresentationTheme[];
  lyricThemes: LyricTheme[];
  talkThemes: TalkTheme[];
  overlayThemes: OverlayTheme[];
  stages: Stage[];
  playlists: Playlist[];
  playlistEntries: PlaylistRow[];
  cues: Cue[];
  macros: Macro[];
  triggerBindings: TriggerBinding[];
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

import type { Id } from '@lumacast/kernel';
import type {
  Library,
  LibraryPlaylistBundle,
  DeckItemType,
  Presentation,
  Lyric,
  Talk,
  Slide,
  TalkScriptBlock,
  SlideElement,
  MediaAsset,
  OverlayType,
  Overlay,
  ThemeKind,
  Theme,
  Stage,
  Collection,
} from '@lumacast/composition';
import type { Cue, Macro, TriggerBinding } from '@lumacast/automation';
import type { DeckBundleMediaReference } from './deck-bundle-manifest';

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
 */
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

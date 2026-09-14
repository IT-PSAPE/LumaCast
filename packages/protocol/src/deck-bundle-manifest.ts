import type { Id } from '@lumacast/kernel';
import type { ItemType, LyricBlankSlideMode, SlideBackground, SlideBackgroundSource, SlideElement, OverlayType, OverlayAnimation, ThemeOwnerType } from '@lumacast/composition';

// ---------------------------------------------------------------------------
// Deck bundle manifest (issue #154, parent #116): the on-disk `.cst` archive
// file format for deck export/import (issue #147-family), decoded by
// `decodeBundleManifest` in app/contracts/codecs.ts and read/written via
// `app/main/deck-bundle-archive.ts`. This is an APPLICATION contract, not an
// IPC contract: unlike the `rpc-inputs.ts`/`rpc-results.ts` shapes, none of
// these types are ever named in `RpcMethodSignatures` (app/core/ipc.ts) —
// they round-trip through a file on disk, not through an IPC call's argument
// or return type. `app/database/store.ts` produces/consumes this shape and
// `app/core/deck-bundles.ts` type-depends on it directly, following the same
// precedent #215 set for `ProjectBackup*` (see docs/ARCHITECTURE.md,
// "Project Backup"): `app/contracts/` is the correct home because it is the
// neutral runtime-decode boundary every zone may already import (issue
// #149), and core-purity forbids `app/core` from importing `app/database`,
// which rules out `app/database/dto/` for a family core must type-depend on.
//
// Kept in its own module, separate from the RPC wire-payload shapes in
// `rpc-inputs.ts`/`rpc-results.ts`, so the file-format vs wire-payload
// distinction is visible in the import path.
//
// Manifest version 3 contains only presentations and lyrics. Playlists are
// flat rows (item entries interleaved with separators) instead of entries
// nested inside groups; items are typed by `ItemType` (there is no unified
// deck-item concept); themes are tagged by `themeType` (which of the four
// per-owner theme tables they belong to) instead of `kind`; there is no
// `libraryName` (the library concept is gone). Versions 1 and 2 remain
// import-only compatibility shapes and are normalized by discarding Talk
// content and references before callers see the current manifest.
// ---------------------------------------------------------------------------

export interface BundleTheme {
  id: Id;
  name: string;
  themeType: ThemeOwnerType;
  width: number;
  height: number;
  order: number;
  elements: SlideElement[];
}

export interface BundleSlide {
  id: Id;
  width: number;
  height: number;
  notes: string;
  order: number;
  background?: SlideBackground | null;
  backgroundSource?: SlideBackgroundSource;
  elements: SlideElement[];
}

export interface BundleItem {
  id: Id;
  type: ItemType;
  title: string;
  themeId: Id | null;
  blankSlideMode?: LyricBlankSlideMode;
  order: number;
  slides: BundleSlide[];
}

export interface BundleMediaReference {
  source: string;
  elementTypes: Array<'image' | 'video'>;
  occurrenceCount: number;
}

export interface BundleStage {
  id: Id;
  name: string;
  width: number;
  height: number;
  order: number;
  elements: SlideElement[];
}

export interface BundleOverlay {
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

// Wire format for the deck-bundle export/import file. Intentionally mirrors
// the legacy owner-column shape (not `PlaylistItemReference`) so exported
// bundles keep a stable, versioned on-disk schema; interpret and construct
// these columns only via @core/playlist-item-reference and @core/deck-bundles.
export interface BundlePlaylistItemEntry {
  id: Id;
  kind: 'item';
  presentationId: Id | null;
  lyricId: Id | null;
  order: number;
}

// The divider row (decision D5): keeps its own label and color, owns no
// item, and never nests other rows — it is a row *in* the flat playlist row
// list, not a container *around* a subset of entries.
export interface BundlePlaylistSeparator {
  id: Id;
  kind: 'separator';
  label: string;
  colorKey: string | null;
  order: number;
}

/**
 * One row of a bundle playlist's flat, ordered row list, discriminated on
 * `kind`. `@core/deck-bundles`'s `getBundlePlaylistEntryReference` must
 * only ever see a `kind: 'item'` row — discriminate on `kind` before parsing
 * a reference, never call it on a separator.
 */
export type BundlePlaylistRow = BundlePlaylistItemEntry | BundlePlaylistSeparator;

export interface BundlePlaylist {
  id: Id;
  name: string;
  order: number;
  rows: BundlePlaylistRow[];
}

export interface BundleManifest {
  format: 'cast-deck-bundle';
  version: 3;
  exportedAt: string;
  items: BundleItem[];
  themes: BundleTheme[];
  mediaReferences: BundleMediaReference[];
  overlays?: BundleOverlay[];
  stages?: BundleStage[];
  playlists?: BundlePlaylist[];
}

// ---------------------------------------------------------------------------
// Legacy v2 bundle shapes. These are accepted only at the import boundary;
// normalization discards Talk items, Talk themes, their slides/script blocks,
// and playlist rows that reference them.
// ---------------------------------------------------------------------------

export interface BundleTalkScriptBlockV2 {
  id: Id;
  text: string;
  order: number;
}

export interface BundleSlideV2 extends BundleSlide {
  scriptBlocks?: BundleTalkScriptBlockV2[];
}

export interface BundleItemV2 {
  id: Id;
  type: 'presentation' | 'lyric' | 'talk';
  title: string;
  themeId: Id | null;
  order: number;
  slides: BundleSlideV2[];
}

export interface BundleThemeV2 extends Omit<BundleTheme, 'themeType'> {
  themeType: 'presentation' | 'lyric' | 'talk' | 'overlay';
}

export interface BundlePlaylistItemEntryV2 {
  id: Id;
  kind: 'item';
  presentationId: Id | null;
  lyricId: Id | null;
  talkId: Id | null;
  order: number;
}

export type BundlePlaylistRowV2 = BundlePlaylistItemEntryV2 | BundlePlaylistSeparator;

export interface BundlePlaylistV2 extends Omit<BundlePlaylist, 'rows'> {
  rows: BundlePlaylistRowV2[];
}

export interface BundleManifestV2 {
  format: 'cast-deck-bundle';
  version: 2;
  exportedAt: string;
  items: BundleItemV2[];
  themes: BundleThemeV2[];
  mediaReferences: BundleMediaReference[];
  overlays?: BundleOverlay[];
  stages?: BundleStage[];
  playlists?: BundlePlaylistV2[];
}

// ---------------------------------------------------------------------------
// Legacy (v1) bundle manifest shapes — the pre-#219 on-disk `.cst` shape:
// entries nested inside groups, themes tagged by `kind`, and a `libraryName`
// on every playlist. `BundleOverlay`/`BundleStage` are unchanged, while v1
// items use the v2 Talk-capable legacy item shape. Kept so
// `codecs.ts`'s `decodeBundleManifest` can still decode an old file and
// `normalizeBundleManifestV1` can convert it to the current v3 shape — never
// construct one of these by hand outside that import path.
// ---------------------------------------------------------------------------

/** The v1 single-table theme `kind` domain, pre-per-owner-table split. */
export type BundleThemeKindV1 = 'slides' | 'lyrics' | 'overlays';

export interface BundleThemeV1 {
  id: Id;
  name: string;
  kind: BundleThemeKindV1;
  width: number;
  height: number;
  order: number;
  elements: SlideElement[];
}

/** The v1 playlist-entry shape: `talkId` was added later and stayed optional. */
export interface BundlePlaylistEntryV1 {
  id: Id;
  presentationId: Id | null;
  lyricId: Id | null;
  talkId?: Id | null;
  order: number;
}

export interface BundlePlaylistGroupV1 {
  id: Id;
  name: string;
  colorKey: string | null;
  order: number;
  entries: BundlePlaylistEntryV1[];
}

export interface BundlePlaylistV1 {
  id: Id;
  name: string;
  libraryName: string;
  order: number;
  groups: BundlePlaylistGroupV1[];
}

export interface BundleManifestV1 {
  format: 'cast-deck-bundle';
  version: 1;
  exportedAt: string;
  items: BundleItemV2[];
  themes: BundleThemeV1[];
  mediaReferences: BundleMediaReference[];
  overlays?: BundleOverlay[];
  stages?: BundleStage[];
  playlists?: BundlePlaylistV1[];
}

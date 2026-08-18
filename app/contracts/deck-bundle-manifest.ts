import type { Id } from '@core/domain/ids';
import type { DeckItemType } from '@core/domain/decks';
import type { SlideBackground, SlideBackgroundSource } from '@core/domain/slides';
import type { SlideElement } from '@core/domain/slide-elements';
import type { OverlayType, OverlayAnimation } from '@core/domain/overlays';
import type { ThemeKind } from '@core/domain/theme';

// ---------------------------------------------------------------------------
// Deck bundle manifest (issue #154, parent #116): the on-disk `.cst` archive
// file format for deck export/import (issue #147-family), decoded by
// `decodeDeckBundleManifest` in app/contracts/codecs.ts and read/written via
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
// ---------------------------------------------------------------------------

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
  background?: SlideBackground | null;
  backgroundSource?: SlideBackgroundSource;
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

// Wire format for the deck-bundle export/import file. Intentionally mirrors
// the legacy owner-column shape (not `PlaylistItemReference`) so exported
// bundles keep a stable, versioned on-disk schema; interpret and construct
// these columns only via @core/playlist-item-reference and @core/deck-bundles.
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

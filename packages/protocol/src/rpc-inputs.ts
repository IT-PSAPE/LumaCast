import type { Id } from '@lumacast/kernel';
import type {
  SlideBackground,
  SlideElementType,
  SlideElementBase,
  SlideElementPayload,
  SlideElement,
  SlideTagColorKey,
  ItemRef,
  ItemType,
  LyricBlankSlideMode,
  MediaAssetType,
  OverlayAnimation,
  ThemeOwnerType,
} from '@lumacast/composition';
import type {
  CueFailurePolicy,
  CueKind,
  CuePayload,
  OnScopeExit,
  ScopeLevel,
  TriggerBindingTargetType,
  TriggerType,
} from '@lumacast/automation';

// ---------------------------------------------------------------------------
// RPC mutation inputs (issue #154, parent #116): the argument shapes of the
// renderer-originated mutation operations in `RpcMethodSignatures`
// (app/core/ipc.ts). These are process-neutral wire payloads, not domain
// entities or persistence rows — app/contracts is the runtime decode
// boundary every zone may import (issue #149), and app/contracts/codecs.ts
// decodes every one of these at the main-process trust boundary (issue
// #150). Grouped here as one module (not one file per type) because they
// share exactly one concern: "what the renderer is allowed to send for a
// given mutation."
//
// #219 item-model refactor: there is no collection concept and no library
// concept left on the wire (decisions D3/D4) — every `collectionId` field
// that used to appear here is gone, not renamed.
// ---------------------------------------------------------------------------

export interface SlideBackgroundUpdateInput {
  slideId: Id;
  background: SlideBackground | null;
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
  scopeLevel?: ScopeLevel;
  onScopeExit?: OnScopeExit;
  loopEnabled?: boolean;
  loopCount?: number | null;
  cues?: Array<{
    cueId: Id;
    orderIndex: number;
    delayBeforeMs?: number;
    delayAfterMs?: number;
  }>;
}

export interface MacroUpdateInput {
  id: Id;
  name?: string;
  description?: string;
  scopeLevel?: ScopeLevel;
  onScopeExit?: OnScopeExit;
  loopEnabled?: boolean;
  loopCount?: number | null;
  cues?: Array<{
    id?: Id;
    cueId: Id;
    orderIndex: number;
    delayBeforeMs?: number;
    delayAfterMs?: number;
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

export interface SlideCreateInput {
  presentationId?: Id | null;
  lyricId?: Id | null;
  width?: number;
  height?: number;
}

export interface LyricBlankSlidesUpdateInput {
  lyricId: Id;
  mode: LyricBlankSlideMode;
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
  sourceThemeElementId?: Id | null;
  themeOverrideKeys?: string[] | null;
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
  themeOverrideKeys?: string[] | null;
}

export interface OverlayCreateInput {
  name: string;
  elements?: SlideElement[];
  animation?: OverlayAnimation;
}

export interface OverlayUpdateInput {
  id: Id;
  name?: string;
  elements?: SlideElement[];
  animation?: OverlayAnimation;
}

// #219 item-model refactor decision D2: `kind: ThemeKind` is gone along with
// the single `themes` table — `themeType` says which of the three per-owner
// theme tables (`presentation_themes`/`lyric_themes`/`overlay_themes`) this
// theme belongs to. Kept as a single wire input
// (not quadrupled per owner type) per D2's explicit wire decision; storage
// and domain stay per-table.
export interface ThemeCreateInput {
  name: string;
  themeType: ThemeOwnerType;
  width?: number;
  height?: number;
  background?: SlideBackground | null;
  elements?: SlideElement[];
}

export interface ThemeUpdateInput {
  id: Id;
  // Required (unlike the other optional update fields): the three theme
  // tables are independent id spaces, so the table an update targets cannot
  // be inferred from `id` alone.
  themeType: ThemeOwnerType;
  name?: string;
  width?: number;
  height?: number;
  background?: SlideBackground | null;
  elements?: SlideElement[];
}

export interface StageCreateInput {
  name: string;
  width?: number;
  height?: number;
  elements?: SlideElement[];
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
}

export interface BundleExportOptions {
  includeAllThemes?: boolean;
  includeOverlays?: boolean;
  includeStages?: boolean;
  playlistIds?: Id[];
}

export interface SlideTagCreateInput {
  name: string;
  colorKey: SlideTagColorKey;
}

export interface SlideTagUpdateInput {
  id: Id;
  name?: string;
  colorKey?: SlideTagColorKey;
  order?: number;
}

export interface SlideTagAssignInput {
  slideIds: Id[];
  tagId: Id | null;
}

// ---------------------------------------------------------------------------
// Read-projection RPC inputs: selective, paginated, name-resolvable reads
// alongside the mutation inputs above — before these, the only general read
// was `getSnapshot()`, returning the entire database. Decoded by the
// matching `decode*Input` functions in codecs.ts and consumed by the
// `CastRepository` read methods in @lumacast/persistence-sqlite.
// ---------------------------------------------------------------------------

export interface PlaylistGetInput {
  id: Id;
}

export interface ItemListInput {
  type?: ItemType;
  /** Case-insensitive substring match on title. */
  query?: string;
  /** Defaults to 100, capped at 500. */
  limit?: number;
  offset?: number;
}

export interface ItemGetInput {
  ref: ItemRef;
  includeSlides?: boolean;
  /** Has no effect unless `includeSlides` is also set. */
  includeElements?: boolean;
}

export interface SlideGetInput {
  slideId: Id;
  includeElements?: boolean;
}

export interface MediaAssetListInput {
  type?: MediaAssetType;
  /** Case-insensitive substring match on name. */
  query?: string;
  /** Defaults to 100, capped at 500. */
  limit?: number;
  offset?: number;
}

export interface ThemeListInput {
  ownerType?: ThemeOwnerType;
}

export interface SearchContentInput {
  query: string;
  /** Defaults to 50. */
  limit?: number;
}

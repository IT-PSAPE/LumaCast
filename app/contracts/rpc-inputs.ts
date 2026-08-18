import type { Id } from '@core/domain/ids';
import type { SlideBackground } from '@core/domain/slides';
import type { SlideElementType, SlideElementBase, SlideElementPayload, SlideElement } from '@core/domain/slide-elements';
import type { MediaAssetType } from '@core/domain/media-assets';
import type { OverlayAnimation } from '@core/domain/overlays';
import type { ThemeKind } from '@core/domain/theme';
import type { CollectionBinKind, CollectionItemType } from '@core/domain/collections';
import type {
  CueFailurePolicy,
  CueKind,
  CuePayload,
  OnScopeExit,
  ScopeLevel,
  TriggerBindingTargetType,
  TriggerType,
} from '@core/domain/automation';

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
// ---------------------------------------------------------------------------

export interface SlideBackgroundUpdateInput {
  slideId: Id;
  background: SlideBackground | null;
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

export interface CollectionAssignmentInput {
  itemType: CollectionItemType;
  itemId: Id;
  collectionId: Id;
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
  sourceThemeElementId?: Id | null;
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
  background?: SlideBackground | null;
  elements?: SlideElement[];
  collectionId?: Id;
}

export interface ThemeUpdateInput {
  id: Id;
  name?: string;
  kind?: ThemeKind;
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

export interface DeckBundleExportOptions {
  includeAllThemes?: boolean;
  includeOverlays?: boolean;
  includeStages?: boolean;
  playlistIds?: Id[];
}

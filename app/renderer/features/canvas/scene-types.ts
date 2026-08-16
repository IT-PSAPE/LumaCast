import type { Id, Slide, SlideBackgroundFit, SlideElement, StrokePosition } from '@core/types';
import type { VisualPayloadState } from '@core/element-payload';
import type { BindingOverride } from './binding-context';

export type SceneSurface = 'deck-editor' | 'show' | 'list' | 'monitor' | 'stage' | 'ndi-show' | 'ndi-stage';
export type SceneSourcePolicy = 'draft' | 'persisted' | 'live';

export type ResolvedMediaState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'broken' }
  | { status: 'loaded'; resource: HTMLImageElement | HTMLVideoElement };

export interface RenderNode {
  id: Id;
  element: SlideElement;
  visual: VisualPayloadState;
  isVideo: boolean;
  bindingOverride?: BindingOverride;
}

export interface RenderScene {
  slide: Slide;
  width: number;
  height: number;
  nodes: RenderNode[];
}

export interface GuideLine {
  points: [number, number, number, number];
  orientation: 'horizontal' | 'vertical';
}

export interface SelectionState {
  selectedIds: Id[];
  primarySelectedId: Id | null;
}

// ── Resolved render-scene contract ──────────────────────────────────────
//
// Pure, provider-independent description of a scene ready to render: every
// current node kind, background, nested groups, visibility, stable ordering,
// dimensions, surface flags, and resolved media handles. Carries no feature
// store, route, playback, IPC, or NDI references.

export type ResolvedNodeKind = 'text' | 'image' | 'video' | 'shape' | 'group';

export interface ResolvedBoxVisual {
  fillEnabled: boolean;
  fillColor: string;
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidth: number;
  borderRadius: number;
  shadowEnabled: boolean;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
}

export interface ResolvedTextVisual {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  color: string;
  alignment: 'left' | 'center' | 'right' | 'justify';
  verticalAlign: 'top' | 'middle' | 'bottom';
  lineHeight: number;
  textStrokeEnabled: boolean;
  textStrokeColor: string;
  textStrokeWidth: number;
  textStrokePosition: StrokePosition;
}

export interface ResolvedRenderNodeBase {
  id: Id;
  kind: ResolvedNodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  visible: boolean;
  locked: boolean;
  flipX: boolean;
  flipY: boolean;
  selected: boolean;
}

export interface ResolvedMediaRenderNode extends ResolvedRenderNodeBase {
  kind: 'image' | 'video';
  mediaKey: string | null;
  media: ResolvedMediaState;
}

export interface ResolvedShapeRenderNode extends ResolvedRenderNodeBase {
  kind: 'shape';
  box: ResolvedBoxVisual;
}

export interface ResolvedTextRenderNode extends ResolvedRenderNodeBase {
  kind: 'text';
  box: ResolvedBoxVisual;
  text: ResolvedTextVisual;
}

export interface ResolvedGroupRenderNode extends ResolvedRenderNodeBase {
  kind: 'group';
  children: ResolvedRenderNode[];
}

export type ResolvedRenderNode =
  | ResolvedMediaRenderNode
  | ResolvedShapeRenderNode
  | ResolvedTextRenderNode
  | ResolvedGroupRenderNode;

export type ResolvedBackground =
  | { type: 'color'; color: string }
  | { type: 'gradient'; kind: 'linear' | 'radial'; angle: number; stops: Array<{ position: number; color: string }> }
  | { type: 'image'; fit: SlideBackgroundFit; mediaKey: string; media: ResolvedMediaState }
  | { type: 'video'; fit: SlideBackgroundFit; mediaKey: string; media: ResolvedMediaState };

export interface ResolvedRenderScene {
  surface: SceneSurface;
  width: number;
  height: number;
  background: ResolvedBackground | null;
  nodes: ResolvedRenderNode[];
  interactive: boolean;
  selection: SelectionState;
}

export type MediaHandleLookup =
  | ReadonlyMap<string, ResolvedMediaState>
  | ((mediaKey: string) => ResolvedMediaState);

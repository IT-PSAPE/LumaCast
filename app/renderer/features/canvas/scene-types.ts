import type { Id, Slide, SlideElement } from '@core/types';
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

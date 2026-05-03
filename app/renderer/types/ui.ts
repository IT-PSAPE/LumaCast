import type { Id, SlideElement } from '@core/types';

export type ThemeMode = 'light' | 'dark' | 'system';
export type SlideBrowserMode = 'grid' | 'list';
export type ResourceDrawerViewMode = 'grid' | 'list';
export type PlaylistBrowserMode = 'current' | 'tabs' | 'continuous';
export type WorkbenchMode = 'show' | 'deck-editor' | 'overlay-editor' | 'theme-editor' | 'stage-editor' | 'settings';
export type InteractionMode = 'move' | 'resize';
export type DrawerTab = 'deck' | 'image' | 'themes';
export type DrawerViewModeMap = Record<DrawerTab, ResourceDrawerViewMode>;
export type InspectorTab = 'presentation' | 'slide' | 'shape' | 'text' | 'theme' | 'stage' | 'binding' | 'video';
export type LibraryPanelView = 'libraries' | 'playlist';
export type ProgramSurfaceKind = 'program' | 'monitor' | 'stage';
export type ProgramMode = 'single' | 'all';
export type ProgramGridDensity = 1 | 2;
export type SlideVisualState = 'live' | 'queued' | 'selected' | 'warning';
export type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export interface InteractionState {
  elementId: Id;
  mode: InteractionMode;
  handle: ResizeHandle | null;
  lockAspectRatio: boolean;
  aspectRatio: number;
  pointerStart: { x: number; y: number };
  elementStart: { x: number; y: number; width: number; height: number };
}

export interface ElementInspectorDraft {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
}

export const LAYER_ORDER: Record<SlideElement['layer'], number> = {
  background: 0,
  media: 1,
  content: 2,
};

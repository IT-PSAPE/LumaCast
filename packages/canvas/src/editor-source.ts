import type { Id } from '@lumacast/kernel';
import type { ItemType, Overlay, Slide, SlideBackground, SlideElement, Stage, ThemeOwnerType } from '@lumacast/composition';

export type EditorWorkbenchMode = 'item-editor' | 'overlay-editor' | 'theme-editor' | 'stage-editor';

/**
 * Structural shape shared by the four per-owner theme entities
 * (PresentationTheme/LyricTheme/TalkTheme/OverlayTheme in
 * @lumacast/composition) that this generic theme-editor source needs.
 * Importing one shared local shape rather than a union (there is no `Theme`
 * union entity — see #219 decision D2) keeps this editor contract decoupled
 * from which owner type is currently being edited; `themeType` says that.
 */
export interface EditorThemeSource {
  id: Id;
  slideId: Id;
  name: string;
  width: number;
  height: number;
  background?: SlideBackground | null;
  elements: SlideElement[];
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface EditorSourceFrame {
  width: number;
  height: number;
}

export interface EditorCreateCapabilities {
  text: boolean;
  shape: boolean;
  image: boolean;
  video: boolean;
}

interface EditorSourceBase<TMode extends string, TMeta> {
  mode: TMode;
  entityId: Id | null;
  hasSource: boolean;
  frame: EditorSourceFrame | Slide | null;
  elements: SlideElement[];
  replaceElements: (elements: SlideElement[]) => void;
  historyKey: string | null;
  emptyStateLabel: string;
  editable: boolean;
  createCapabilities: EditorCreateCapabilities;
  meta: TMeta;
}

export interface ItemEditorSource extends EditorSourceBase<'item-editor', {
  slide: Slide | null;
  slideId: Id | null;
  itemType: ItemType | null;
}> {}

export interface OverlayEditorSource extends EditorSourceBase<'overlay-editor', {
  overlay: Overlay | null;
}> {}

export interface ThemeEditorSource extends EditorSourceBase<'theme-editor', {
  theme: EditorThemeSource | null;
  themeType: ThemeOwnerType | null;
}> {}

export interface StageEditorSource extends EditorSourceBase<'stage-editor', {
  stage: Stage | null;
}> {}

// The app owns the full workbench-mode vocabulary (WorkbenchMode in
// app/renderer/types/ui.ts: 'show' | 'item-editor' | 'overlay-editor' |
// 'theme-editor' | 'stage-editor' | 'macro-editor' | 'settings'). This
// package only renders for the four editor modes above, so the
// "everything else" branch is spelled out as the residual literals here
// rather than importing the app-shell type and excluding from it — that
// keeps discriminated-union narrowing on `.mode` exact (a plain `string`
// field would make every branch's `mode === 'item-editor'` check
// ambiguous). If WorkbenchMode ever grows a mode beyond these seven, this
// literal set needs a matching update.
export interface InactiveEditorSource extends EditorSourceBase<'show' | 'macro-editor' | 'settings', {}> {}

export type ActiveEditorSource =
  | ItemEditorSource
  | OverlayEditorSource
  | ThemeEditorSource
  | StageEditorSource
  | InactiveEditorSource;

export function isEditorWorkbenchMode(mode: string): mode is EditorWorkbenchMode {
  return mode === 'item-editor' || mode === 'overlay-editor' || mode === 'theme-editor' || mode === 'stage-editor';
}

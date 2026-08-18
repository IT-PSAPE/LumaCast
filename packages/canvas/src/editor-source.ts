import type { Id } from '@lumacast/kernel';
import type { DeckItemType, Overlay, Slide, SlideElement, Stage, Theme, ThemeKind } from '@lumacast/composition';

export type EditorWorkbenchMode = 'deck-editor' | 'overlay-editor' | 'theme-editor' | 'stage-editor';

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

export interface DeckEditorSource extends EditorSourceBase<'deck-editor', {
  slide: Slide | null;
  slideId: Id | null;
  deckItemType: DeckItemType | null;
}> {}

export interface OverlayEditorSource extends EditorSourceBase<'overlay-editor', {
  overlay: Overlay | null;
}> {}

export interface ThemeEditorSource extends EditorSourceBase<'theme-editor', {
  theme: Theme | null;
  themeKind: ThemeKind | null;
}> {}

export interface StageEditorSource extends EditorSourceBase<'stage-editor', {
  stage: Stage | null;
}> {}

// The app owns the full workbench-mode vocabulary (WorkbenchMode in
// app/renderer/types/ui.ts: 'show' | 'deck-editor' | 'overlay-editor' |
// 'theme-editor' | 'stage-editor' | 'macro-editor' | 'settings'). This
// package only renders for the four editor modes above, so the
// "everything else" branch is spelled out as the residual literals here
// rather than importing the app-shell type and excluding from it — that
// keeps discriminated-union narrowing on `.mode` exact (a plain `string`
// field would make every branch's `mode === 'deck-editor'` check
// ambiguous). If WorkbenchMode ever grows a mode beyond these seven, this
// literal set needs a matching update.
export interface InactiveEditorSource extends EditorSourceBase<'show' | 'macro-editor' | 'settings', {}> {}

export type ActiveEditorSource =
  | DeckEditorSource
  | OverlayEditorSource
  | ThemeEditorSource
  | StageEditorSource
  | InactiveEditorSource;

export function isEditorWorkbenchMode(mode: string): mode is EditorWorkbenchMode {
  return mode === 'deck-editor' || mode === 'overlay-editor' || mode === 'theme-editor' || mode === 'stage-editor';
}

// Public entry point for @lumacast/canvas. The architecture checker fails
// deep imports from outside this package — anything an app-shell consumer
// needs must be re-exported here.

export type {
  EditorWorkbenchMode,
  EditorSourceFrame,
  EditorCreateCapabilities,
  EditorThemeSource,
  ItemEditorSource,
  OverlayEditorSource,
  ThemeEditorSource,
  StageEditorSource,
  InactiveEditorSource,
  ActiveEditorSource,
} from './editor-source';
export { isEditorWorkbenchMode } from './editor-source';

export type { ImageHandle, ImageCacheEntry } from './image-cache';
export { peekImageEntry, retainImage, getImageCacheStats, subscribeImageCacheStats } from './image-cache';

export { resolveInlineTextAlign, measureInlineTextHeight } from './inline-text-editor-utils';

export { resolveKonvaTextStyle } from './resolve-konva-text-style';

export type { MediaDrawRect } from './resolve-media-cover';
export { resolveMediaFit, resolveMediaCover } from './resolve-media-cover';

export { bindFixedClientRect } from './scene-node-bounds';

export type { DragSession } from './scene-stage-drag-session';
export { createDragSession } from './scene-stage-drag-session';

export type { SelectionBox } from './scene-stage-editor-utils';
export { normalizeRect, mapSnapBoxes, collectMarqueeHits } from './scene-stage-editor-utils';

export type { SnapBox, TransformSnapResult } from './snap-guides';
export { resolveSnap, resolveTransformSnap } from './snap-guides';

export {
  measureTextLineStackHeight,
  measureTextLineLayoutHeight,
  textLineBleedPadding,
  textOverflowOffset,
  computeAutoFitFontSize,
  measureTextBlockHeight,
  measureTextLayoutHeight,
  verticalTextOffset,
} from './text-layout';

export { filterAllowedSelection, useElementSelection } from './use-element-selection';

export { useImageCacheStats } from './use-image-cache-stats';

export { useKImage } from './use-k-image';

export type { VideoLayerHandle } from './use-k-video';
export { subscribeToVideoPool, getLayerVideoElement, retainVideoSource, useKVideo } from './use-k-video';

export { formatTimer, formatClock, useResolvedText } from './use-resolved-text';

export { useSceneStageDraftBuffer } from './use-scene-stage-draft-buffer';

export type { SceneStageElementsPort } from './use-scene-stage-editor';
export { useSceneStageEditor } from './use-scene-stage-editor';

export { useSceneStageMarquee } from './use-scene-stage-marquee';

export { useSceneStageShift } from './use-scene-stage-shift';

export type { SceneViewportTransform } from './use-scene-stage-viewport';
export { mapViewportPointToScene, useSceneStageViewport } from './use-scene-stage-viewport';

export type { MediaPickerAssetKind, StagePanelElementDraft, StagePanelControllerDeps } from './use-stage-panel-controller';
export { useStagePanelController } from './use-stage-panel-controller';

export type { StageViewportControllerDeps } from './use-stage-viewport-controller';
export { useStageViewportController } from './use-stage-viewport-controller';

export type { BindingValue, BindingOverride } from './binding-context';
export { BindingProvider, useBinding } from './binding-context';

export type { SceneNodeContentOptions } from './scene-node-content';
export { renderSceneNodeContent } from './scene-node-content';

export { SceneNodeMedia } from './scene-node-media';
export { SceneNodeShape } from './scene-node-shape';
export { SceneNodeText } from './scene-node-text';

export { needsOpaqueBackdrop, SceneSlideBackground } from './scene-slide-background';

import { readVisualPayload } from '@core/element-payload';
import { LAYER_PREVIEW_SLIDE, mediaAssetToLayerElement, overlayToLayerElements } from '@core/presentation-layers';
import type { MediaAsset, Overlay, Slide, SlideElement } from '@core/types';
import { sortElements } from '../../utils/slides';
import type { BindingOverride } from './binding-context';
import type { RenderNode, RenderScene } from './scene-types';

interface SceneElementInput {
  element: SlideElement;
  bindingOverride?: BindingOverride;
}

function toRenderNode({ element, bindingOverride }: SceneElementInput): RenderNode {
  return {
    id: element.id,
    element,
    visual: readVisualPayload(element.type, element.payload),
    isVideo: element.type === 'video',
    bindingOverride,
  };
}

type RenderSceneFrameInput = Pick<Slide, 'width' | 'height'> | Slide | null;

function resolveSceneSlide(frame: RenderSceneFrameInput): Slide {
  if (!frame) return LAYER_PREVIEW_SLIDE;
  if ('id' in frame && 'notes' in frame) return frame;
  return {
    ...LAYER_PREVIEW_SLIDE,
    width: frame.width,
    height: frame.height,
  };
}

function sceneSize(slide: Slide): { width: number; height: number } {
  return {
    width: Math.max(1, slide.width || 1920),
    height: Math.max(1, slide.height || 1080),
  };
}

function toPresentationLayerElement(element: SlideElement): SlideElement {
  if (element.layer === 'content') return element;
  return {
    ...element,
    layer: 'content',
  };
}

export function buildRenderScene(frame: RenderSceneFrameInput, elements: SlideElement[] | SceneElementInput[]): RenderScene {
  const nextSlide = resolveSceneSlide(frame);
  const size = sceneSize(nextSlide);
  const normalizedInputs = elements.map((entry) => ('element' in entry ? entry : { element: entry }));
  const sorted = sortElements(normalizedInputs.map((entry) => entry.element))
    .map((element) => normalizedInputs.find((entry) => entry.element === element) ?? { element })
    .map(toRenderNode);
  return { slide: nextSlide, width: size.width, height: size.height, nodes: sorted };
}

interface LayeredSceneInput {
  slide: Slide | null;
  contentElements: SlideElement[];
  videoAsset: MediaAsset | null;
  videoPlayback?: {
    autoplay?: boolean;
    loop?: boolean;
    muted?: boolean;
    playbackRate?: number;
  };
  mediaAsset: MediaAsset | null;
  overlays: Array<{
    overlay: Overlay;
    opacityMultiplier: number;
    stackOrder: number;
    startedAt: number;
  }>;
  includeContent: boolean;
}

const OVERLAY_LAYER_Z_INDEX_OFFSET = 10000;
const OVERLAY_STACK_Z_INDEX_OFFSET = 1000;

export function buildLayeredRenderScene({
  slide,
  contentElements,
  videoAsset,
  videoPlayback,
  mediaAsset,
  overlays,
  includeContent,
}: LayeredSceneInput): RenderScene {
  const merged: SceneElementInput[] = [];
  if (videoAsset) merged.push({ element: mediaAssetToLayerElement(videoAsset, {
    id: '__layer_video',
    zIndex: -1,
    videoPlayback,
  }) });
  if (mediaAsset) merged.push({ element: mediaAssetToLayerElement(mediaAsset) });
  if (includeContent) merged.push(...contentElements.map((element) => ({ element: toPresentationLayerElement(element) })));

  for (const overlayLayer of overlays) {
    if (overlayLayer.opacityMultiplier <= 0) continue;
    merged.push(...overlayToLayerElements(overlayLayer.overlay).map((element) => ({
      element: {
        ...element,
        opacity: element.opacity * overlayLayer.opacityMultiplier,
        zIndex: element.zIndex + OVERLAY_LAYER_Z_INDEX_OFFSET + (overlayLayer.stackOrder * OVERLAY_STACK_Z_INDEX_OFFSET),
      },
      bindingOverride: { armedAtMs: overlayLayer.startedAt },
    })));
  }
  return buildRenderScene(slide, merged);
}

export function buildThumbnailScene(slide: Slide, slideElements: SlideElement[]): RenderScene {
  return buildRenderScene(slide, slideElements);
}

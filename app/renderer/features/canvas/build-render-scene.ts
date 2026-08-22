import {
  readTextFormatting,
  readTextVisualPayload,
  readVisualPayload,
  type VisualPayloadState,
  LAYER_PREVIEW_SLIDE,
  LAYER_VIDEO_NODE_ID,
  mediaAssetToLayerElement,
  overlayToLayerElements,
  coerceWeight,
  type BindingOverride,
  type MediaHandleLookup,
  type RenderNode,
  type RenderScene,
  type ResolvedBackground,
  type ResolvedBoxVisual,
  type ResolvedMediaState,
  type ResolvedRenderNode,
  type ResolvedRenderNodeBase,
  type RenderSceneBackground,
  type RenderSceneSlide,
  type ResolvedRenderScene,
  type ResolvedTextVisual,
  type SceneSurface,
  type SelectionState,
} from '@lumacast/composition';
import type { GroupElementPayload, MediaAsset, Overlay, Slide, SlideBackground, SlideElement, TextCaseTransform, TextElementPayload, TextHorizontalAlign } from '@lumacast/composition';
import { sortElements } from '../../utils/slides';

interface SceneElementInput {
  element: SlideElement;
  nodeId?: string;
  bindingOverride?: BindingOverride;
}

type MediaProxyLookup =
  | ReadonlyMap<string, string | null | undefined>
  | ((mediaKey: string) => string | null | undefined);

interface BuildRenderSceneOptions {
  proxyMediaBySource?: MediaProxyLookup | null;
}

function resolveProxyMediaKey(proxyMediaBySource: MediaProxyLookup | null | undefined, mediaKey: string | null): string | null {
  if (!proxyMediaBySource || !mediaKey) return null;
  const next = typeof proxyMediaBySource === 'function'
    ? proxyMediaBySource(mediaKey)
    : proxyMediaBySource.get(mediaKey);
  return next ?? null;
}

function toRenderNode(
  { element, nodeId, bindingOverride }: SceneElementInput,
  proxyMediaBySource: MediaProxyLookup | null | undefined,
): RenderNode {
  const mediaKey = (element.type === 'image' || element.type === 'video')
    ? ((element.payload as { src?: string }).src ?? null)
    : null;
  return {
    id: nodeId ?? element.id,
    element,
    visual: readVisualPayload(element.type, element.payload),
    isVideo: element.type === 'video',
    proxyMediaKey: resolveProxyMediaKey(proxyMediaBySource, mediaKey),
    bindingOverride,
  };
}

type RenderSceneFrameInput =
  | (Pick<Slide, 'width' | 'height'> & { id?: Slide['id']; background?: SlideBackground | null })
  | Slide
  | null;

function resolveRenderSceneBackground(
  background: SlideBackground | null | undefined,
  proxyMediaBySource: MediaProxyLookup | null | undefined,
): RenderSceneBackground | null {
  if (!background) return null;
  if (background.type !== 'image' && background.type !== 'video') {
    return background;
  }
  return {
    ...background,
    proxyMediaKey: resolveProxyMediaKey(proxyMediaBySource, background.src),
  };
}

function resolveSceneSlide(
  frame: RenderSceneFrameInput,
  proxyMediaBySource: MediaProxyLookup | null | undefined,
): RenderSceneSlide {
  if (!frame) return LAYER_PREVIEW_SLIDE;
  if ('id' in frame && 'notes' in frame) {
    return {
      ...frame,
      background: resolveRenderSceneBackground(frame.background ?? null, proxyMediaBySource),
    };
  }
  return {
    ...LAYER_PREVIEW_SLIDE,
    id: 'id' in frame && frame.id ? frame.id : LAYER_PREVIEW_SLIDE.id,
    width: frame.width,
    height: frame.height,
    background: 'background' in frame ? resolveRenderSceneBackground(frame.background ?? null, proxyMediaBySource) : null,
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

function firstInputByElement(inputs: SceneElementInput[]): Map<SlideElement, SceneElementInput> {
  const byElement = new Map<SlideElement, SceneElementInput>();
  for (const entry of inputs) {
    if (!byElement.has(entry.element)) {
      byElement.set(entry.element, entry);
    }
  }
  return byElement;
}

export function buildRenderScene(
  frame: RenderSceneFrameInput,
  elements: SlideElement[] | SceneElementInput[],
  options: BuildRenderSceneOptions = {},
): RenderScene {
  const nextSlide = resolveSceneSlide(frame, options.proxyMediaBySource ?? null);
  const size = sceneSize(nextSlide);
  const normalizedInputs = elements.map((entry) => ('element' in entry ? entry : { element: entry }));
  const inputsByElement = firstInputByElement(normalizedInputs);
  const sorted = sortElements(normalizedInputs.map((entry) => entry.element))
    .map((element) => inputsByElement.get(element) ?? { element })
    .map((entry) => toRenderNode(entry, options.proxyMediaBySource ?? null));
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

export function buildOverlayRenderNodeId(overlayId: string, stackOrder: number, elementId: string): string {
  return `${overlayId}::${stackOrder}::${elementId}`;
}

export function buildLayeredRenderScene({
  slide,
  contentElements,
  videoAsset,
  videoPlayback,
  mediaAsset,
  overlays,
  includeContent,
}: LayeredSceneInput, options: BuildRenderSceneOptions = {}): RenderScene {
  const merged: SceneElementInput[] = [];
  if (videoAsset) merged.push({ element: mediaAssetToLayerElement(videoAsset, {
    id: LAYER_VIDEO_NODE_ID,
    zIndex: -1,
    videoPlayback,
  }) });
  if (mediaAsset) merged.push({ element: mediaAssetToLayerElement(mediaAsset) });
  if (includeContent) merged.push(...contentElements.map((element) => ({ element: toPresentationLayerElement(element) })));

  for (const overlayLayer of overlays) {
    if (overlayLayer.opacityMultiplier <= 0) continue;
    merged.push(...overlayToLayerElements(overlayLayer.overlay).map((element) => ({
      nodeId: buildOverlayRenderNodeId(overlayLayer.overlay.id, overlayLayer.stackOrder, element.id),
      element: {
        ...element,
        opacity: element.opacity * overlayLayer.opacityMultiplier,
        zIndex: element.zIndex + OVERLAY_LAYER_Z_INDEX_OFFSET + (overlayLayer.stackOrder * OVERLAY_STACK_Z_INDEX_OFFSET),
      },
      bindingOverride: { armedAtMs: overlayLayer.startedAt },
    })));
  }
  return buildRenderScene(slide, merged, options);
}

export function buildThumbnailScene(
  slide: Slide,
  slideElements: SlideElement[],
  options: BuildRenderSceneOptions = {},
): RenderScene {
  return buildRenderScene(slide, slideElements, options);
}

// ── Resolved render-scene builder ──────────────────────────────────────
//
// Produces the provider-independent ResolvedRenderScene contract from
// resolved inputs: scene data, dimensions, surface flags, selection and
// interaction flags, and resolved media handles.

export interface ResolvedRenderSceneOptions {
  surface?: SceneSurface;
  interactive?: boolean;
  selection?: SelectionState | null;
  media?: MediaHandleLookup | null;
  proxyMediaBySource?: MediaProxyLookup | null;
}

function finiteNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function resolveMediaHandle(media: MediaHandleLookup | null, mediaKey: string | null): ResolvedMediaState {
  if (!mediaKey) return { status: 'empty' };
  if (!media) return { status: 'empty' };
  if (typeof media === 'function') return media(mediaKey);
  return media.get(mediaKey) ?? { status: 'empty' };
}

function toBoxVisual(visual: VisualPayloadState): ResolvedBoxVisual {
  return {
    fillEnabled: visual.fillEnabled,
    fillColor: visual.fillColor,
    strokeEnabled: visual.strokeEnabled,
    strokeColor: visual.strokeColor,
    strokeWidth: visual.strokeWidth,
    borderRadius: visual.borderRadius,
    shadowEnabled: visual.shadowEnabled,
    shadowColor: visual.shadowColor,
    shadowBlur: visual.shadowBlur,
    shadowOffsetX: visual.shadowOffsetX,
    shadowOffsetY: visual.shadowOffsetY,
  };
}

function transformTextCase(text: string, mode: TextCaseTransform): string {
  if (mode === 'uppercase') return text.toUpperCase();
  if (mode === 'sentence') return text.replace(/(^\s*\w|[.!?]\s+\w)/g, (match) => match.toUpperCase());
  return text;
}

function textHorizontalAlign(alignment: TextHorizontalAlign): 'left' | 'center' | 'right' | 'justify' {
  if (alignment === 'center') return 'center';
  if (alignment === 'right' || alignment === 'end') return 'right';
  if (alignment === 'justify') return 'justify';
  return 'left';
}

function toTextVisual(element: SlideElement): ResolvedTextVisual {
  const payload = element.payload as TextElementPayload;
  const formatting = readTextFormatting(payload);
  const visual = readTextVisualPayload(payload);
  return {
    text: transformTextCase(payload.text ?? '', payload.caseTransform ?? 'none'),
    fontFamily: payload.fontFamily || 'sans-serif',
    fontSize: formatting.fontSize,
    fontWeight: coerceWeight(payload.weight),
    italic: formatting.italic,
    color: visual.color,
    alignment: textHorizontalAlign(payload.alignment ?? 'left'),
    verticalAlign: formatting.verticalAlign,
    lineHeight: formatting.lineHeight,
    textStrokeEnabled: visual.strokeEnabled,
    textStrokeColor: visual.strokeColor,
    textStrokeWidth: visual.strokeWidth,
    textStrokePosition: visual.strokePosition,
  };
}

function toResolvedNode(
  element: SlideElement | null | undefined,
  selection: SelectionState,
  media: MediaHandleLookup | null,
  proxyMediaBySource: MediaProxyLookup | null | undefined,
): ResolvedRenderNode | null {
  if (!element || !element.id) return null;
  const visual = readVisualPayload(element.type, element.payload);
  const base: ResolvedRenderNodeBase = {
    id: element.id,
    kind: element.type,
    x: finiteNumber(element.x),
    y: finiteNumber(element.y),
    width: finiteNumber(element.width),
    height: finiteNumber(element.height),
    rotation: finiteNumber(element.rotation),
    opacity: finiteNumber(element.opacity, 1),
    zIndex: finiteNumber(element.zIndex),
    visible: visual.visible,
    locked: visual.locked,
    flipX: visual.flipX,
    flipY: visual.flipY,
    selected: selection.selectedIds.includes(element.id),
  };

  switch (element.type) {
    case 'shape':
      return { ...base, kind: 'shape', box: toBoxVisual(visual) };
    case 'text':
      return { ...base, kind: 'text', box: toBoxVisual(visual), text: toTextVisual(element) };
    case 'image':
    case 'video': {
      const src = (element.payload as { src?: string }).src ?? null;
      const proxyMediaKey = resolveProxyMediaKey(proxyMediaBySource, src);
      return {
        ...base,
        kind: element.type,
        mediaKey: src,
        media: resolveMediaHandle(media, src),
        proxyMediaKey,
        proxyMedia: resolveMediaHandle(media, proxyMediaKey),
      };
    }
    case 'group': {
      const payload = element.payload as GroupElementPayload;
      const children = (payload.children ?? [])
        .map((child) => toResolvedNode(child, selection, media, proxyMediaBySource))
        .filter((node): node is ResolvedRenderNode => node !== null);
      return { ...base, kind: 'group', children };
    }
    default:
      return null;
  }
}

function toResolvedBackground(
  background: SlideBackground | null | undefined,
  media: MediaHandleLookup | null,
  proxyMediaBySource: MediaProxyLookup | null | undefined,
): ResolvedBackground | null {
  if (!background) return null;
  if (background.type === 'color') return { type: 'color', color: background.color };
  if (background.type === 'gradient') {
    return {
      type: 'gradient',
      kind: background.gradient.kind,
      angle: background.gradient.angle ?? 0,
      stops: background.gradient.stops.map((stop) => ({
        position: Math.min(100, Math.max(0, finiteNumber(stop.position))),
        color: stop.color,
      })),
    };
  }
  return {
    type: background.type,
    fit: background.fit,
    mediaKey: background.src,
    media: resolveMediaHandle(media, background.src),
    proxyMediaKey: resolveProxyMediaKey(proxyMediaBySource, background.src),
    proxyMedia: resolveMediaHandle(media, resolveProxyMediaKey(proxyMediaBySource, background.src)),
  };
}

export function buildResolvedRenderScene(
  frame: RenderSceneFrameInput,
  elements: SlideElement[] | SceneElementInput[],
  options: ResolvedRenderSceneOptions = {},
): ResolvedRenderScene {
  const nextSlide = resolveSceneSlide(frame, options.proxyMediaBySource ?? null);
  const size = sceneSize(nextSlide);
  const selection = options.selection ?? { selectedIds: [], primarySelectedId: null };
  const media = options.media ?? null;
  const proxyMediaBySource = options.proxyMediaBySource ?? null;
  const normalizedInputs = elements.map((entry) => ('element' in entry ? entry : { element: entry }));
  const nodes = sortElements(normalizedInputs.map((entry) => entry.element))
    .map((element) => toResolvedNode(
      (normalizedInputs.find((entry) => entry.element === element) ?? { element }).element,
      selection,
      media,
      proxyMediaBySource,
    ))
    .filter((node): node is ResolvedRenderNode => node !== null);
  return {
    surface: options.surface ?? 'show',
    width: size.width,
    height: size.height,
    background: toResolvedBackground(nextSlide.background, media, proxyMediaBySource),
    nodes,
    interactive: options.interactive ?? false,
    selection,
  };
}

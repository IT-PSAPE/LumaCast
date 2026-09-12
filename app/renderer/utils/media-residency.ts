import type { Overlay, Slide, SlideBackground, SlideElement, Stage, MediaAsset } from '@lumacast/composition';

export interface CollectedMediaSource {
  mediaKey: string;
  kind: 'image' | 'video';
}

function collectBackgroundMedia(background: SlideBackground | null | undefined, sink: Map<string, CollectedMediaSource>) {
  if (!background || (background.type !== 'image' && background.type !== 'video') || !background.src) return;
  sink.set(background.src, { mediaKey: background.src, kind: background.type });
}

function collectElementMedia(element: SlideElement, sink: Map<string, CollectedMediaSource>) {
  if (element.type === 'image' || element.type === 'video') {
    const mediaKey = (element.payload as { src?: string }).src ?? null;
    if (mediaKey) {
      sink.set(mediaKey, { mediaKey, kind: element.type });
    }
    return;
  }

  if (element.type !== 'group') return;
  const children = ((element.payload as { children?: SlideElement[] }).children ?? []);
  for (const child of children) {
    collectElementMedia(child, sink);
  }
}

export function collectMediaSourcesFromElements(elements: readonly SlideElement[]): CollectedMediaSource[] {
  const sink = new Map<string, CollectedMediaSource>();
  for (const element of elements) {
    collectElementMedia(element, sink);
  }
  return [...sink.values()];
}

export function collectMediaSourcesFromSlide(
  slide: Pick<Slide, 'background'> | null | undefined,
  elements: readonly SlideElement[],
): CollectedMediaSource[] {
  const sink = new Map<string, CollectedMediaSource>();
  collectBackgroundMedia(slide?.background ?? null, sink);
  for (const element of elements) {
    collectElementMedia(element, sink);
  }
  return [...sink.values()];
}

export function collectMediaSourcesFromStage(stage: Pick<Stage, 'background' | 'elements'> | null | undefined): CollectedMediaSource[] {
  if (!stage) return [];
  return collectMediaSourcesFromSlide({ background: stage.background ?? null }, stage.elements);
}

export function collectMediaSourcesFromOverlay(overlay: Pick<Overlay, 'background' | 'elements'> | null | undefined): CollectedMediaSource[] {
  if (!overlay) return [];
  return collectMediaSourcesFromSlide({ background: overlay.background ?? null }, overlay.elements);
}

export function mediaKeysOf(sources: readonly CollectedMediaSource[]): string[] {
  return sources.map((source) => source.mediaKey);
}

export function buildMediaProxyBySource(mediaAssets: readonly MediaAsset[]): ReadonlyMap<string, string> {
  const bySource = new Map<string, string>();
  for (const asset of mediaAssets) {
    if (!asset.thumbnailSrc) continue;
    bySource.set(asset.src, asset.thumbnailSrc);
  }
  return bySource;
}

export function buildMediaAssetsBySource(mediaAssets: readonly MediaAsset[]): ReadonlyMap<string, MediaAsset> {
  const bySource = new Map<string, MediaAsset>();
  for (const asset of mediaAssets) {
    bySource.set(asset.src, asset);
  }
  return bySource;
}

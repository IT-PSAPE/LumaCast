import type { MediaAsset, Overlay, Slide, SlideElement } from './types';

export const OUTPUT_FRAME_WIDTH = 1920;
export const OUTPUT_FRAME_HEIGHT = 1080;

export const LAYER_PREVIEW_SLIDE: Slide = {
  id: '__layer_preview__',
  presentationId: null,
  lyricId: null,
  themeId: null,
  overlayId: null,
  stageId: null,
  kind: 'presentation',
  width: OUTPUT_FRAME_WIDTH,
  height: OUTPUT_FRAME_HEIGHT,
  notes: '',
  order: 0,
  createdAt: '',
  updatedAt: '',
};

interface PlaybackLayerElementOptions {
  id?: string;
  zIndex?: number;
  videoPlayback?: {
    autoplay?: boolean;
    loop?: boolean;
    muted?: boolean;
    playbackRate?: number;
  };
}

export function mediaAssetToLayerElement(asset: MediaAsset, options: PlaybackLayerElementOptions = {}): SlideElement {
  const { id = '__layer_media', zIndex = 0, videoPlayback } = options;

  if (asset.type === 'audio') {
    return {
      id,
      slideId: LAYER_PREVIEW_SLIDE.id,
      type: 'text',
      x: 0,
      y: 450,
      width: OUTPUT_FRAME_WIDTH,
      height: 180,
      rotation: 0,
      opacity: 1,
      zIndex,
      layer: 'media',
      payload: {
        text: `[AUDIO] ${asset.name}`,
        fontFamily: 'Avenir Next',
        fontSize: 58,
        color: '#FFFFFF',
        alignment: 'center',
        verticalAlign: 'middle',
        lineHeight: 1.2,
        weight: '700',
      },
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    };
  }

  const isVideo = asset.type === 'video';

  return {
    id,
    slideId: LAYER_PREVIEW_SLIDE.id,
    type: isVideo ? 'video' : 'image',
    x: 0,
    y: 0,
    width: OUTPUT_FRAME_WIDTH,
    height: OUTPUT_FRAME_HEIGHT,
    rotation: 0,
    opacity: 1,
    zIndex,
    layer: 'media',
    payload: isVideo
      ? {
        src: asset.src,
        autoplay: videoPlayback?.autoplay ?? true,
        loop: videoPlayback?.loop ?? true,
        muted: videoPlayback?.muted ?? true,
        playbackRate: videoPlayback?.playbackRate ?? 1,
      }
      : { src: asset.src },
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

export function overlayToLayerElements(overlay: Overlay): SlideElement[] {
  return overlay.elements.map((element) => ({
    ...element,
    slideId: '__overlay__',
    layer: 'content',
  }));
}

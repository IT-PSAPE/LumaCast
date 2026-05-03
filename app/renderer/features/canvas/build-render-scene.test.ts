import { describe, expect, it } from 'vitest';
import type { MediaAsset, Slide, SlideElement } from '@core/types';
import { buildLayeredRenderScene } from './build-render-scene';

function makeSlide(): Slide {
  return {
    id: 'slide-1',
    presentationId: 'presentation-1',
    lyricId: null,
    themeId: null,
    overlayId: null,
    stageId: null,
    kind: 'presentation',
    width: 1920,
    height: 1080,
    notes: '',
    order: 0,
    createdAt: '',
    updatedAt: '',
  };
}

function makeAsset(id: string, type: MediaAsset['type']): MediaAsset {
  return {
    id,
    name: id,
    type,
    src: `/${id}`,
    collectionId: 'media-default',
    order: 0,
    createdAt: '',
    updatedAt: '',
  };
}

function makeContentElement(): SlideElement {
  return {
    id: 'content-1',
    slideId: 'slide-1',
    type: 'text',
    x: 100,
    y: 100,
    width: 400,
    height: 100,
    rotation: 0,
    opacity: 1,
    zIndex: 5,
    layer: 'content',
    payload: {
      text: 'Hello',
      fontFamily: 'Avenir Next',
      fontSize: 48,
      color: '#FFFFFF',
      alignment: 'center',
    },
    createdAt: '',
    updatedAt: '',
  };
}

describe('buildLayeredRenderScene', () => {
  it('renders the dedicated video layer beneath the media layer and content', () => {
    const scene = buildLayeredRenderScene({
      slide: makeSlide(),
      contentElements: [makeContentElement()],
      videoAsset: makeAsset('video-1', 'video'),
      mediaAsset: makeAsset('image-1', 'image'),
      overlays: [],
      includeContent: true,
    });

    expect(scene.nodes.map((node) => node.id)).toEqual(['__layer_video', '__layer_media', 'content-1']);
    expect(scene.nodes.map((node) => node.element.type)).toEqual(['video', 'image', 'text']);
  });
});

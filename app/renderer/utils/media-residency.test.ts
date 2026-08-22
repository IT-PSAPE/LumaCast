import { describe, expect, it } from 'vitest';
import type { MediaAsset, Overlay, Slide, SlideElement, Stage } from '@lumacast/composition';
import {
  buildMediaAssetsBySource,
  buildMediaProxyBySource,
  collectMediaSourcesFromOverlay,
  collectMediaSourcesFromSlide,
  collectMediaSourcesFromStage,
  mediaKeysOf,
} from './media-residency';

function imageElement(id: string, src: string): SlideElement {
  return {
    id,
    slideId: 'slide-1',
    type: 'image',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    layer: 'content',
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
    payload: { src },
  };
}

function videoElement(id: string, src: string): SlideElement {
  return {
    ...imageElement(id, src),
    type: 'video',
  };
}

function groupElement(id: string, children: SlideElement[]): SlideElement {
  return {
    ...imageElement(id, ''),
    type: 'group',
    payload: { children },
  };
}

function slide(backgroundSrc: string | null, _elements: SlideElement[]): Slide {
  return {
    id: 'slide-1',
    background: backgroundSrc ? { type: 'image', mediaAssetId: 'asset-bg', src: backgroundSrc, fit: 'cover' } : null,
    backgroundSource: 'local',
    presentationId: 'presentation-1',
    lyricId: null,
    talkId: null,
    presentationThemeId: null,
    lyricThemeId: null,
    talkThemeId: null,
    overlayThemeId: null,
    overlayId: null,
    stageId: null,
    kind: 'presentation',
    width: 1920,
    height: 1080,
    notes: '',
    order: 0,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
  };
}

function stage(backgroundSrc: string | null, elements: SlideElement[]): Stage {
  return {
    id: 'stage-1',
    slideId: 'slide-1',
    name: 'Stage',
    width: 1920,
    height: 1080,
    background: backgroundSrc ? { type: 'video', mediaAssetId: 'asset-stage', src: backgroundSrc, fit: 'contain' } : null,
    elements,
    order: 0,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
  };
}

function overlay(backgroundSrc: string | null, elements: SlideElement[]): Overlay {
  return {
    id: 'overlay-1',
    slideId: 'slide-1',
    name: 'Overlay',
    enabled: true,
    order: 0,
    background: backgroundSrc ? { type: 'image', mediaAssetId: 'asset-overlay', src: backgroundSrc, fit: 'fill' } : null,
    elements,
    animation: { kind: 'none', durationMs: 0 },
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
  };
}

function mediaAsset(src: string, thumbnailSrc: string | null): MediaAsset {
  return {
    id: src,
    name: src,
    type: src.endsWith('.mp4') ? 'video' : 'image',
    src,
    width: 100,
    height: 100,
    duration: null,
    codec: null,
    thumbnailSrc,
    order: 0,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
  };
}

describe('media residency collection', () => {
  it('collects background, top-level, and nested group media recursively', () => {
    const sources = collectMediaSourcesFromSlide(
      slide('asset://background.png', [
        imageElement('image-1', 'asset://image.png'),
        groupElement('group-1', [
          videoElement('video-1', 'asset://nested.mp4'),
          groupElement('group-2', [imageElement('image-2', 'asset://nested.png')]),
        ]),
      ]),
      [
        imageElement('image-1', 'asset://image.png'),
        groupElement('group-1', [
          videoElement('video-1', 'asset://nested.mp4'),
          groupElement('group-2', [imageElement('image-2', 'asset://nested.png')]),
        ]),
      ],
    );

    expect(mediaKeysOf(sources)).toEqual([
      'asset://background.png',
      'asset://image.png',
      'asset://nested.mp4',
      'asset://nested.png',
    ]);
  });

  it('collects stage and overlay media sources without losing background media', () => {
    expect(mediaKeysOf(collectMediaSourcesFromStage(stage('asset://stage.mp4', [imageElement('image-1', 'asset://stage-image.png')])))).toEqual([
      'asset://stage.mp4',
      'asset://stage-image.png',
    ]);

    expect(mediaKeysOf(collectMediaSourcesFromOverlay(overlay('asset://overlay.png', [videoElement('video-1', 'asset://overlay-video.mp4')])))).toEqual([
      'asset://overlay.png',
      'asset://overlay-video.mp4',
    ]);
  });

  it('builds source maps for proxy thumbnails and asset lookup', () => {
    const assets = [
      mediaAsset('asset://full-a.png', 'asset://thumb-a.png'),
      mediaAsset('asset://full-b.mp4', 'asset://thumb-b.png'),
      mediaAsset('asset://full-c.png', null),
    ];

    expect(buildMediaProxyBySource(assets)).toEqual(new Map([
      ['asset://full-a.png', 'asset://thumb-a.png'],
      ['asset://full-b.mp4', 'asset://thumb-b.png'],
    ]));
    expect(buildMediaAssetsBySource(assets).get('asset://full-c.png')?.id).toBe('asset://full-c.png');
  });
});

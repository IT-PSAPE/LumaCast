import { describe, expect, it } from 'vitest';
import { resolveLinkedSlideElements } from '@lumacast/composition';
import type { MediaCrop, SlideElement } from '@lumacast/composition';
import { createTestRepository } from '../../../../packages/persistence-sqlite/src/test-support';
import { computeMediaCropGesture } from '../../../../packages/canvas/src/media-crop-transform';

const imageCrop: MediaCrop = { x: 0.1, y: 0.2, width: 0.6, height: 0.5 };
const videoCrop: MediaCrop = { x: 0.25, y: 0.125, width: 0.5, height: 0.75 };
const imageCropFrame: MediaCrop = { x: 0.1, y: 0.15, width: 0.75, height: 0.7 };
const videoCropFrame: MediaCrop = { x: 0.15, y: 0.1, width: 0.65, height: 0.8 };

function mediaElement(
  type: 'image' | 'video',
  id: string,
  slideId: string,
  crop?: MediaCrop | null,
  cropFrame?: MediaCrop | null,
): SlideElement {
  const now = new Date().toISOString();
  const payload = type === 'image'
    ? { src: 'https://example.test/image.png', ...(crop === undefined ? {} : { crop }), ...(cropFrame === undefined ? {} : { cropFrame }) }
    : { src: 'https://example.test/video.mp4', autoplay: false, loop: false, ...(crop === undefined ? {} : { crop }), ...(cropFrame === undefined ? {} : { cropFrame }) };
  return {
    id,
    slideId,
    type,
    x: 10,
    y: 20,
    width: 320,
    height: 180,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    layer: 'media',
    payload,
    createdAt: now,
    updatedAt: now,
  } as SlideElement;
}

function cropOf(element: SlideElement): MediaCrop | null | undefined {
  return (element.payload as { crop?: MediaCrop | null }).crop;
}

function cropFrameOf(element: SlideElement): MediaCrop | null | undefined {
  return (element.payload as { cropFrame?: MediaCrop | null }).cropFrame;
}

describe('media crop persistence', () => {
  it('saves and reloads image/video crops, including crops nested in groups', () => {
    const target = createTestRepository({ seed: false });
    try {
      const repo = target.repository;
      const itemId = repo.createItem({ type: 'presentation', title: 'Cropped media' }).itemId;
      const slideId = repo.getSnapshot().slides.find((slide) => slide.presentationId === itemId)!.id;
      const groupedImage = mediaElement('image', 'group-image', slideId, imageCrop, imageCropFrame);
      const groupedVideo = mediaElement('video', 'group-video', slideId, videoCrop, videoCropFrame);

      repo.createElement({
        slideId,
        type: 'image',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        payload: { src: 'https://example.test/top-level.png', crop: imageCrop, cropFrame: imageCropFrame },
      });
      repo.createElement({
        slideId,
        type: 'video',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 23,
        payload: { src: 'https://example.test/top-level.mp4', autoplay: true, loop: true, muted: false, playbackRate: 1.25, fit: 'contain', flipX: true, flipY: true, crop: videoCrop, cropFrame: videoCropFrame },
      });
      repo.createElement({
        slideId,
        type: 'group',
        x: 0,
        y: 0,
        width: 400,
        height: 240,
        payload: { children: [groupedImage, groupedVideo] },
      });

      target.close();
      const reopened = target.reopen();
      const elements = reopened.getSnapshot().slideElements.filter((element) => element.slideId === slideId);
      expect(cropOf(elements.find((element) => element.type === 'image')!)).toEqual(imageCrop);
      expect(cropOf(elements.find((element) => element.type === 'video')!)).toEqual(videoCrop);
      expect(cropFrameOf(elements.find((element) => element.type === 'image')!)).toEqual(imageCropFrame);
      expect(cropFrameOf(elements.find((element) => element.type === 'video')!)).toEqual(videoCropFrame);
      expect(elements.find((element) => element.type === 'video')).toMatchObject({
        rotation: 23,
        payload: { src: 'https://example.test/top-level.mp4', fit: 'contain', flipX: true, flipY: true, autoplay: true, loop: true, muted: false, playbackRate: 1.25 },
      });
      const group = elements.find((element) => element.type === 'group')!;
      const children = (group.payload as { children: SlideElement[] }).children;
      expect(cropOf(children.find((child) => child.id === 'group-image')!)).toEqual(imageCrop);
      expect(cropOf(children.find((child) => child.id === 'group-video')!)).toEqual(videoCrop);
      expect(cropFrameOf(children.find((child) => child.id === 'group-image')!)).toEqual(imageCropFrame);
      expect(cropFrameOf(children.find((child) => child.id === 'group-video')!)).toEqual(videoCropFrame);
    } finally {
      target.close();
      target.cleanup();
    }
  });

  it('persists the crop and asymmetric cropFrame returned by a direct crop gesture', () => {
    const gesture = computeMediaCropGesture({
      frame: { x: 0, y: 0, width: 200, height: 120 },
      sourceDrawRect: { x: 0, y: 10, width: 200, height: 100 },
      handle: 'e',
      deltaX: -40,
      deltaY: 0,
    });
    expect(gesture).toMatchObject({
      frame: { x: 0, y: 0, width: 160, height: 120 },
      crop: { x: 0, y: 0, width: 0.8, height: 1 },
      cropFrame: { x: 0, width: 1 },
    });
    if (!gesture) throw new Error('Expected the crop gesture to intersect the source.');
    expect(gesture.cropFrame.y).toBeCloseTo(10 / 120);
    expect(gesture.cropFrame.height).toBeCloseTo(100 / 120);

    const target = createTestRepository({ seed: false });
    try {
      const repo = target.repository;
      const itemId = repo.createItem({ type: 'presentation', title: 'Gesture crop' }).itemId;
      const slideId = repo.getSnapshot().slides.find((slide) => slide.presentationId === itemId)!.id;
      repo.createElement({
        slideId,
        type: 'image',
        x: gesture.frame.x,
        y: gesture.frame.y,
        width: gesture.frame.width,
        height: gesture.frame.height,
        payload: { src: 'https://example.test/gesture.png', fit: 'contain', crop: gesture.crop, cropFrame: gesture.cropFrame },
      });
      const saved = repo.getSnapshot().slideElements.find((element) => element.slideId === slideId && element.type === 'image')!;
      expect(cropOf(saved)).toEqual(gesture.crop);
      expect(cropFrameOf(saved)).toEqual(gesture.cropFrame);
    } finally {
      target.close();
      target.cleanup();
    }
  });

  it('persists crop edits and explicit clears through a batch update', () => {
    const target = createTestRepository({ seed: false });
    try {
      const repo = target.repository;
      const itemId = repo.createItem({ type: 'presentation', title: 'Batch crop edit' }).itemId;
      const slideId = repo.getSnapshot().slides.find((slide) => slide.presentationId === itemId)!.id;
      repo.createElement({ slideId, type: 'image', x: 0, y: 0, width: 100, height: 100, payload: { src: 'https://example.test/a.png' } });
      repo.createElement({ slideId, type: 'video', x: 0, y: 0, width: 100, height: 100, payload: { src: 'https://example.test/b.mp4', autoplay: false, loop: false, crop: videoCrop, cropFrame: videoCropFrame } });
      const before = repo.getSnapshot().slideElements.filter((element) => element.slideId === slideId);
      const image = before.find((element) => element.type === 'image')!;
      const video = before.find((element) => element.type === 'video')!;

      repo.updateElementsBatch([
        { id: image.id, payload: { src: 'https://example.test/a.png', crop: imageCrop, cropFrame: imageCropFrame } },
        { id: video.id, payload: { src: 'https://example.test/b.mp4', autoplay: false, loop: false, crop: null, cropFrame: null } },
      ]);

      const after = repo.getSnapshot().slideElements.filter((element) => element.slideId === slideId);
      expect(cropOf(after.find((element) => element.id === image.id)!)).toEqual(imageCrop);
      expect(cropOf(after.find((element) => element.id === video.id)!)).toBeNull();
      expect(cropFrameOf(after.find((element) => element.id === image.id)!)).toEqual(imageCropFrame);
      expect(cropFrameOf(after.find((element) => element.id === video.id)!)).toBeNull();
    } finally {
      target.close();
      target.cleanup();
    }
  });

  it('preserves crops when an item is duplicated and when a bundle is imported', () => {
    const target = createTestRepository({ seed: false });
    try {
      const repo = target.repository;
      const sourceItemId = repo.createItem({ type: 'presentation', title: 'Source' }).itemId;
      const sourceSlideId = repo.getSnapshot().slides.find((slide) => slide.presentationId === sourceItemId)!.id;
      repo.createElement({ slideId: sourceSlideId, type: 'image', x: 0, y: 0, width: 100, height: 100, payload: { src: 'https://example.test/duplicate.png', crop: imageCrop, cropFrame: imageCropFrame } });
      repo.createElement({ slideId: sourceSlideId, type: 'group', x: 0, y: 0, width: 200, height: 100, payload: { children: [mediaElement('video', 'nested-video', sourceSlideId, videoCrop, videoCropFrame)] } });

      const duplicateItemId = repo.duplicateItem({ type: 'presentation', id: sourceItemId }).itemId;
      const duplicateSlideId = repo.getSnapshot().slides.find((slide) => slide.presentationId === duplicateItemId)!.id;
      const duplicated = repo.getSnapshot().slideElements.filter((element) => element.slideId === duplicateSlideId);
      expect(cropOf(duplicated.find((element) => element.type === 'image')!)).toEqual(imageCrop);
      expect(cropFrameOf(duplicated.find((element) => element.type === 'image')!)).toEqual(imageCropFrame);
      const duplicateGroup = duplicated.find((element) => element.type === 'group')!;
      expect(cropOf((duplicateGroup.payload as { children: SlideElement[] }).children[0]!)).toEqual(videoCrop);
      expect(cropFrameOf((duplicateGroup.payload as { children: SlideElement[] }).children[0]!)).toEqual(videoCropFrame);

      const manifest = repo.exportBundle([sourceItemId]);
      const importedSnapshot = repo.finalizeImportBundle(manifest, []);
      const importedItem = importedSnapshot.presentations.find((item) => item.id !== sourceItemId && item.id !== duplicateItemId)!;
      const importedSlide = importedSnapshot.slides.find((slide) => slide.presentationId === importedItem.id)!;
      const importedElements = importedSnapshot.slideElements.filter((element) => element.slideId === importedSlide.id);
      expect(cropOf(importedElements.find((element) => element.type === 'image')!)).toEqual(imageCrop);
      expect(cropFrameOf(importedElements.find((element) => element.type === 'image')!)).toEqual(imageCropFrame);
      const importedGroup = importedElements.find((element) => element.type === 'group')!;
      expect(cropOf((importedGroup.payload as { children: SlideElement[] }).children[0]!)).toEqual(videoCrop);
      expect(cropFrameOf((importedGroup.payload as { children: SlideElement[] }).children[0]!)).toEqual(videoCropFrame);
    } finally {
      target.close();
      target.cleanup();
    }
  });

  it('keeps an explicit null crop override when a linked theme changes', () => {
    const target = createTestRepository({ seed: false });
    try {
      const repo = target.repository;
      const themeInputElement = mediaElement('image', 'theme-image', '', imageCrop);
      const theme = repo.createTheme({ name: 'Cropped theme', themeType: 'presentation', elements: [themeInputElement] }).upserts.presentationThemes![0]!;
      const sourceThemeElement = theme.elements[0]!;
      const itemId = repo.createItem({ type: 'presentation', title: 'Linked item', themeId: theme.id }).itemId;
      const slideId = repo.getSnapshot().slides.find((slide) => slide.presentationId === itemId)!.id;
      const persistedElement = repo.getSnapshot().slideElements.find((element) => element.slideId === slideId)!;

      repo.updateElement({
        id: persistedElement.id,
        payload: { ...(persistedElement.payload as { src: string }), crop: null },
        themeOverrideKeys: ['crop'],
      });
      const afterOverride = repo.getSnapshot();
      const updatedThemeElement = { ...sourceThemeElement, payload: { ...sourceThemeElement.payload, crop: videoCrop } };
      repo.updateTheme({ id: theme.id, themeType: 'presentation', elements: [updatedThemeElement] });

      const afterThemeChange = repo.getSnapshot();
      const currentTheme = afterThemeChange.presentationThemes.find((entry) => entry.id === theme.id)!;
      const currentRows = afterThemeChange.slideElements.filter((element) => element.slideId === slideId);
      expect(afterOverride.slideElements.find((element) => element.id === persistedElement.id)?.themeOverrideKeys).toContain('crop');
      expect(cropOf(currentRows[0]!)).toBeNull();
      expect(cropOf(resolveLinkedSlideElements(currentTheme, slideId, currentRows)[0]!)).toBeNull();
    } finally {
      target.close();
      target.cleanup();
    }
  });

  it('rejects crop rectangles outside the normalized source bounds', () => {
    const target = createTestRepository({ seed: false });
    try {
      const repo = target.repository;
      const itemId = repo.createItem({ type: 'presentation', title: 'Invalid crop' }).itemId;
      const slideId = repo.getSnapshot().slides.find((slide) => slide.presentationId === itemId)!.id;
      expect(() => repo.createElement({
        slideId,
        type: 'image',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        payload: { src: 'https://example.test/invalid.png', crop: { x: 0.8, y: 0.1, width: 0.3, height: 0.5 } },
      })).toThrow(/crop|width|bounds/i);
    } finally {
      target.close();
      target.cleanup();
    }
  });
});

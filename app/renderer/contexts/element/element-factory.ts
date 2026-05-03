import type { Id, MediaAsset, SlideElementPayload, SlideElementType } from '@core/types';
import { createId } from '../../utils/create-id';

export function newTextPayload(text: string, fontSize: number, alignment: CanvasTextAlign | 'justify', weight: string) {
  return {
    text,
    fontFamily: 'Avenir Next',
    fontSize,
    color: '#FFFFFF',
    alignment,
    verticalAlign: 'middle' as const,
    lineHeight: 1.25,
    caseTransform: 'none' as const,
    weight,
    visible: true,
    locked: false,
    fillEnabled: false,
    fillColor: '#00000000',
    strokeEnabled: false,
    shadowEnabled: false,
  };
}

export function newShapePayload() {
  return {
    fillColor: '#172026C8',
    borderColor: '#FFFFFF44',
    borderWidth: 3,
    borderRadius: 24,
    visible: true,
    locked: false,
    fillEnabled: true,
    strokeEnabled: true,
    shadowEnabled: false,
  };
}

export function nextOverlayZIndex(elements: { zIndex: number }[], fallback: number): number {
  if (elements.length === 0) return fallback;
  return Math.max(...elements.map((element) => element.zIndex)) + 1;
}

export function newSlideTextElement(slideId: Id) {
  const timestamp = new Date().toISOString();
  return {
    id: createId(),
    slideId,
    type: 'text' as const,
    x: 210,
    y: 460,
    width: 1500,
    height: 120,
    rotation: 0,
    opacity: 1,
    zIndex: 20,
    layer: 'content' as const,
    payload: newTextPayload('New Text Element', 72, 'center', '700'),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function newSlideShapeElement(slideId: Id) {
  const timestamp = new Date().toISOString();
  return {
    id: createId(),
    slideId,
    type: 'shape' as const,
    x: 260,
    y: 260,
    width: 1400,
    height: 560,
    rotation: 0,
    opacity: 1,
    zIndex: 2,
    layer: 'background' as const,
    payload: newShapePayload(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function newSlideMediaElement(slideId: Id, asset: MediaAsset, x: number, y: number) {
  const timestamp = new Date().toISOString();
  if (asset.type === 'image') {
    return {
      id: createId(),
      slideId,
      type: 'image' as const,
      x,
      y,
      width: 640,
      height: 360,
      rotation: 0,
      opacity: 1,
      zIndex: 10,
      layer: 'media' as const,
      payload: { src: asset.src },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
  if (asset.type === 'video') {
    return {
      id: createId(),
      slideId,
      type: 'video' as const,
      x,
      y,
      width: 960,
      height: 540,
      rotation: 0,
      opacity: 1,
      zIndex: 10,
      layer: 'media' as const,
      payload: { src: asset.src, autoplay: true, loop: true, muted: false, playbackRate: 1 },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
  return {
    id: createId(),
    slideId,
    type: 'text' as const,
    x,
    y,
    width: 800,
    height: 90,
    rotation: 0,
    opacity: 1,
    zIndex: 12,
    layer: 'content' as const,
    payload: newTextPayload(`[AUDIO] ${asset.name}`, 42, 'left', '600'),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function newOverlayElement(
  overlayId: Id,
  type: SlideElementType,
  x: number,
  y: number,
  width: number,
  height: number,
  zIndex: number,
  payload: SlideElementPayload,
) {
  const timestamp = new Date().toISOString();
  return {
    id: createId(),
    slideId: overlayId,
    type,
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    zIndex,
    layer: 'content' as const,
    payload,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

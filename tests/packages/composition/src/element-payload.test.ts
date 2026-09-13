import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_FIT,
  DEFAULT_VIDEO_FIT,
  applyVisualPayload,
  readMediaFit,
  readTextFormatting,
  readVisualPayload,
  type VisualPayloadState,
} from '../../../../packages/composition/src/element-payload';
import type {
  ImageElementPayload,
  TextElementPayload,
  VideoElementPayload,
} from '../../../../packages/composition/src/domain/slide-elements';

function imagePayload(overrides: Partial<ImageElementPayload> = {}): ImageElementPayload {
  return { src: 'asset://logo.png', ...overrides };
}

function videoPayload(overrides: Partial<VideoElementPayload> = {}): VideoElementPayload {
  return { src: 'asset://clip.mp4', autoplay: false, loop: false, ...overrides };
}

function textPayload(overrides: Partial<TextElementPayload> = {}): TextElementPayload {
  return { text: 'Hello', fontFamily: 'Inter', fontSize: 32, color: '#ffffff', alignment: 'left', ...overrides };
}

describe('readMediaFit', () => {
  it('defaults an image to cover and a video to contain when fit is absent', () => {
    expect(readMediaFit('image', imagePayload())).toBe('cover');
    expect(readMediaFit('video', videoPayload())).toBe('contain');
    expect(DEFAULT_IMAGE_FIT).toBe('cover');
    expect(DEFAULT_VIDEO_FIT).toBe('contain');
  });

  it('honors an explicit fit for either type', () => {
    expect(readMediaFit('image', imagePayload({ fit: 'contain' }))).toBe('contain');
    expect(readMediaFit('video', videoPayload({ fit: 'fill' }))).toBe('fill');
  });
});

describe('applyVisualPayload', () => {
  // Regression coverage for the audit's item 1: fillColor/borderRadius edits
  // via the generic Shape inspector must persist for image/video elements too,
  // not just shape/text — applyVisualPayload's default branch previously
  // dropped both fields for any type outside its two explicit branches.
  it('persists fillColor and borderRadius for an image element', () => {
    const payload = imagePayload();
    const visual: VisualPayloadState = {
      ...readVisualPayload('image', payload),
      fillEnabled: true,
      fillColor: '#ff00aa',
      borderRadius: 12,
    };
    const next = applyVisualPayload('image', payload, visual) as ImageElementPayload;
    expect(next.fillColor).toBe('#ff00aa');
    expect(next.borderRadius).toBe(12);
    expect(next.src).toBe(payload.src);
  });

  it('persists fillColor and borderRadius for a video element', () => {
    const payload = videoPayload();
    const visual: VisualPayloadState = {
      ...readVisualPayload('video', payload),
      strokeEnabled: true,
      strokeColor: '#00aaff',
      strokeWidth: 3,
      borderRadius: 8,
    };
    const next = applyVisualPayload('video', payload, visual) as VideoElementPayload;
    expect(next.strokeEnabled).toBe(true);
    expect(next.strokeColor).toBe('#00aaff');
    expect(next.strokeWidth).toBe(3);
    expect(next.borderRadius).toBe(8);
    // Type-specific fields survive the shared basePatch merge untouched.
    expect(next.autoplay).toBe(false);
    expect(next.loop).toBe(false);
  });

  it('clamps a negative borderRadius to zero for every type', () => {
    const payload = imagePayload();
    const visual: VisualPayloadState = { ...readVisualPayload('image', payload), borderRadius: -5 };
    expect((applyVisualPayload('image', payload, visual) as ImageElementPayload).borderRadius).toBe(0);
  });

  it('still mirrors the legacy borderColor/borderWidth fields for shapes only', () => {
    const shapePayload = { fillColor: '#ffffff', borderColor: '#111111', borderWidth: 1, borderRadius: 0 };
    const visual: VisualPayloadState = {
      ...readVisualPayload('shape', shapePayload),
      strokeEnabled: true,
      strokeColor: '#123456',
      strokeWidth: 4,
    };
    const next = applyVisualPayload('shape', shapePayload, visual) as typeof shapePayload;
    expect(next.borderColor).toBe('#123456');
    expect(next.borderWidth).toBe(4);
  });
});

describe('readTextFormatting letterSpacing', () => {
  it('defaults to 0 when absent', () => {
    expect(readTextFormatting(textPayload()).letterSpacing).toBe(0);
  });

  it('reads an authored value through', () => {
    expect(readTextFormatting(textPayload({ letterSpacing: 2.5 })).letterSpacing).toBe(2.5);
  });
});

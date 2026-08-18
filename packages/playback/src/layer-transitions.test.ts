import { describe, expect, it } from 'vitest';
import { resolveLayerClearPlan, resolveMediaLayerTarget } from './layer-transitions';

describe('resolveMediaLayerTarget', () => {
  it('routes video assets to the video layer', () => {
    expect(resolveMediaLayerTarget('video')).toBe('video');
  });

  it('routes every other asset type to the media layer', () => {
    expect(resolveMediaLayerTarget('image')).toBe('media');
    expect(resolveMediaLayerTarget('audio')).toBe('media');
  });
});

describe('resolveLayerClearPlan', () => {
  it('clearing the media layer only clears media', () => {
    expect(resolveLayerClearPlan('media')).toEqual({
      clearsMediaLayer: true,
      clearsVideoLayer: false,
      hidesContentLayer: false,
      clearsOutputItem: false,
      clearsOverlays: false,
      statusText: 'Media layer cleared',
    });
  });

  it('clearing the video layer only clears video', () => {
    expect(resolveLayerClearPlan('video')).toEqual({
      clearsMediaLayer: false,
      clearsVideoLayer: true,
      hidesContentLayer: false,
      clearsOutputItem: false,
      clearsOverlays: false,
      statusText: 'Video layer cleared',
    });
  });

  it('clearing the content layer also releases the armed output item', () => {
    expect(resolveLayerClearPlan('content')).toEqual({
      clearsMediaLayer: false,
      clearsVideoLayer: false,
      hidesContentLayer: true,
      clearsOutputItem: true,
      clearsOverlays: false,
      statusText: 'Content layer cleared',
    });
  });

  it('clearing the overlay layer only clears overlays', () => {
    expect(resolveLayerClearPlan('overlay')).toEqual({
      clearsMediaLayer: false,
      clearsVideoLayer: false,
      hidesContentLayer: false,
      clearsOutputItem: false,
      clearsOverlays: true,
      statusText: 'Overlay layer cleared',
    });
  });
});

import type { ElementCreateInput, Id } from '@core/types';

// Small, deterministic factories for each slide element payload shape a
// fixture generator needs. Geometry and colors are derived from `index` so
// repeated calls in a loop produce varied-but-reproducible content instead
// of N identical rows.

export function textElementInput(slideId: Id, index: number, text: string): ElementCreateInput {
  return {
    slideId,
    type: 'text',
    x: 80,
    y: 80 + (index % 6) * 120,
    width: 1200,
    height: 100,
    zIndex: index,
    layer: 'content',
    payload: {
      text,
      fontFamily: 'Inter',
      fontSize: 48,
      color: '#ffffff',
      alignment: 'left',
    },
  };
}

export function shapeElementInput(slideId: Id, index: number): ElementCreateInput {
  return {
    slideId,
    type: 'shape',
    x: 40,
    y: 40,
    width: 1840,
    height: 1000,
    zIndex: index,
    layer: 'background',
    payload: {
      fillColor: index % 2 === 0 ? '#1a1a2e' : '#16213e',
      borderColor: '#0f3460',
      borderWidth: 0,
      borderRadius: 0,
    },
  };
}

export function imageElementInput(slideId: Id, index: number, src: string): ElementCreateInput {
  return {
    slideId,
    type: 'image',
    x: 200,
    y: 200,
    width: 800,
    height: 450,
    zIndex: index,
    layer: 'media',
    payload: { src },
  };
}

export function videoElementInput(slideId: Id, index: number, src: string): ElementCreateInput {
  return {
    slideId,
    type: 'video',
    x: 200,
    y: 200,
    width: 800,
    height: 450,
    zIndex: index,
    layer: 'media',
    payload: { src, autoplay: false, loop: false },
  };
}

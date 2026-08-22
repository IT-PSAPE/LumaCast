import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { RenderNode, TextElementPayload, VisualPayloadState } from '@lumacast/composition';
import * as composition from '@lumacast/composition';

let lastShapeProps: Record<string, unknown> | null = null;
let lastRectProps: Record<string, unknown> | null = null;
let fontWidthScale = 0.5;

vi.mock('react-konva', () => ({
  Rect: (props: Record<string, unknown>) => {
    lastRectProps = props;
    return null;
  },
  Shape: (props: Record<string, unknown>) => {
    lastShapeProps = props;
    return null;
  },
}));

vi.mock('@lumacast/composition', async () => {
  const actual = await vi.importActual<typeof import('@lumacast/composition')>('@lumacast/composition');
  return {
    ...actual,
    wrapRuns: vi.fn(actual.wrapRuns),
  };
});

vi.mock('./use-font-availability-epoch', () => ({
  useFontAvailabilityEpoch: vi.fn(() => 0),
}));

import { SceneNodeText } from './scene-node-text';
import { useFontAvailabilityEpoch } from './use-font-availability-epoch';

const VISUAL: VisualPayloadState = {
  visible: true,
  locked: false,
  flipX: false,
  flipY: false,
  fillEnabled: false,
  fillColor: 'transparent',
  strokeEnabled: false,
  strokeColor: '#111111',
  strokeWidth: 0,
  strokePosition: 'inside',
  borderRadius: 0,
  shadowEnabled: false,
  shadowColor: '#00000099',
  shadowBlur: 12,
  shadowOffsetX: 0,
  shadowOffsetY: 6,
};

function textPayload(overrides: Partial<TextElementPayload> = {}): TextElementPayload {
  return {
    text: 'Hello scene text',
    fontFamily: 'Inter',
    fontSize: 32,
    color: '#ffffff',
    alignment: 'left',
    verticalAlign: 'middle',
    lineHeight: 1.25,
    weight: '400',
    ...overrides,
  };
}

function renderNode(payloadOverrides: Partial<TextElementPayload> = {}, nodeOverrides: Partial<RenderNode> = {}): RenderNode {
  return {
    id: 'node-1',
    isVideo: false,
    visual: VISUAL,
    element: {
      id: 'element-1',
      slideId: 'slide-1',
      type: 'text',
      x: 0,
      y: 0,
      width: 240,
      height: 100,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      layer: 'content',
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
      payload: textPayload(payloadOverrides),
    },
    ...nodeOverrides,
  };
}

type RecordedOp =
  | { type: 'fillText'; text: string; x: number; y: number; font: string; color: string }
  | { type: 'strokeText'; text: string; x: number; y: number; font: string; color: string; width: number }
  | { type: 'drawImage'; width: number; height: number; x: number; y: number }
  | { type: 'beginPath' | 'closePath' | 'stroke' | 'save' | 'restore' }
  | { type: 'moveTo'; x: number; y: number }
  | { type: 'lineTo'; x: number; y: number };

class RecordingCanvasContext {
  ops: RecordedOp[] = [];
  font = '400 16px Inter';
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000000';
  lineWidth = 1;
  lineJoin: CanvasLineJoin = 'miter';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';

  save(): void {
    this.ops.push({ type: 'save' });
  }

  restore(): void {
    this.ops.push({ type: 'restore' });
  }

  beginPath(): void {
    this.ops.push({ type: 'beginPath' });
  }

  closePath(): void {
    this.ops.push({ type: 'closePath' });
  }

  moveTo(x: number, y: number): void {
    this.ops.push({ type: 'moveTo', x, y });
  }

  lineTo(x: number, y: number): void {
    this.ops.push({ type: 'lineTo', x, y });
  }

  stroke(): void {
    this.ops.push({ type: 'stroke' });
  }

  fillText(text: string, x: number, y: number): void {
    this.ops.push({ type: 'fillText', text, x, y, font: this.font, color: String(this.fillStyle) });
  }

  strokeText(text: string, x: number, y: number): void {
    this.ops.push({ type: 'strokeText', text, x, y, font: this.font, color: String(this.strokeStyle), width: this.lineWidth });
  }

  drawImage(image: { width: number; height: number }, x: number, y: number): void {
    this.ops.push({ type: 'drawImage', width: image.width, height: image.height, x, y });
  }

  measureText(text: string): TextMetrics {
    const size = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? '16');
    const weight = Number.parseInt(/(?:^| )(\d{3})(?: |$)/.exec(this.font)?.[1] ?? '400', 10);
    const italicScale = this.font.includes('italic') ? 1.1 : 1;
    const weightScale = weight >= 700 ? 1.3 : 1;
    return {
      width: text.length * size * fontWidthScale * italicScale * weightScale,
      actualBoundingBoxAscent: size * 0.9,
      actualBoundingBoxDescent: size * 0.2,
      fontBoundingBoxAscent: size * 0.9,
      fontBoundingBoxDescent: size * 0.2,
    } as TextMetrics;
  }
}

function cloneNode(node: RenderNode): RenderNode {
  return {
    ...node,
    visual: { ...node.visual },
    element: {
      ...node.element,
      payload: { ...(node.element.payload as TextElementPayload) },
    },
    bindingOverride: node.bindingOverride ? { ...node.bindingOverride } : undefined,
  };
}

function renderScene(node: RenderNode) {
  const view = render(<SceneNodeText node={node} />);
  expect(lastRectProps).not.toBeNull();
  expect(lastShapeProps).not.toBeNull();
  return {
    ...view,
    rectProps: lastRectProps!,
    shapeProps: lastShapeProps!,
  };
}

function invokeSceneFunc(shapeProps: Record<string, unknown>): RecordingCanvasContext {
  const target = new RecordingCanvasContext();
  const wrapper = {
    _context: target,
    fillStrokeShape: vi.fn(),
  };
  const sceneFunc = shapeProps.sceneFunc as (ctx: { _context: RecordingCanvasContext; fillStrokeShape: ReturnType<typeof vi.fn> }, shape: object) => void;
  sceneFunc(wrapper, {});
  expect(wrapper.fillStrokeShape).toHaveBeenCalledTimes(1);
  return target;
}

function fillTextStrings(ctx: RecordingCanvasContext): string[] {
  return ctx.ops
    .filter((op): op is Extract<RecordedOp, { type: 'fillText' }> => op.type === 'fillText')
    .map((op) => op.text);
}

const wrapRunsMock = vi.mocked(composition.wrapRuns);
const useFontAvailabilityEpochMock = vi.mocked(useFontAvailabilityEpoch);
const sceneFuncMutations: Array<[string, (node: RenderNode) => RenderNode]> = [
  ['body', (node) => cloneNode({ ...node, element: { ...node.element, payload: { ...(node.element.payload as TextElementPayload), text: 'Changed text' } } })],
  ['box', (node) => cloneNode({ ...node, element: { ...node.element, payload: { ...(node.element.payload as TextElementPayload), color: '#00ffaa' } } })],
  ['width', (node) => cloneNode({ ...node, element: { ...node.element, width: 320 } })],
  ['frame height', (node) => cloneNode({ ...node, element: { ...node.element, height: 140 } })],
  ['line height', (node) => cloneNode({ ...node, element: { ...node.element, payload: { ...(node.element.payload as TextElementPayload), lineHeight: 1.5 } } })],
  ['alignment', (node) => cloneNode({ ...node, element: { ...node.element, payload: { ...(node.element.payload as TextElementPayload), alignment: 'center' } } })],
  ['vertical alignment', (node) => cloneNode({ ...node, element: { ...node.element, payload: { ...(node.element.payload as TextElementPayload), verticalAlign: 'bottom' } } })],
  ['stroke enabled', (node) => cloneNode({ ...node, element: { ...node.element, payload: { ...(node.element.payload as TextElementPayload), textStrokeEnabled: true, textStrokeWidth: 2 } } })],
  ['resolved stroke width', (node) => cloneNode({ ...node, element: { ...node.element, payload: { ...(node.element.payload as TextElementPayload), textStrokeEnabled: true, textStrokeWidth: 3 } } })],
  ['fill-after stroke mode', (node) => cloneNode({ ...node, element: { ...node.element, payload: { ...(node.element.payload as TextElementPayload), textStrokeEnabled: true, textStrokeWidth: 2, textStrokePosition: 'outside' } } })],
  ['stroke color', (node) => cloneNode({ ...node, element: { ...node.element, payload: { ...(node.element.payload as TextElementPayload), textStrokeEnabled: true, textStrokeWidth: 2, textStrokeColor: '#ff00aa' } } })],
  ['inside stroke canvas', (node) => cloneNode({ ...node, element: { ...node.element, payload: { ...(node.element.payload as TextElementPayload), textStrokeEnabled: true, textStrokeWidth: 2, textStrokePosition: 'inside' } } })],
];

describe('SceneNodeText', () => {
  beforeEach(() => {
    lastRectProps = null;
    lastShapeProps = null;
    fontWidthScale = 0.5;
    wrapRunsMock.mockClear();
    useFontAvailabilityEpochMock.mockReturnValue(0);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId) => {
      if (contextId !== '2d') return null;
      return new RecordingCanvasContext() as unknown as CanvasRenderingContext2D;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps draw callback identities stable when the node values are unchanged', () => {
    const node = renderNode();
    const { rerender, shapeProps } = renderScene(node);
    const firstSceneFunc = shapeProps.sceneFunc;
    const firstHitFunc = shapeProps.hitFunc;

    rerender(<SceneNodeText node={cloneNode(node)} />);

    expect(lastShapeProps?.sceneFunc).toBe(firstSceneFunc);
    expect(lastShapeProps?.hitFunc).toBe(firstHitFunc);
  });

  it.each(sceneFuncMutations)('recreates sceneFunc when %s changes', (_label, mutate) => {
    const node = renderNode();
    const { rerender, shapeProps } = renderScene(node);
    const firstSceneFunc = shapeProps.sceneFunc;

    rerender(<SceneNodeText node={mutate(node)} />);

    expect(lastShapeProps?.sceneFunc).not.toBe(firstSceneFunc);
  });

  it('recreates hitFunc when the hit box changes', () => {
    const node = renderNode();
    const { rerender, shapeProps } = renderScene(node);
    const firstHitFunc = shapeProps.hitFunc;

    rerender(<SceneNodeText node={cloneNode({ ...node, element: { ...node.element, height: 140 } })} />);

    expect(lastShapeProps?.hitFunc).not.toBe(firstHitFunc);
  });

  it('prepares wrapped rich layout once for stable inputs and reruns when measurement inputs change', () => {
    const node = renderNode({
      format: 'rich',
      richBody: [{
        indent: 0,
        runs: [{ text: 'Stable rich text layout' }],
      }],
    });
    const { rerender } = renderScene(node);

    expect(wrapRunsMock).toHaveBeenCalledTimes(1);

    rerender(<SceneNodeText node={cloneNode(node)} />);
    expect(wrapRunsMock).toHaveBeenCalledTimes(1);

    rerender(<SceneNodeText node={cloneNode({ ...node, element: { ...node.element, width: 260 } })} />);
    expect(wrapRunsMock).toHaveBeenCalledTimes(2);
  });

  it('draws plain text unchanged through the scene callback', () => {
    const { shapeProps } = renderScene(renderNode({ text: 'Hello plain text' }));
    const ctx = invokeSceneFunc(shapeProps);

    expect(fillTextStrings(ctx).join(' ')).toBe('Hello plain text');
    expect(ctx.ops.filter((op) => op.type === 'fillText')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ font: '400 32px Inter', color: '#ffffff' }),
      ]),
    );
  });

  it('draws rich text with per-run styling intact', () => {
    const { shapeProps } = renderScene(renderNode({
      text: 'Hello',
      format: 'rich',
      richBody: [{
        indent: 0,
        runs: [
          { text: 'He', color: '#ff0000' },
          { text: 'llo', weight: 700, italic: true },
        ],
      }],
    }));
    const ctx = invokeSceneFunc(shapeProps);
    const fillOps = ctx.ops.filter((op) => op.type === 'fillText');

    expect(fillOps).toEqual([
      expect.objectContaining({ type: 'fillText', text: 'He', color: '#ff0000', font: '400 32px Inter' }),
      expect.objectContaining({ type: 'fillText', text: 'llo', color: '#ffffff', font: 'italic 700 32px Inter' }),
    ]);
  });

  it('draws bound text from the resolved binding value', () => {
    const node = renderNode(
      {
        text: 'Fallback',
        binding: { kind: 'current-slide-text' },
      },
      { bindingOverride: { currentSlideText: 'Resolved binding' } },
    );
    const { shapeProps } = renderScene(node);
    const ctx = invokeSceneFunc(shapeProps);

    expect(fillTextStrings(ctx).join(' ')).toBe('Resolved binding');
  });

  it('computes wrapped layout once per render and reuses it across repeated draws', () => {
    const { shapeProps } = renderScene(renderNode({
      format: 'rich',
      richBody: [{
        indent: 0,
        runs: [{ text: 'Caching wrap work for repeated draws' }],
      }],
    }));

    expect(wrapRunsMock).toHaveBeenCalledTimes(1);

    invokeSceneFunc(shapeProps);
    invokeSceneFunc(shapeProps);
    invokeSceneFunc(shapeProps);

    expect(wrapRunsMock).toHaveBeenCalledTimes(1);
  });

  it('recomputes layout when the font epoch changes and the font metrics change', () => {
    fontWidthScale = 0.2;
    const node = renderNode({ text: 'AA AA AA' }, {
      element: {
        ...renderNode().element,
        width: 80,
        payload: textPayload({ text: 'AA AA AA' }),
      },
    });
    const { rerender, shapeProps } = renderScene(node);
    const firstSceneFunc = shapeProps.sceneFunc;

    expect(wrapRunsMock).toHaveBeenCalledTimes(1);
    expect(invokeSceneFunc(shapeProps).ops.filter((op) => op.type === 'fillText')).toEqual([
      expect.objectContaining({ type: 'fillText', text: 'AA AA AA' }),
    ]);

    fontWidthScale = 0.4;
    useFontAvailabilityEpochMock.mockReturnValue(1);
    rerender(<SceneNodeText node={cloneNode(node)} />);

    expect(lastShapeProps?.sceneFunc).not.toBe(firstSceneFunc);
    expect(wrapRunsMock).toHaveBeenCalledTimes(2);
    expect(invokeSceneFunc(lastShapeProps!).ops.filter((op) => op.type === 'fillText')).toEqual([
      expect.objectContaining({ type: 'fillText', text: 'AA AA' }),
      expect.objectContaining({ type: 'fillText', text: 'AA' }),
    ]);
  });

  it('uses an auto-fit font size inside the scene callback', () => {
    const { shapeProps } = renderScene(renderNode({
      text: 'A long line that must shrink to fit',
      autoFit: true,
      autoFitMaxFontSize: 40,
      fontSize: 40,
      lineHeight: 1.1,
    }, {
      element: {
        ...renderNode().element,
        width: 120,
        height: 44,
        payload: textPayload({
          text: 'A long line that must shrink to fit',
          autoFit: true,
          autoFitMaxFontSize: 40,
          fontSize: 40,
          lineHeight: 1.1,
        }),
      },
    }));
    const ctx = invokeSceneFunc(shapeProps);
    const firstFill = ctx.ops.find((op) => op.type === 'fillText');
    const firstFontSize = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec((firstFill as Extract<RecordedOp, { type: 'fillText' }>).font)![1]);

    expect(firstFontSize).toBeLessThan(40);
  });

  it('uses list-marker-aware rich layout when auto-fitting rich text', () => {
    const { shapeProps } = renderScene(renderNode({
      autoFit: true,
      autoFitMaxFontSize: 40,
      fontSize: 40,
      lineHeight: 1.25,
      format: 'rich',
      richBody: [{
        indent: 0,
        listType: 'bullet',
        runs: [{ text: 'AA A' }],
      }],
    }, {
      element: {
        ...renderNode().element,
        width: 80,
        height: 50,
        payload: textPayload({
          autoFit: true,
          autoFitMaxFontSize: 40,
          fontSize: 40,
          lineHeight: 1.25,
          format: 'rich',
          richBody: [{
            indent: 0,
            listType: 'bullet',
            runs: [{ text: 'AA A' }],
          }],
        }),
      },
    }));
    const ctx = invokeSceneFunc(shapeProps);
    const firstFill = ctx.ops.find((op) => op.type === 'fillText' && op.text !== '• ');
    const firstFontSize = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec((firstFill as Extract<RecordedOp, { type: 'fillText' }>).font)![1]);

    expect(firstFontSize).toBeLessThan(40);
  });

  it('uses styled rich-run widths when auto-fitting rich text', () => {
    const { shapeProps } = renderScene(renderNode({
      autoFit: true,
      autoFitMaxFontSize: 40,
      fontSize: 40,
      lineHeight: 1.25,
      format: 'rich',
      richBody: [{
        indent: 0,
        runs: [{ text: 'WWWW', weight: 700, italic: true }],
      }],
    }, {
      element: {
        ...renderNode().element,
        width: 90,
        height: 50,
        payload: textPayload({
          autoFit: true,
          autoFitMaxFontSize: 40,
          fontSize: 40,
          lineHeight: 1.25,
          format: 'rich',
          richBody: [{
            indent: 0,
            runs: [{ text: 'WWWW', weight: 700, italic: true }],
          }],
        }),
      },
    }));
    const ctx = invokeSceneFunc(shapeProps);
    const firstFill = ctx.ops.find((op) => op.type === 'fillText');
    const firstFontSize = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec((firstFill as Extract<RecordedOp, { type: 'fillText' }>).font)![1]);

    expect(firstFontSize).toBeLessThan(40);
  });

  it('uses rich layout metrics when reserving list-marker width for the content frame', () => {
    const { shapeProps } = renderScene(renderNode({
      format: 'rich',
      richBody: [{
        indent: 0,
        listType: 'bullet',
        runs: [{ text: 'AA A' }],
      }],
    }, {
      element: {
        ...renderNode().element,
        width: 80,
        height: 20,
        payload: textPayload({
          format: 'rich',
          richBody: [{
            indent: 0,
            listType: 'bullet',
            runs: [{ text: 'AA A' }],
          }],
        }),
      },
    }));

    expect(shapeProps.height).toBe(80);
  });

  it('uses styled rich-run metrics when expanding the content frame height', () => {
    const { shapeProps } = renderScene(renderNode({
      format: 'rich',
      richBody: [{
        indent: 0,
        runs: [{ text: 'WWWW', weight: 700, italic: true }],
      }],
    }, {
      element: {
        ...renderNode().element,
        width: 80,
        height: 20,
        payload: textPayload({
          format: 'rich',
          richBody: [{
            indent: 0,
            runs: [{ text: 'WWWW', weight: 700, italic: true }],
          }],
        }),
      },
    }));

    expect(shapeProps.height).toBe(80);
  });

  it('renders inside stroke through the offscreen canvas path', () => {
    const { shapeProps } = renderScene(renderNode({
      text: 'Inside stroke',
      textStrokeEnabled: true,
      textStrokeWidth: 2,
      textStrokePosition: 'inside',
      textStrokeColor: '#00ffaa',
    }));
    const ctx = invokeSceneFunc(shapeProps);

    expect(ctx.ops).toContainEqual(expect.objectContaining({ type: 'drawImage' }));
    expect(ctx.ops.filter((op) => op.type === 'strokeText')).toHaveLength(0);
  });

  it('draws bullet list markers through the shared rich-text path', () => {
    const { shapeProps } = renderScene(renderNode({
      format: 'rich',
      richBody: [{
        indent: 0,
        listType: 'bullet',
        runs: [{ text: 'First item' }],
      }],
    }));
    const ctx = invokeSceneFunc(shapeProps);

    expect(ctx.ops.filter((op) => op.type === 'fillText')).toEqual([
      expect.objectContaining({ type: 'fillText', text: '• ', font: '400 32px Inter' }),
      expect.objectContaining({ type: 'fillText', text: 'First item', font: '400 32px Inter' }),
    ]);
  });

  it('draws outside stroke before fill using the expanded stroke width', () => {
    const { shapeProps } = renderScene(renderNode({
      text: 'Outlined text',
      textStrokeEnabled: true,
      textStrokeWidth: 2,
      textStrokePosition: 'outside',
      textStrokeColor: '#ff00aa',
    }));
    const ctx = invokeSceneFunc(shapeProps);
    const textOps = ctx.ops.filter((op) => op.type === 'strokeText' || op.type === 'fillText');

    expect(textOps[0]).toEqual(expect.objectContaining({
      type: 'strokeText',
      text: 'Outlined text',
      color: '#ff00aa',
      width: 4,
    }));
    expect(textOps[1]).toEqual(expect.objectContaining({
      type: 'fillText',
      text: 'Outlined text',
      color: '#ffffff',
    }));
  });

  it('applies case transforms before drawing', () => {
    const { shapeProps } = renderScene(renderNode({
      text: 'hello. next sentence',
      caseTransform: 'sentence',
    }));
    const ctx = invokeSceneFunc(shapeProps);

    expect(fillTextStrings(ctx).join(' ')).toBe('Hello. Next sentence');
  });

  it('advances each line by its own largest resolved size', () => {
    const { shapeProps } = renderScene(renderNode({
      format: 'rich',
      richBody: [
        { indent: 0, runs: [{ text: 'first', fontSize: 64 }] },
        { indent: 0, runs: [{ text: 'second' }] },
      ],
    }, {
      element: {
        ...renderNode().element,
        height: 20,
        payload: textPayload({
          format: 'rich',
          richBody: [
            { indent: 0, runs: [{ text: 'first', fontSize: 64 }] },
            { indent: 0, runs: [{ text: 'second' }] },
          ],
        }),
      },
    }));
    const ctx = invokeSceneFunc(shapeProps);
    const fillOps = ctx.ops.filter((op) => op.type === 'fillText') as Extract<RecordedOp, { type: 'fillText' }>[];
    expect(fillOps).toHaveLength(2);
    const y0 = fillOps[0].y;
    const y1 = fillOps[1].y;
    const delta = y1 - y0;
    // First line max 64 => advance 80, so delta = advance0 + translateY1 - translateY0 = 80 + 31.2 - 62.4 = 48.8
    // Uniform 32 would be 40, so mixed must be larger and equal to 80 + (0.35*32+20) - (0.35*64+40)
    const lineHeight = 1.25;
    const translate = (size: number) => 0.35 * size + (size * lineHeight) / 2;
    const expectedDelta = 64 * lineHeight + translate(32) - translate(64);
    expect(delta).toBeCloseTo(expectedDelta, 5);
    // Layout height is sum of per-line advances, not uniform * count
    expect(shapeProps.height).toBe(64 * lineHeight + 32 * lineHeight);
  });

  it('advances an all-shrunken line at its own resolved size, not the box size', () => {
    const { shapeProps } = renderScene(renderNode({
      format: 'rich',
      richBody: [{ indent: 0, runs: [{ text: 'tiny', fontSize: 16 }] }],
    }, {
      element: {
        ...renderNode().element,
        height: 20,
        payload: textPayload({
          format: 'rich',
          richBody: [{ indent: 0, runs: [{ text: 'tiny', fontSize: 16 }] }],
        }),
      },
    }));
    const ctx = invokeSceneFunc(shapeProps);
    const fillOp = ctx.ops.find((op): op is Extract<RecordedOp, { type: 'fillText' }> => op.type === 'fillText')!;
    // lineMax = 16 (not the box's 32): layoutHeight = 20, frame = max(20, 16, 20) = 20,
    // alignY = 0, translateY = 0.35*16 + (16*1.25)/2 = 15.6
    expect(fillOp.y).toBeCloseTo(0.35 * 16 + (16 * 1.25) / 2, 5);
    expect(shapeProps.height).toBe(20);
    expect(fillOp.font).toBe('400 16px Inter');
  });

  it('anchors a list-marker line at the box size even when all runs are shrunken', () => {
    const { shapeProps } = renderScene(renderNode({
      format: 'rich',
      richBody: [{ indent: 0, listType: 'bullet', runs: [{ text: 'tiny', fontSize: 16 }] }],
    }, {
      element: {
        ...renderNode().element,
        height: 20,
        payload: textPayload({
          format: 'rich',
          richBody: [{ indent: 0, listType: 'bullet', runs: [{ text: 'tiny', fontSize: 16 }] }],
        }),
      },
    }));
    const ctx = invokeSceneFunc(shapeProps);
    const fillOps = ctx.ops.filter((op): op is Extract<RecordedOp, { type: 'fillText' }> => op.type === 'fillText');
    expect(fillOps).toHaveLength(2);
    // The marker draws at the box font, so lineMax stays 32:
    // translateY = 0.35*32 + (32*1.25)/2 = 31.2 and both pieces share that baseline.
    const expectedBaseline = 0.35 * 32 + (32 * 1.25) / 2;
    expect(fillOps[0]).toEqual(expect.objectContaining({ text: '• ', font: '400 32px Inter' }));
    expect(fillOps[1]).toEqual(expect.objectContaining({ text: 'tiny', font: '400 16px Inter' }));
    expect(fillOps[0].y).toBeCloseTo(expectedBaseline, 5);
    expect(fillOps[1].y).toBeCloseTo(expectedBaseline, 5);
    expect(shapeProps.height).toBe(40);
  });

  it('keeps uniform-size layout pixel-identical to the single-size arithmetic', () => {
    const payload = textPayload({ fontSize: 32, lineHeight: 1.25 });
    const node = renderNode({}, {
      element: {
        ...renderNode().element,
        width: 240,
        height: 100,
        payload,
      },
    });
    const { shapeProps } = renderScene(node);
    const ctx = invokeSceneFunc(shapeProps);
    const fillOp = ctx.ops.find((op) => op.type === 'fillText') as Extract<RecordedOp, { type: 'fillText' }>;
    // Single line uniform: layoutHeight = 40, contentHeight = 32, frame 100, alignY = 30
    const ascent = 32 * 0.9;
    const descent = 32 * 0.2;
    const translateY = (ascent - descent) / 2 + (32 * 1.25) / 2;
    const layoutHeight = 32 * 1.25;
    const frameHeight = 100;
    const alignY = (frameHeight - layoutHeight) / 2;
    const expectedBaseline = alignY + translateY;
    expect(fillOp.y).toBeCloseTo(expectedBaseline, 5);
    expect(shapeProps.height).toBe(100);
    expect(fillOp.font).toBe('400 32px Inter');

    // Two uniform lines: use two plain blocks, each one line
    const node2 = renderNode({
      format: 'rich',
      richBody: [
        { indent: 0, runs: [{ text: 'a' }] },
        { indent: 0, runs: [{ text: 'b' }] },
      ],
    }, {
      element: {
        ...renderNode().element,
        width: 240,
        height: 20,
        payload: textPayload({
          format: 'rich',
          richBody: [
            { indent: 0, runs: [{ text: 'a' }] },
            { indent: 0, runs: [{ text: 'b' }] },
          ],
        }),
      },
    });
    const { shapeProps: shapeProps2 } = renderScene(node2);
    const ctx2 = invokeSceneFunc(shapeProps2);
    const fills2 = ctx2.ops.filter((op) => op.type === 'fillText') as Extract<RecordedOp, { type: 'fillText' }>[];
    const delta = fills2[1].y - fills2[0].y;
    expect(delta).toBeCloseTo(32 * 1.25, 5);
    // contentHeight = 32 + 40 =72, layoutHeight=80, max with element 20 =>80
    expect(shapeProps2.height).toBe(80);
  });

  it('draws underline and strikethrough from each piece own size', () => {
    const { shapeProps } = renderScene(renderNode({
      format: 'rich',
      richBody: [{
        indent: 0,
        runs: [
          { text: 'aa', fontSize: 16, underline: true },
          { text: 'bb', fontSize: 32, underline: true },
        ],
      }],
    }));
    const ctx = invokeSceneFunc(shapeProps);
    const fills = ctx.ops.filter((op) => op.type === 'fillText') as Extract<RecordedOp, { type: 'fillText' }>[];
    expect(fills).toHaveLength(2);
    const baseline = fills[0].y;
    expect(fills[1].y).toBe(baseline);
    const moveTos = ctx.ops.filter((op): op is Extract<RecordedOp, { type: 'moveTo' }> => op.type === 'moveTo');
    // Two underlines => two moveTos with different y = baseline + round(size/4)
    expect(moveTos).toHaveLength(2);
    const ySmall = baseline + Math.round(16 / 4);
    const yLarge = baseline + Math.round(32 / 4);
    const ys = moveTos.map((op) => op.y).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(ySmall, 5);
    expect(ys[1]).toBeCloseTo(yLarge, 5);

    // Strikethrough offset is baseline - round(size/4) and must also be per-piece
    const { shapeProps: shapeProps2 } = renderScene(renderNode({
      format: 'rich',
      richBody: [{
        indent: 0,
        runs: [
          { text: 'aa', fontSize: 16, strikethrough: true },
          { text: 'bb', fontSize: 48, strikethrough: true },
        ],
      }],
    }));
    const ctx2 = invokeSceneFunc(shapeProps2);
    const fills2 = ctx2.ops.filter((op) => op.type === 'fillText') as Extract<RecordedOp, { type: 'fillText' }>[];
    const base2 = fills2[0].y;
    const moves2 = ctx2.ops.filter((op): op is Extract<RecordedOp, { type: 'moveTo' }> => op.type === 'moveTo');
    expect(moves2).toHaveLength(2);
    const ys2 = moves2.map((op) => op.y).sort((a, b) => a - b);
    // Small strike higher (less negative) => larger y; large strike lower y
    expect(ys2[0]).toBeCloseTo(base2 - Math.round(48 / 4), 5);
    expect(ys2[1]).toBeCloseTo(base2 - Math.round(16 / 4), 5);
  });

  it('scales an explicit run size proportionally when auto-fitting', () => {
    const authored = 40;
    const explicit = 80;
    const { shapeProps } = renderScene(renderNode({
      autoFit: true,
      autoFitMaxFontSize: authored,
      fontSize: authored,
      lineHeight: 1.1,
      format: 'rich',
      richBody: [{
        indent: 0,
        runs: [
          { text: 'AA AA AA AA AA AA AA AA AA' },
          { text: 'BB', fontSize: explicit },
        ],
      }],
    }, {
      element: {
        ...renderNode().element,
        width: 120,
        height: 44,
        payload: textPayload({
          autoFit: true,
          autoFitMaxFontSize: authored,
          fontSize: authored,
          lineHeight: 1.1,
          format: 'rich',
          richBody: [{
            indent: 0,
            runs: [
              { text: 'AA AA AA AA AA AA AA AA AA' },
              { text: 'BB', fontSize: explicit },
            ],
          }],
        }),
      },
    }));
    const ctx = invokeSceneFunc(shapeProps);
    const fills = ctx.ops.filter((op) => op.type === 'fillText') as Extract<RecordedOp, { type: 'fillText' }>[];
    // Find the two distinct font sizes
    const sizes = fills.map((op) => Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(op.font)![1]));
    expect(sizes.length).toBeGreaterThanOrEqual(2);
    const boxSize = Math.min(...sizes);
    const runSize = Math.max(...sizes);
    expect(boxSize).toBeLessThan(authored);
    expect(runSize / boxSize).toBeCloseTo(explicit / authored, 5);
  });
});

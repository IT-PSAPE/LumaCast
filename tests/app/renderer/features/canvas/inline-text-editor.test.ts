import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { RichBoxStyle, RichBody, RichRange, SlideElement, TextElementPayload } from '@lumacast/composition';
import * as composition from '@lumacast/composition';

// The editor derives its own auto-fit size the way the canvas does; spying on
// the shared implementation lets the component tests below assert WHAT it was
// asked to size (the live body, not an empty one) without re-deriving the math.
vi.mock('@lumacast/composition', async (importActual) => {
  const actual = await importActual<typeof import('@lumacast/composition')>();
  return { ...actual, computeAutoFitRichTextFontSize: vi.fn(actual.computeAutoFitRichTextFontSize) };
});

// The real ColorPicker opens through a Popover that reads the workbench
// context, which the canvas editor supplies in the app but no unit test should
// have to stand up. Everything else in the toolbar renders as-is.
vi.mock('@renderer/components/form/color-picker', async () => {
  const { createElement: h } = await import('react');
  return {
    ColorPicker: ({ value }: { value: string }) => h('button', { type: 'button', 'data-testid': 'color-picker', 'data-value': value }),
  };
});

import {
  InlineTextEditor,
  blockMarkers,
  blockStructureChanged,
  bodyToHtml,
  domRangeFromRich,
  domToBody,
  richRangeFromDom,
} from '../../../../../app/renderer/features/canvas/inline-text-editor';

const BOX: RichBoxStyle = {
  fontFamily: 'Inter',
  fontSize: 48,
  color: '#ffffff',
  weight: 400,
  italic: false,
  underline: false,
  strikethrough: false,
};

function roundTrip(body: RichBody): RichBody {
  const root = document.createElement('div');
  root.innerHTML = bodyToHtml(body, BOX);
  return domToBody(root);
}

function parseHtml(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('RichTextEditor DOM ⇄ model serialization', () => {
  it('round-trips mixed runs, lists, and an empty block', () => {
    const body: RichBody = [
      { runs: [{ text: 'He' }, { text: 'llo', weight: 700 }], indent: 0 },
      { runs: [{ text: 'item' }], listType: 'bullet', indent: 0 },
      { runs: [{ text: '' }], indent: 0 },
    ];
    expect(roundTrip(body)).toEqual(body);
  });

  it('preserves every run-level override on a span', () => {
    const body: RichBody = [
      { runs: [{ text: 'x', color: '#ff0000', weight: 700, italic: true, underline: true, strikethrough: true }], indent: 0 },
    ];
    expect(roundTrip(body)).toEqual(body);
  });

  it('preserves a per-run font size override on a span', () => {
    const body: RichBody = [
      { runs: [{ text: 'sized', fontSize: 72 }], indent: 0 },
    ];
    expect(roundTrip(body)).toEqual(body);
  });

  it('preserves a sized run alongside the other overrides on one span', () => {
    const body: RichBody = [
      { runs: [{ text: 'x', color: '#ff0000', weight: 700, italic: true, underline: true, strikethrough: true, fontSize: 72 }], indent: 0 },
    ];
    expect(roundTrip(body)).toEqual(body);
  });

  it('does not coalesce adjacent runs of different sizes', () => {
    const body: RichBody = [
      { runs: [{ text: 'a', fontSize: 24 }, { text: 'b', fontSize: 96 }], indent: 0 },
    ];
    // Two differently-sized runs must survive the round-trip as separate runs.
    expect(roundTrip(body)).toEqual(body);
  });

  it('round-trips a numbered list', () => {
    const body: RichBody = [
      { runs: [{ text: 'one' }], listType: 'number', indent: 0 },
      { runs: [{ text: 'two' }], listType: 'number', indent: 0 },
    ];
    expect(roundTrip(body)).toEqual(body);
  });

  it('coalesces adjacent runs that serialize to the same style', () => {
    const body: RichBody = [{ runs: [{ text: 'a' }, { text: 'b' }], indent: 0 }];
    // Two plain runs collapse to one on the round-trip (both inherit the box).
    expect(roundTrip(body)).toEqual([{ runs: [{ text: 'ab' }], indent: 0 }]);
  });

  it('escapes HTML metacharacters in run text', () => {
    const body: RichBody = [{ runs: [{ text: '<b>&"' }], indent: 0 }];
    expect(roundTrip(body)).toEqual(body);
  });
});

// The editor renders the element's text VISIBLY (the canvas hides its own copy
// while editing), so every run span must carry the resolved paint style — colour
// and decorations included — not just the structural data-* overrides.
describe('RichTextEditor run span styling', () => {
  it('paints each run with its resolved colour', () => {
    const body: RichBody = [{ runs: [{ text: 'a' }, { text: 'b', color: '#ff0000' }], indent: 0 }];
    const spans = parseHtml(bodyToHtml(body, BOX)).querySelectorAll('span');
    // The un-overridden run inherits the box colour rather than rendering transparent.
    expect(spans[0].style.color).toBe('rgb(255, 255, 255)');
    expect(spans[1].style.color).toBe('rgb(255, 0, 0)');
  });

  it('writes the resolved decorations, and an explicit none when there are none', () => {
    const body: RichBody = [
      { runs: [{ text: 'plain' }], indent: 0 },
      { runs: [{ text: 'u', underline: true }], indent: 0 },
      { runs: [{ text: 's', strikethrough: true }], indent: 0 },
      { runs: [{ text: 'both', underline: true, strikethrough: true }], indent: 0 },
    ];
    const spans = parseHtml(bodyToHtml(body, BOX)).querySelectorAll('span');
    expect(spans[0].style.textDecoration).toBe('none');
    expect(spans[1].style.textDecoration).toBe('underline');
    expect(spans[2].style.textDecoration).toBe('line-through');
    expect(spans[3].style.textDecoration).toBe('underline line-through');
  });

  it('writes weight and italic from the resolved run style', () => {
    const body: RichBody = [{ runs: [{ text: 'a' }, { text: 'b', weight: 700, italic: true }], indent: 0 }];
    const spans = parseHtml(bodyToHtml(body, BOX)).querySelectorAll('span');
    expect(spans[0].style.fontWeight).toBe('400');
    expect(spans[0].style.fontStyle).toBe('normal');
    expect(spans[1].style.fontWeight).toBe('700');
    expect(spans[1].style.fontStyle).toBe('italic');
  });

  it('emits an em font-size only for a run that overrides the size', () => {
    const body: RichBody = [{ runs: [{ text: 'a' }, { text: 'b', fontSize: 24 }], indent: 0 }];
    const spans = parseHtml(bodyToHtml(body, BOX)).querySelectorAll('span');
    // No override ⇒ no font-size at all, so the run inherits the (scaled,
    // auto-fitted) container size.
    expect(spans[0].style.fontSize).toBe('');
    expect(spans[1].style.fontSize).toBe('0.5em');
  });

  it('never emits synthetic highlight markup', () => {
    const body: RichBody = [{ runs: [{ text: 'Hello World' }], indent: 0 }];
    expect(bodyToHtml(body, BOX)).not.toContain('rt-highlight');
    expect(bodyToHtml(body, BOX, null)).not.toContain('rt-highlight');
    expect(bodyToHtml(body, BOX, { markerWidthEm: () => 1 })).not.toContain('rt-highlight');
  });
});

describe('RichTextEditor list markers', () => {
  it('returns the canvas marker per block and restarts numbering after a plain block', () => {
    const body: RichBody = [
      { runs: [{ text: 'one' }], listType: 'number', indent: 0 },
      { runs: [{ text: 'two' }], listType: 'number', indent: 0 },
      { runs: [{ text: 'plain' }], indent: 0 },
      { runs: [{ text: 'restarted' }], listType: 'number', indent: 0 },
      { runs: [{ text: 'dot' }], listType: 'bullet', indent: 0 },
    ];
    expect(blockMarkers(body)).toEqual(['1. ', '2. ', undefined, '1. ', '• ']);
  });

  it('hangs each marker on the block with the measured marker column width', () => {
    const body: RichBody = [
      { runs: [{ text: 'dot' }], listType: 'bullet', indent: 0 },
      { runs: [{ text: 'one' }], listType: 'number', indent: 0 },
      { runs: [{ text: 'plain' }], indent: 0 },
    ];
    const widths: string[] = [];
    const root = parseHtml(bodyToHtml(body, BOX, {
      markerWidthEm: (marker) => {
        widths.push(marker);
        return marker.length;
      },
    }));
    const blocks = Array.from(root.children) as HTMLElement[];

    expect(widths).toEqual(['• ', '1. ']);
    expect(blocks[0].getAttribute('data-marker')).toBe('• ');
    expect(blocks[0].style.getPropertyValue('--rt-marker-w')).toBe('2em');
    expect(blocks[1].getAttribute('data-marker')).toBe('1. ');
    expect(blocks[1].style.getPropertyValue('--rt-marker-w')).toBe('3em');
    // A non-list block reserves no marker column at all.
    expect(blocks[2].hasAttribute('data-marker')).toBe(false);
    expect(blocks[2].style.getPropertyValue('--rt-marker-w')).toBe('');
  });

  it('round-trips through domToBody without the marker attribute or CSS var leaking into the model', () => {
    const body: RichBody = [
      { runs: [{ text: 'one' }], listType: 'number', indent: 0 },
      { runs: [{ text: 'plain' }], indent: 0 },
      { runs: [{ text: 'dot' }], listType: 'bullet', indent: 0 },
    ];
    const root = parseHtml(bodyToHtml(body, BOX, { markerWidthEm: (marker) => marker.length }));
    expect(root.querySelector('[data-marker]')).not.toBeNull();
    expect(domToBody(root)).toEqual(body);
  });
});

describe('blockStructureChanged', () => {
  it('is false when only the text of the blocks differs', () => {
    const previous: RichBody = [{ runs: [{ text: 'one' }], indent: 0 }, { runs: [{ text: 'two' }], indent: 0 }];
    const next: RichBody = [{ runs: [{ text: 'one!' }], indent: 0 }, { runs: [{ text: '' }], indent: 0 }];
    expect(blockStructureChanged(previous, next)).toBe(false);
  });

  it('is true when a block is removed or added', () => {
    const previous: RichBody = [{ runs: [{ text: 'one' }], indent: 0 }, { runs: [{ text: 'two' }], indent: 0 }];
    expect(blockStructureChanged(previous, [{ runs: [{ text: 'onetwo' }], indent: 0 }])).toBe(true);
    expect(blockStructureChanged([{ runs: [{ text: 'onetwo' }], indent: 0 }], previous)).toBe(true);
  });

  it('is true when a block changes list type', () => {
    const previous: RichBody = [{ runs: [{ text: 'one' }], indent: 0 }];
    expect(blockStructureChanged(previous, [{ runs: [{ text: 'one' }], listType: 'bullet', indent: 0 }])).toBe(true);
    expect(blockStructureChanged(
      [{ runs: [{ text: 'one' }], listType: 'bullet', indent: 0 }],
      [{ runs: [{ text: 'one' }], listType: 'number', indent: 0 }],
    )).toBe(true);
  });
});

describe('model ⇄ DOM range mapping', () => {
  const body: RichBody = [
    { runs: [{ text: 'Hello ' }, { text: 'World', weight: 700 }], indent: 0 },
    { runs: [{ text: '' }], indent: 0 },
    { runs: [{ text: 'third' }], indent: 0 },
  ];

  function mountBody(): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = bodyToHtml(body, BOX);
    document.body.appendChild(root);
    return root;
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it.each<[string, RichRange, string]>([
    ['inside a single run', { start: { block: 0, offset: 1 }, end: { block: 0, offset: 4 } }, 'ell'],
    ['across a run boundary', { start: { block: 0, offset: 3 }, end: { block: 0, offset: 8 } }, 'lo Wo'],
    ['to the end of a block', { start: { block: 0, offset: 6 }, end: { block: 0, offset: 11 } }, 'World'],
    ['across blocks', { start: { block: 0, offset: 6 }, end: { block: 2, offset: 5 } }, 'Worldthird'],
    ['collapsed in an empty block', { start: { block: 1, offset: 0 }, end: { block: 1, offset: 0 } }, ''],
    ['from an empty block into the next', { start: { block: 1, offset: 0 }, end: { block: 2, offset: 2 } }, 'th'],
  ])('round-trips a range %s', (_label, richRange, text) => {
    const root = mountBody();
    const domRange = domRangeFromRich(root, richRange);

    expect(domRange).not.toBeNull();
    expect(domRange!.toString()).toBe(text);
    expect(richRangeFromDom(root, domRange!)).toEqual(richRange);
  });

  it('maps a hand-built DOM range back to model offsets', () => {
    const root = mountBody();
    const bold = root.querySelectorAll('span')[1];
    const range = document.createRange();
    range.setStart(bold.firstChild!, 1);
    range.setEnd(bold.firstChild!, 3);

    // 'Hello ' is 6 characters, so offset 1 into the second run is model offset 7.
    expect(richRangeFromDom(root, range)).toEqual({ start: { block: 0, offset: 7 }, end: { block: 0, offset: 9 } });
  });

  it('returns null for a range that is not inside the editor root', () => {
    const root = mountBody();
    const outside = document.createElement('div');
    outside.textContent = 'elsewhere';
    document.body.appendChild(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);

    expect(richRangeFromDom(root, range)).toBeNull();
  });

  it('returns null when the model position names a block that does not exist', () => {
    const root = mountBody();
    expect(domRangeFromRich(root, { start: { block: 9, offset: 0 }, end: { block: 9, offset: 0 } })).toBeNull();
  });
});

// ── Component ────────────────────────────────────────────────

const SCENE_OFFSET_X = 5;
const SCENE_OFFSET_Y = 7;
const SCENE_SCALE = 2;

function textElement(payload: Partial<TextElementPayload> = {}, overrides: Partial<SlideElement> = {}): SlideElement {
  return {
    id: 'element-1',
    slideId: 'slide-1',
    type: 'text',
    x: 10,
    y: 20,
    width: 200,
    height: 100,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    layer: 'content',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    payload: {
      text: 'Hello world',
      fontFamily: 'Inter',
      fontSize: 48,
      color: '#ffffff',
      alignment: 'left',
      verticalAlign: 'middle',
      lineHeight: 1.25,
      weight: '400',
      ...payload,
    } as unknown as SlideElement['payload'],
    ...overrides,
  } as SlideElement;
}

interface EditorHandles {
  frame: HTMLElement;
  editable: HTMLElement;
  onCommit: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
  onLiveChange: ReturnType<typeof vi.fn>;
  view: ReturnType<typeof render>;
}

async function mountEditor(element: SlideElement, editingTextId = element.id): Promise<EditorHandles> {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const onLiveChange = vi.fn();
  const view = render(createElement(InlineTextEditor, {
    editingTextId,
    effectiveElements: [element],
    sceneOffsetX: SCENE_OFFSET_X,
    sceneOffsetY: SCENE_OFFSET_Y,
    sceneScale: SCENE_SCALE,
    onCommit,
    onCancel,
    onLiveChange,
  }));
  // The mount effect focuses on the next animation frame.
  await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
  return {
    view,
    onCommit,
    onCancel,
    onLiveChange,
    frame: view.getByTestId('inline-text-editor-frame'),
    editable: view.getByRole('textbox'),
  };
}

const autoFitSpy = vi.mocked(composition.computeAutoFitRichTextFontSize);

beforeEach(() => {
  autoFitSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('InlineTextEditor frame geometry', () => {
  it('sits exactly on the element bounds in screen pixels', async () => {
    const { frame } = await mountEditor(textElement());

    // left = sceneOffsetX + x * scale, top = sceneOffsetY + y * scale.
    expect(frame.style.left).toBe('25px');
    expect(frame.style.top).toBe('47px');
    expect(frame.style.width).toBe('400px');
    expect(frame.style.height).toBe('200px');
    // The column flexbox is what reproduces the canvas's vertical placement;
    // it comes from the utility classes rather than an inline style.
    expect(frame.classList.contains('flex')).toBe(true);
    expect(frame.classList.contains('flex-col')).toBe(true);
    expect(frame.style.transformOrigin).toBe('top left');
  });

  it.each<[TextElementPayload['verticalAlign'] | undefined, string]>([
    ['top', 'flex-start'],
    ['middle', 'center'],
    [undefined, 'center'],
    ['bottom', 'flex-end'],
  ])('justifies content for verticalAlign %s', async (verticalAlign, justify) => {
    const { frame } = await mountEditor(textElement({ verticalAlign }));
    expect(frame.style.justifyContent).toBe(justify);
  });

  it('carries the element opacity', async () => {
    const { frame } = await mountEditor(textElement({}, { opacity: 0.4 }));
    expect(frame.style.opacity).toBe('0.4');
  });

  it('writes no transform for an unrotated, unflipped element', async () => {
    const { frame } = await mountEditor(textElement());
    expect(frame.style.transform).toBe('');
  });

  it('rotates about the top-left corner', async () => {
    const { frame } = await mountEditor(textElement({}, { rotation: 30 }));
    expect(frame.style.transform).toBe('rotate(30deg)');
  });

  it.each<[string, Partial<TextElementPayload>, string]>([
    ['horizontally', { flipX: true }, 'scale(-1, 1) translate(-400px, 0px)'],
    ['vertically', { flipY: true }, 'scale(1, -1) translate(0px, -200px)'],
    ['both ways', { flipX: true, flipY: true }, 'scale(-1, -1) translate(-400px, -200px)'],
  ])('mirrors the frame when the element is flipped %s', async (_label, payload, transform) => {
    const { frame } = await mountEditor(textElement(payload));
    expect(frame.style.transform).toBe(transform);
  });

  it('composes rotation before the flip, as the canvas group does', async () => {
    const { frame } = await mountEditor(textElement({ flipX: true }, { rotation: 45 }));
    expect(frame.style.transform).toBe('rotate(45deg) scale(-1, 1) translate(-400px, 0px)');
  });
});

describe('InlineTextEditor text styling', () => {
  it('paints the element font, colour, and wrapping onto the editable', async () => {
    const { editable } = await mountEditor(textElement({
      color: '#ff8800',
      weight: '700',
      italic: true,
      lineHeight: 1.5,
      alignment: 'end',
    }));

    // The text is visible in the DOM now, so the colour must be the real one.
    expect(editable.style.color).toBe('rgb(255, 136, 0)');
    expect(editable.style.color).not.toBe('transparent');
    expect(editable.style.fontFamily).toBe('Inter');
    expect(editable.style.fontWeight).toBe('700');
    expect(editable.style.fontStyle).toBe('italic');
    expect(editable.style.lineHeight).toBe('1.5');
    expect(editable.style.textAlign).toBe('right');
    expect(editable.style.whiteSpace).toBe('pre-wrap');
    expect(editable.style.overflowWrap).toBe('break-word');
  });

  it('scales the base font size by the scene scale', async () => {
    const { editable } = await mountEditor(textElement({ fontSize: 48 }));
    expect(editable.style.fontSize).toBe('96px');
  });

  it.each<[TextElementPayload['caseTransform'] | undefined, string]>([
    ['uppercase', 'uppercase'],
    ['sentence', 'none'],
    ['none', 'none'],
    [undefined, 'none'],
  ])('applies text-transform for caseTransform %s', async (caseTransform, expected) => {
    const { editable } = await mountEditor(textElement({ caseTransform }));
    expect(editable.style.textTransform).toBe(expected);
  });

  it('doubles an outside text stroke and paints it under the fill', async () => {
    const { editable } = await mountEditor(textElement({
      textStrokeEnabled: true,
      textStrokeWidth: 3,
      textStrokePosition: 'outside',
      textStrokeColor: '#ff00aa',
    }));

    // width * 2 * scale.
    expect(editable.style.getPropertyValue('-webkit-text-stroke')).toBe('12px #ff00aa');
    expect(editable.style.getPropertyValue('paint-order')).toBe('stroke fill');
  });

  it('draws a centre stroke at the authored width over the fill', async () => {
    const { editable } = await mountEditor(textElement({
      textStrokeEnabled: true,
      textStrokeWidth: 3,
      textStrokePosition: 'center',
      textStrokeColor: '#ff00aa',
    }));

    expect(editable.style.getPropertyValue('-webkit-text-stroke')).toBe('6px #ff00aa');
    expect(editable.style.getPropertyValue('paint-order')).toBe('');
  });

  it('writes no stroke when the stroke is disabled or zero width', async () => {
    const disabled = await mountEditor(textElement({ textStrokeEnabled: false, textStrokeWidth: 3 }));
    expect(disabled.editable.style.getPropertyValue('-webkit-text-stroke')).toBe('');
    cleanup();

    const zeroWidth = await mountEditor(textElement({ textStrokeEnabled: true, textStrokeWidth: 0 }));
    expect(zeroWidth.editable.style.getPropertyValue('-webkit-text-stroke')).toBe('');
  });

  it('scales the text shadow offsets and blur by the scene scale', async () => {
    const { editable } = await mountEditor(textElement({
      textShadowEnabled: true,
      textShadowOffsetX: 2,
      textShadowOffsetY: 4,
      textShadowBlur: 6,
      textShadowColor: '#000000',
    }));

    expect(editable.style.textShadow).toBe('4px 8px 12px #000000');
  });

  it('writes no text shadow when the shadow is disabled', async () => {
    const { editable } = await mountEditor(textElement({ textShadowEnabled: false, textShadowOffsetX: 2 }));
    expect(editable.style.textShadow).toBe('');
  });

  it.each<['top' | 'middle' | 'bottom', 'marginTop' | 'marginBottom' | null]>([
    ['top', 'marginTop'],
    ['bottom', 'marginBottom'],
    ['middle', null],
  ])('bleeds a line-height under 1 outward for verticalAlign %s', async (verticalAlign, edge) => {
    const lineHeight = 0.8;
    const { editable } = await mountEditor(textElement({ verticalAlign, lineHeight }));
    // textLineBleedPadding(fontSize * scale, lineHeight) = (96 - 96 * 0.8) / 2.
    const expected = (48 * SCENE_SCALE - 48 * SCENE_SCALE * lineHeight) / 2;

    if (edge === null) {
      expect(editable.style.marginTop).toBe('');
      expect(editable.style.marginBottom).toBe('');
      return;
    }
    expect(Number.parseFloat(editable.style[edge])).toBeCloseTo(-expected, 6);
    const other = edge === 'marginTop' ? 'marginBottom' : 'marginTop';
    expect(editable.style[other]).toBe('');
  });

  it('adds no bleed margin when the line height is at least 1', async () => {
    const { editable } = await mountEditor(textElement({ verticalAlign: 'top', lineHeight: 1.25 }));
    expect(editable.style.marginTop).toBe('');
    expect(editable.style.marginBottom).toBe('');
  });
});

describe('InlineTextEditor auto-fit sizing', () => {
  const LONG = 'The quick brown fox jumps over the lazy dog again and again and again';

  it('uses the authored size when auto-fit is off', async () => {
    const { editable } = await mountEditor(textElement({ autoFit: false, fontSize: 48, text: LONG }));

    expect(autoFitSpy).not.toHaveBeenCalled();
    expect(editable.style.fontSize).toBe('96px');
  });

  it('sizes the FIRST render against the real body, not an empty one', async () => {
    // Regression: the auto-fit size used to be computed against an empty body on
    // mount, so re-opening a long text briefly reverted it to the maximum size.
    const richBody: RichBody = [{ runs: [{ text: LONG }], indent: 0 }];
    await mountEditor(textElement({
      autoFit: true,
      autoFitMaxFontSize: 48,
      fontSize: 48,
      format: 'rich',
      richBody,
      text: LONG,
    }));

    expect(autoFitSpy).toHaveBeenCalled();
    const first = autoFitSpy.mock.calls[0][0];
    expect(first.body).toEqual(richBody);
    expect(first.body).not.toEqual([]);
    expect(first.width).toBe(200);
    expect(first.height).toBe(100);
    expect(first.maxFontSize).toBe(48);
  });

  it('shrinks a long body below the auto-fit maximum on the first render', async () => {
    const { computeAutoFitRichTextFontSize: actualAutoFit, boxStyleFromPayload, normalizeFontFamily } =
      await vi.importActual<typeof import('@lumacast/composition')>('@lumacast/composition');
    const payload = { autoFit: true, autoFitMaxFontSize: 48, fontSize: 48, text: LONG } satisfies Partial<TextElementPayload>;
    const element = textElement(payload);
    const box = boxStyleFromPayload(element.payload as unknown as TextElementPayload);
    const expected = actualAutoFit({
      body: [{ runs: [{ text: LONG }], indent: 0 }],
      box: { ...box, fontFamily: normalizeFontFamily(box.fontFamily) },
      width: 200,
      height: 100,
      lineHeight: 1.25,
      maxFontSize: 48,
    });

    const { editable } = await mountEditor(element);

    expect(expected).toBeLessThan(48);
    expect(Number.parseFloat(editable.style.fontSize)).toBeCloseTo(expected * SCENE_SCALE, 6);
  });

  it('keeps the auto-fit maximum for a body that already fits', async () => {
    const { editable } = await mountEditor(textElement({
      autoFit: true,
      autoFitMaxFontSize: 48,
      fontSize: 48,
      text: 'Hi',
    }));

    expect(autoFitSpy.mock.results[0].value).toBe(48);
    expect(editable.style.fontSize).toBe('96px');
  });
});

describe('InlineTextEditor editing behaviour', () => {
  it('paints the model into the editable and focuses it on mount', async () => {
    const richBody: RichBody = [
      { runs: [{ text: 'first' }], indent: 0 },
      { runs: [{ text: 'second' }], listType: 'bullet', indent: 0 },
    ];
    const { editable } = await mountEditor(textElement({ format: 'rich', richBody }));

    expect(editable.querySelectorAll('.rt-block')).toHaveLength(2);
    expect(editable.textContent).toBe('firstsecond');
    expect(editable.querySelectorAll('.rt-block')[1].getAttribute('data-marker')).toBe('• ');
    expect(document.activeElement).toBe(editable);
  });

  it('synthesizes a plain payload into one block per hard line', async () => {
    const { editable } = await mountEditor(textElement({ text: 'one\ntwo' }));
    expect(editable.querySelectorAll('.rt-block')).toHaveLength(2);
    expect(domToBody(editable)).toEqual([
      { runs: [{ text: 'one' }], indent: 0 },
      { runs: [{ text: 'two' }], indent: 0 },
    ]);
  });

  it('reports plain typing without rewriting the DOM', async () => {
    const { editable, onLiveChange } = await mountEditor(textElement({ text: 'Hello world' }));
    const nodesBefore = Array.from(editable.childNodes);
    const textNode = editable.querySelector('span')!.firstChild!;

    textNode.textContent = 'Hello world!';
    fireEvent.input(editable);

    expect(onLiveChange).toHaveBeenCalledTimes(1);
    expect(onLiveChange).toHaveBeenCalledWith([{ runs: [{ text: 'Hello world!' }], indent: 0 }]);
    // Untouched: rewriting here would destroy the caret on every keystroke.
    expect(Array.from(editable.childNodes)).toEqual(nodesBefore);
    expect(editable.querySelector('span')!.firstChild).toBe(textNode);
  });

  it('rewrites the DOM from the model when a block merge changes the structure', async () => {
    const { editable, onLiveChange } = await mountEditor(textElement({
      format: 'rich',
      richBody: [{ runs: [{ text: 'one' }], indent: 0 }, { runs: [{ text: 'two' }], indent: 0 }],
    }));
    const firstBlock = editable.firstElementChild!;
    const secondBlock = editable.children[1] as HTMLElement;

    // What the browser does on Backspace at the head of the second block.
    while (secondBlock.firstChild) firstBlock.appendChild(secondBlock.firstChild);
    secondBlock.remove();
    fireEvent.input(editable);

    expect(onLiveChange).toHaveBeenCalledTimes(1);
    expect(onLiveChange).toHaveBeenCalledWith([{ runs: [{ text: 'onetwo' }], indent: 0 }]);
    expect(editable.querySelectorAll('.rt-block')).toHaveLength(1);
    // Re-rendered from the model rather than left as the browser's own markup.
    expect(editable.firstElementChild).not.toBe(firstBlock);
    expect(editable.textContent).toBe('onetwo');
  });

  it('cancels on Escape without committing', async () => {
    const { editable, onCancel, onCommit } = await mountEditor(textElement());

    fireEvent.keyDown(editable, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits exactly once on a pointerdown outside the editor', async () => {
    const { onCommit } = await mountEditor(textElement({ text: 'Hello world' }));

    fireEvent.pointerDown(document.body);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith([{ runs: [{ text: 'Hello world' }], indent: 0 }]);

    // A second outside pointerdown must not commit again.
    fireEvent.pointerDown(document.body);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('commits the live body, not the body it opened with', async () => {
    const { editable, onCommit } = await mountEditor(textElement({ text: 'Hello world' }));
    editable.querySelector('span')!.firstChild!.textContent = 'Edited';
    fireEvent.input(editable);

    fireEvent.pointerDown(document.body);

    expect(onCommit).toHaveBeenCalledWith([{ runs: [{ text: 'Edited' }], indent: 0 }]);
  });

  it('does not commit on a pointerdown inside the frame or the toolbar', async () => {
    const { frame, editable, onCommit, view } = await mountEditor(textElement());

    fireEvent.pointerDown(frame);
    fireEvent.pointerDown(editable);
    fireEvent.pointerDown(view.getByRole('group', { name: 'Text formatting' }));

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('renders nothing when the editing target is not in the effective elements', async () => {
    const view = render(createElement(InlineTextEditor, {
      editingTextId: 'missing-element',
      effectiveElements: [textElement()],
      sceneOffsetX: SCENE_OFFSET_X,
      sceneOffsetY: SCENE_OFFSET_Y,
      sceneScale: SCENE_SCALE,
      onCommit: vi.fn(),
      onCancel: vi.fn(),
    }));
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });

    expect(view.container.innerHTML).toBe('');
    expect(view.queryByTestId('inline-text-editor-frame')).toBeNull();
  });

  it('renders the toolbar above the frame for an unbound element', async () => {
    const { view } = await mountEditor(textElement());

    expect(view.getByRole('group', { name: 'Text formatting' })).not.toBeNull();
    expect(view.getByRole('group', { name: 'List type' })).not.toBeNull();
    expect(view.getByLabelText('Font size')).not.toBeNull();
    expect(view.getByTestId('color-picker')).not.toBeNull();
  });

  it('renders the editable but no toolbar for a bound element', async () => {
    const { view, editable } = await mountEditor(textElement({
      binding: { kind: 'clock', clockFormat: '24h' },
      text: '12:00',
    }));

    expect(document.body.contains(editable)).toBe(true);
    expect(editable.textContent).toBe('12:00');
    expect(view.queryByRole('group', { name: 'Text formatting' })).toBeNull();
    expect(view.queryByRole('group', { name: 'List type' })).toBeNull();
    expect(view.queryByTestId('color-picker')).toBeNull();
  });
});

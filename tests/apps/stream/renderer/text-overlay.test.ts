import { describe, expect, it, vi } from 'vitest';
import { createDefaultTextStyle, type StreamSource } from '../../../../apps/stream/shared/desktop-api';
import { drawTextSource, wrapTextToWidth } from '../../../../apps/stream/renderer/text-overlay';

describe('Stream text source layout', () => {
  it('wraps long words and keeps explicit blank lines', () => {
    expect(wrapTextToWidth('LongWord\n\nAB CD', 12, (text) => text.length * 6))
      .toEqual(['Lo', 'ng', 'Wo', 'rd', '', 'AB', 'CD']);
  });

  it('preserves repeated spaces when they fit on a line', () => {
    expect(wrapTextToWidth('AB  CD', 36, (text) => text.length * 6)).toEqual(['AB  CD']);
  });

  it('clips styled, aligned text to the source bounds', () => {
    const style = createDefaultTextStyle();
    style.fontSize = 10;
    style.horizontalAlignment = 'center';
    style.verticalAlignment = 'center';
    style.outline = { enabled: true, color: '#123456', width: 2 };
    style.shadow = { enabled: true, color: '#000000', blur: 3, offsetX: 1, offsetY: 2 };
    style.background = { color: '#abcdef', opacity: 0.5 };
    const source: StreamSource = {
      id: 'title', name: 'Title', kind: 'text', visible: true, muted: false, volume: 1,
      transform: { x: 10, y: 10, width: 24, height: 50 }, text: 'AB CD\nE', color: '#ffffff', textStyle: style,
    };
    const fillText = vi.fn();
    const strokeText = vi.fn();
    const fillRect = vi.fn();
    const rect = vi.fn();
    const context = {
      save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect, clip: vi.fn(), fillRect,
      measureText: (text: string) => ({ width: text.length * 6 }), fillText, strokeText,
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;

    drawTextSource(context, source);

    expect(rect).toHaveBeenCalledWith(10, 10, 24, 50);
    expect(fillRect).toHaveBeenCalledWith(10, 10, 24, 50);
    expect(fillText.mock.calls.map(([text]) => text)).toEqual(['AB', 'CD', 'E']);
    expect(fillText.mock.calls.map(([, x]) => x)).toEqual([22, 22, 22]);
    expect(strokeText).toHaveBeenCalledTimes(3);
    expect(context.restore).toHaveBeenCalledTimes(2);
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PanelResize } from '@lumacast/ui';

afterEach(cleanup);

// jsdom ships no `PointerEvent` and no pointer-capture API in some versions, while
// PanelResize reads `clientX`/`pointerId` and calls `setPointerCapture`. Install
// test-local stand-ins only for what is missing, and remove them again afterwards
// so nothing leaks into other suites.
const originalPointerEvent = Object.getOwnPropertyDescriptor(window, 'PointerEvent');
const originalSetPointerCapture = Element.prototype.setPointerCapture;
const originalReleasePointerCapture = Element.prototype.releasePointerCapture;

beforeAll(() => {
  if (typeof window.PointerEvent !== 'function') {
    class PointerEventShim extends MouseEvent {
      readonly pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      writable: true,
      value: PointerEventShim,
    });
  }
  if (typeof originalSetPointerCapture !== 'function') {
    Element.prototype.setPointerCapture = function setPointerCapture() {};
  }
  if (typeof originalReleasePointerCapture !== 'function') {
    Element.prototype.releasePointerCapture = function releasePointerCapture() {};
  }
});

afterAll(() => {
  if (originalPointerEvent) {
    Object.defineProperty(window, 'PointerEvent', originalPointerEvent);
  } else {
    delete (window as { PointerEvent?: unknown }).PointerEvent;
  }
  if (originalSetPointerCapture) {
    Element.prototype.setPointerCapture = originalSetPointerCapture;
  } else {
    delete (Element.prototype as { setPointerCapture?: unknown }).setPointerCapture;
  }
  if (originalReleasePointerCapture) {
    Element.prototype.releasePointerCapture = originalReleasePointerCapture;
  } else {
    delete (Element.prototype as { releasePointerCapture?: unknown }).releasePointerCapture;
  }
});

// `fireEvent.pointerX(element, init)` (see `createEvent` in
// `@testing-library/dom`) treats `init` as a plain object of event properties
// and builds the real `PointerEvent` from it itself — it does not accept an
// already-constructed event. A constructed `PointerEvent` instance exposes
// `clientX`/`pointerId` as inherited getters rather than own enumerable
// properties, so handing one to `fireEvent` as `init` silently drops them once
// it spreads `{ ...init }`. Return a plain init object instead so `clientX`
// and `pointerId` actually reach the dispatched event.
function pointer(_type: string, init: { clientX: number; pointerId?: number } = { clientX: 0 }) {
  return { clientX: init.clientX, pointerId: init.pointerId ?? 1 };
}

describe('PanelResize', () => {
  it('is a focusable vertical separator reporting the fixed 180..480 range', () => {
    render(<PanelResize width={300} onChange={vi.fn()} side="left" />);
    const handle = screen.getByRole('separator', { name: 'Resize left panel' });
    expect(handle).toHaveAttribute('tabindex', '0');
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('aria-valuemin', '180');
    expect(handle).toHaveAttribute('aria-valuemax', '480');
    expect(handle).toHaveAttribute('aria-valuenow', '300');
    expect(handle).toHaveClass('panel-resizer');
  });

  it('names the side it resizes', () => {
    render(<PanelResize width={300} onChange={vi.fn()} side="right" />);
    expect(screen.getByRole('separator', { name: 'Resize right panel' })).not.toBeNull();
  });

  it('resizes a left panel in the drag direction', () => {
    const onChange = vi.fn();
    render(<PanelResize width={300} onChange={onChange} side="left" />);
    const handle = screen.getByRole('separator');
    fireEvent.pointerDown(handle, pointer('pointerdown', { clientX: 100 }));
    fireEvent.pointerMove(handle, pointer('pointermove', { clientX: 140 }));
    expect(onChange).toHaveBeenLastCalledWith(340);
  });

  it('resizes a right panel against the drag direction', () => {
    const onChange = vi.fn();
    render(<PanelResize width={300} onChange={onChange} side="right" />);
    const handle = screen.getByRole('separator');
    fireEvent.pointerDown(handle, pointer('pointerdown', { clientX: 100 }));
    fireEvent.pointerMove(handle, pointer('pointermove', { clientX: 140 }));
    expect(onChange).toHaveBeenLastCalledWith(260);
  });

  it('clamps pointer drags to the 180..480 range', () => {
    const onChange = vi.fn();
    const { unmount } = render(<PanelResize width={300} onChange={onChange} side="left" />);
    const handle = screen.getByRole('separator');
    fireEvent.pointerDown(handle, pointer('pointerdown', { clientX: 0 }));
    fireEvent.pointerMove(handle, pointer('pointermove', { clientX: 5000 }));
    expect(onChange).toHaveBeenLastCalledWith(480);
    unmount();

    onChange.mockClear();
    render(<PanelResize width={300} onChange={onChange} side="left" />);
    const other = screen.getByRole('separator');
    fireEvent.pointerDown(other, pointer('pointerdown', { clientX: 0 }));
    fireEvent.pointerMove(other, pointer('pointermove', { clientX: -5000 }));
    expect(onChange).toHaveBeenLastCalledWith(180);
  });

  it('stops tracking the drag after pointerup', () => {
    const onChange = vi.fn();
    render(<PanelResize width={300} onChange={onChange} side="left" />);
    const handle = screen.getByRole('separator');
    fireEvent.pointerDown(handle, pointer('pointerdown', { clientX: 100 }));
    fireEvent.pointerUp(handle, pointer('pointerup', { clientX: 140 }));
    fireEvent.pointerMove(handle, pointer('pointermove', { clientX: 200 }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stops tracking the drag after pointercancel', () => {
    const onChange = vi.fn();
    render(<PanelResize width={300} onChange={onChange} side="left" />);
    const handle = screen.getByRole('separator');
    fireEvent.pointerDown(handle, pointer('pointerdown', { clientX: 100 }));
    fireEvent.pointerCancel(handle, pointer('pointercancel', { clientX: 140 }));
    fireEvent.pointerMove(handle, pointer('pointermove', { clientX: 200 }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not move until a drag starts', () => {
    const onChange = vi.fn();
    render(<PanelResize width={300} onChange={onChange} side="left" />);
    fireEvent.pointerMove(screen.getByRole('separator'), pointer('pointermove', { clientX: 400 }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('steps by 10 on arrow keys, flipped for a right panel, and prevents scrolling', () => {
    const onChange = vi.fn();
    const left = render(<PanelResize width={300} onChange={onChange} side="left" />);
    const handle = screen.getByRole('separator');
    const rightKey = fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(310);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(290);
    expect(rightKey).toBe(false);
    left.unmount();

    onChange.mockClear();
    render(<PanelResize width={300} onChange={onChange} side="right" />);
    const right = screen.getByRole('separator');
    fireEvent.keyDown(right, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(290);
    fireEvent.keyDown(right, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(310);
  });

  it('clamps keyboard steps to the 180..480 range', () => {
    const onChange = vi.fn();
    const { unmount } = render(<PanelResize width={190} onChange={onChange} side="left" />);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(180);
    unmount();

    onChange.mockClear();
    render(<PanelResize width={470} onChange={onChange} side="left" />);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(480);
  });

  it('ignores keys other than the horizontal arrows', () => {
    const onChange = vi.fn();
    render(<PanelResize width={300} onChange={onChange} side="left" />);
    const handle = screen.getByRole('separator');
    for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', 'a']) {
      fireEvent.keyDown(handle, { key });
    }
    expect(onChange).not.toHaveBeenCalled();
  });
});

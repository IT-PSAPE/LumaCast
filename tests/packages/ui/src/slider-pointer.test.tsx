import { useState, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DirectionProvider } from '@base-ui/react/direction-provider';
import { Slider as BaseSlider } from '@base-ui/react/slider';
import { Slider } from '@lumacast/ui';

type PointerOptions = ComponentProps<typeof Slider>;

const rect = { x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, toJSON: () => ({}) };
const methods = ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture'] as const;
let restore = () => {};

beforeEach(() => {
  const before = new Map(methods.map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]));
  const captures = new WeakMap<HTMLElement, Set<number>>();
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value(this: HTMLElement, id: number) {
    const ids = captures.get(this) ?? new Set<number>(); ids.add(id); captures.set(this, ids);
  } });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value(this: HTMLElement, id: number) {
    return captures.get(this)?.has(id) ?? false;
  } });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value(this: HTMLElement, id: number) {
    captures.get(this)?.delete(id);
  } });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
  restore = () => { for (const name of methods) {
    const descriptor = before.get(name);
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  } };
});
afterEach(() => { cleanup(); restore(); vi.restoreAllMocks(); });

function Harness({ initial = 50, onChange, ...props }: Partial<PointerOptions> & {
  initial?: number; onChange?: (value: number) => void;
}) {
  const [value, setValue] = useState(initial);
  return <Slider label="Prototype value" value={value} onValueChange={(next) => {
    setValue(next); onChange?.(next);
  }} {...props} />;
}
const input = () => screen.getByRole('slider', { name: 'Prototype value' });
const control = () => input().parentElement!.parentElement!.parentElement!;
const track = () => input().parentElement!.parentElement!;
const pointer = (id = 1, x = 70, y = 50, extra = {}) => ({
  button: 0, buttons: 1, pointerId: id, pointerType: 'mouse', isPrimary: true,
  clientX: x, clientY: y, ...extra,
});
function press(id = 1, x = 70, y = 50, extra = {}) { fireEvent.pointerDown(track(), pointer(id, x, y, extra)); }
function move(id = 1, x = 80, y = 50, extra = {}) { fireEvent.pointerMove(control(), pointer(id, x, y, extra)); }
function release(id = 1, x = 80, y = 50, extra = {}) { fireEvent.pointerUp(control(), pointer(id, x, y, { buttons: 0, ...extra })); }

describe('Slider pointer ownership', () => {
  it('owns a primary drag and commits once while focusing the original native range input', () => {
    const onCommit = vi.fn(); const onChange = vi.fn();
    render(<Harness onChange={onChange} onCommit={onCommit} />);
    const original = input();
    press();
    expect(original).toHaveFocus();
    expect(original.parentElement).toHaveAttribute('data-dragging');
    expect(onChange).toHaveBeenLastCalledWith(70);
    move(); release();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(80);
    expect(original.parentElement).not.toHaveAttribute('data-dragging');
    expect(input()).toBe(original);
  });

  it('rejects a competing pointer without its document end killing the original drag', () => {
    const onCommit = vi.fn(); const unrelated = vi.fn();
    document.addEventListener('pointerup', unrelated);
    try {
      render(<Harness onCommit={onCommit} />);
      press(1, 70);
      press(2, 90);
      fireEvent.pointerUp(document, pointer(2, 90, 50, { buttons: 0 }));
      move(2, 95, 50, { buttons: 0 });
      move(1, 80); release(1, 80);
      expect(onCommit).toHaveBeenCalledExactlyOnceWith(80);
      expect(input()).toHaveAttribute('aria-valuenow', '80');
      expect(unrelated).toHaveBeenCalled();
    } finally { document.removeEventListener('pointerup', unrelated); }
  });

  it.each([false, true])('cancels a drag through busy (resume before old release: %s)', (resumeFirst) => {
    const onCommit = vi.fn(); const onCancel = vi.fn(); const onChange = vi.fn();
    const view = render(<Harness onChange={onChange} onCommit={onCommit} onCancel={onCancel} />);
    const original = input();
    press(1, 70);
    view.rerender(<Harness onChange={onChange} onCommit={onCommit} onCancel={onCancel} readOnly />);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(original).toHaveFocus();
    expect(original).not.toBeDisabled();
    fireEvent.keyDown(original, { key: 'ArrowRight' });
    fireEvent.change(original, { target: { value: '90' } });
    expect(onCommit).not.toHaveBeenCalled();
    if (resumeFirst) view.rerender(<Harness onChange={onChange} onCommit={onCommit} onCancel={onCancel} />);
    move(1, 80); release(1, 80);
    expect(onCommit).not.toHaveBeenCalled();
    if (!resumeFirst) view.rerender(<Harness onChange={onChange} onCommit={onCommit} onCancel={onCancel} />);
    fireEvent.keyDown(original, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(71);
    expect(input()).toBe(original);
    expect(original).toHaveFocus();
  });

  it.each(['pointerup', 'lost-pointerup', 'pointercancel'])('rejects old %s after a new keyboard edit', (end) => {
    const onCommit = vi.fn(); const onCancel = vi.fn();
    const view = render(<Harness onCommit={onCommit} onCancel={onCancel} />);
    press(1, 70);
    view.rerender(<Harness onCommit={onCommit} onCancel={onCancel} readOnly />);
    view.rerender(<Harness onCommit={onCommit} onCancel={onCancel} />);
    fireEvent.keyDown(input(), { key: 'ArrowRight' });
    if (end === 'pointerup') release(1, 80);
    else if (end === 'lost-pointerup') move(1, 80, 50, { buttons: 0 });
    else fireEvent.pointerCancel(control(), pointer(1, 80));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(71);
    expect(input()).toHaveAttribute('aria-valuenow', '71');
  });

  it('accepts native input after busy and rejects the old pointer termination', () => {
    const onCommit = vi.fn();
    const view = render(<Harness onCommit={onCommit} />);
    press(1, 70);
    view.rerender(<Harness onCommit={onCommit} readOnly />);
    view.rerender(<Harness onCommit={onCommit} />);
    fireEvent.change(input(), { target: { value: '75' } });
    move(1, 90, 50, { buttons: 0 }); release(1, 90);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(75);
    expect(input()).toHaveAttribute('aria-valuenow', '75');
  });

  it('resets a same-ID new press at the unchanged value without replaying cached pointer data', () => {
    const onCommit = vi.fn();
    const view = render(<Harness onCommit={onCommit} />);
    press(1, 70);
    view.rerender(<Harness onCommit={onCommit} readOnly />);
    view.rerender(<Harness onCommit={onCommit} />);
    fireEvent.keyDown(input(), { key: 'ArrowRight' });
    press(1, 71); release(1, 71);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(71);
    press(1, 71); move(1, 80); release(1, 80);
    expect(onCommit).toHaveBeenLastCalledWith(80);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('handles touch Pointer Events without a legacy TouchEvent listener owning another gesture', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    press(1, 70, 50, { pointerType: 'touch' });
    fireEvent.touchStart(track(), { changedTouches: [{ identifier: 1, clientX: 70, clientY: 50 }] });
    press(2, 90, 50, { pointerType: 'touch', isPrimary: false });
    fireEvent.touchEnd(document, { changedTouches: [{ identifier: 2, clientX: 90, clientY: 50 }] });
    fireEvent.pointerUp(document, pointer(2, 90, 50, { pointerType: 'touch', buttons: 0 }));
    move(1, 80, 50, { pointerType: 'touch' }); release(1, 80, 50, { pointerType: 'touch' });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(80);
  });

  it('cancels context replacement without remounting or restoring focus and accepts the new interaction', () => {
    const onChange = vi.fn(); const onCommit = vi.fn(); const onCancel = vi.fn();
    const view = render(<Slider label="Prototype value" value={50} interactionKey="first:4" onValueChange={onChange} onCommit={onCommit} onCancel={onCancel} />);
    const original = input();
    press(1, 70);
    view.rerender(<Slider label="Prototype value" value={20} interactionKey="second:5" onValueChange={onChange} onCommit={onCommit} onCancel={onCancel} />);
    expect(onCancel).toHaveBeenCalledTimes(1);
    release(1, 80);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input()).toBe(original);
    expect(original).toHaveFocus();
    fireEvent.keyDown(original, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(21);
  });

  it('keeps the grabbed thumb offset instead of jumping to the pointer center', () => {
    const onChange = vi.fn(); const onCommit = vi.fn();
    render(<Harness onChange={onChange} onCommit={onCommit} />);
    const thumb = input().parentElement!;
    Object.defineProperty(thumb, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ ...rect, left: 45, right: 55, width: 10 }),
    });
    fireEvent.pointerDown(thumb, pointer(1, 53));
    expect(onChange).not.toHaveBeenCalled();
    move(1, 63); release(1, 63);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(60);
  });

  it('snaps relative to the minimum, retains fractional precision and clamps the endpoints', () => {
    const onCommit = vi.fn();
    render(<Harness initial={0} min={-0.3} max={1.2} step={0.2} onCommit={onCommit} />);
    press(1, 40); release(1, 40);
    expect(onCommit).toHaveBeenLastCalledWith(0.3);
    press(1, 120); release(1, 120);
    expect(onCommit).toHaveBeenLastCalledWith(1.2);
    press(1, -20); release(1, -20);
    expect(onCommit).toHaveBeenLastCalledWith(-0.3);
  });

  it('matches installed Base UI for a non-divisible range instead of inventing an unreachable endpoint', () => {
    const originalCommit = vi.fn(); const adapterCommit = vi.fn();
    function Original() {
      const [value, setValue] = useState(0);
      return <BaseSlider.Root value={value} min={0} max={10} step={3}
        onValueChange={setValue} onValueCommitted={originalCommit}>
        <BaseSlider.Control data-original-control="">
          <BaseSlider.Track><BaseSlider.Thumb aria-label="Original value" /></BaseSlider.Track>
        </BaseSlider.Control>
      </BaseSlider.Root>;
    }
    render(<><Original /><Harness initial={0} min={0} max={10} step={3} onCommit={adapterCommit} /></>);
    act(() => screen.getByRole('slider', { name: 'Original value' }).focus());
    fireEvent.pointerDown(document.querySelector('[data-original-control]')!, pointer(1, 100));
    fireEvent.pointerUp(document, pointer(1, 100, 50, { buttons: 0 }));
    press(2, 100); release(2, 100);
    expect(originalCommit.mock.calls[0][0]).toBe(9);
    expect(adapterCommit).toHaveBeenCalledExactlyOnceWith(9);
    expect(input()).toHaveAttribute('aria-valuenow', '9');
  });

  it('cancels when the track geometry changes before release', () => {
    const onCommit = vi.fn(); const onCancel = vi.fn();
    render(<Harness onCommit={onCommit} onCancel={onCancel} />);
    press(1, 70);
    Object.defineProperty(track(), 'getBoundingClientRect', {
      configurable: true, value: () => ({ ...rect, width: 200, right: 200 }),
    });
    move(1, 80); release(1, 80);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('uses public RTL direction for pointer and Base UI keyboard parity', () => {
    const onCommit = vi.fn();
    render(<DirectionProvider direction="rtl"><Harness onCommit={onCommit} /></DirectionProvider>);
    press(1, 20); release(1, 20);
    expect(onCommit).toHaveBeenLastCalledWith(80);
    fireEvent.keyDown(input(), { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenLastCalledWith(79);
  });

  it('uses bottom-to-top geometry for vertical sliders and preserves keyboard steps', () => {
    const onCommit = vi.fn();
    render(<Harness orientation="vertical" onCommit={onCommit} />);
    press(1, 50, 20); release(1, 50, 20);
    expect(onCommit).toHaveBeenLastCalledWith(80);
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(onCommit).toHaveBeenLastCalledWith(81);
  });

  it.each([
    ['Chord zoom', 10, 800],
    ['Stream volume', 0, 200],
  ] as const)('preserves the %s controlled range, fill and keyboard behavior after dragging', (_surface, min, max) => {
    render(<Harness initial={min} min={min} max={max} />);
    press(1, 70); move(1, 80); release(1, 80);
    const value = Math.round(min + (max - min) * 0.8);
    expect(input()).toHaveAttribute('aria-valuenow', String(value));
    expect(input().parentElement!.style.insetInlineStart).toBe('80%');
    const fill = track().firstElementChild as HTMLElement;
    expect(fill.style.width).toBe('80%');
    fireEvent.keyDown(input(), { key: 'End' });
    expect(input()).toHaveAttribute('aria-valuenow', String(max));
    expect(fill.style.width).toBe('100%');
    fireEvent.keyDown(input(), { key: 'Home' });
    expect(input()).toHaveAttribute('aria-valuenow', String(min));
    expect(fill.style.width).toBe('0%');
    fireEvent.keyDown(input(), { key: 'ArrowRight' });
    expect(input()).toHaveAttribute('aria-valuenow', String(min + 1));
    expect(input()).toHaveFocus();
  });

  it('preserves the Stream bipolar balance fill origin across pointer edits', () => {
    render(<Harness initial={0} min={-100} max={100} fillFrom={0} />);
    const fill = track().firstElementChild as HTMLElement;
    expect(fill.style.left).toBe('50%');
    expect(fill.style.width).toBe('0%');
    press(1, 25); release(1, 25);
    expect(input()).toHaveAttribute('aria-valuenow', '-50');
    expect(fill.style.left).toBe('25%');
    expect(fill.style.width).toBe('25%');
    press(1, 80); release(1, 80);
    expect(input()).toHaveAttribute('aria-valuenow', '60');
    expect(fill.style.left).toBe('50%');
    expect(fill.style.width).toBe('30%');
  });
});

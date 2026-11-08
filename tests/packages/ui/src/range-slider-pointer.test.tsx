import { useState, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RangeSlider } from '@lumacast/ui';
import { DirectionProvider } from '@base-ui/react/direction-provider';

type Props = ComponentProps<typeof RangeSlider>;
const initial: [number, number] = [20, 60];
const rect = { x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 4, width: 200, height: 4, toJSON: () => ({}) };
const methods = ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture'] as const;
let restore = () => {};
beforeEach(() => {
  const before = new Map(methods.map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]));
  const captures = new WeakMap<HTMLElement, Set<number>>();
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value(this: HTMLElement, id: number) {
    const ids = captures.get(this) ?? new Set<number>(); ids.add(id); captures.set(this, ids);
  } });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value(this: HTMLElement, id: number) { return captures.get(this)?.has(id) ?? false; } });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value(this: HTMLElement, id: number) {
    captures.get(this)?.delete(id);
    this.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: id }));
  } });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
  restore = () => { for (const name of methods) {
    const descriptor = before.get(name);
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  } };
});
afterEach(() => { cleanup(); restore(); vi.restoreAllMocks(); });

function Harness({ onChange, onCancel, ...props }: Partial<Props> & { onChange?: Props['onValueChange'] }) {
  const [value, setValue] = useState<[number, number]>(initial);
  return <RangeSlider value={value} onValueChange={(next) => { setValue(next); onChange?.(next); }} onCancel={() => { setValue(initial); onCancel?.(); }} startLabel="Start" endLabel="End" {...props} />;
}
const input = (name = 'Start') => screen.getByRole('slider', { name });
const track = () => input().parentElement!.parentElement!;
const control = () => track().parentElement!;
const layer = (kind: 'range' | 'seek' = 'range') => track().querySelector<HTMLDivElement>(kind === 'range' ? '[data-range-drag]' : '[data-seek]')!;
const pointer = (id = 1, x = 80, extra = {}) => ({ button: 0, buttons: 1, pointerId: id, pointerType: 'mouse', isPrimary: true, clientX: x, ...extra });
function press(id = 1, x = 80, kind: 'range' | 'seek' = 'range', extra = {}) { fireEvent.pointerDown(layer(kind), pointer(id, x, extra)); }
function move(id = 1, x = 100, kind: 'range' | 'seek' = 'range', extra = {}) { fireEvent.pointerMove(layer(kind), pointer(id, x, extra)); }
function release(id = 1, kind: 'range' | 'seek' = 'range') { fireEvent.pointerUp(layer(kind), pointer(id, 100, { buttons: 0 })); }
function placeThumbs(start = 40, end = 120) {
  for (const [name, center] of [['Start', start], ['End', end]] as const) {
    input(name).parentElement!.getBoundingClientRect = () => ({ ...rect, left: center - 6, right: center + 6, width: 12, height: 12 });
  }
}

describe('RangeSlider pointer ownership', () => {
  it.each(['mouse', 'pen', 'touch'])('owns the %s thumb path with its exact native input and no legacy touch writer', (pointerType) => {
    const onCommit = vi.fn(); const onChange = vi.fn();
    render(<Harness onCommit={onCommit} onChange={onChange} />);
    placeThumbs();
    const original = input(); const thumb = original.parentElement!;
    fireEvent.pointerDown(thumb, pointer(1, 43, { pointerType }));
    expect(original).toHaveFocus();
    expect(thumb).toHaveAttribute('data-dragging');
    if (pointerType === 'touch') fireEvent.touchStart(thumb, { changedTouches: [{ identifier: 1, clientX: 43, clientY: 0 }] });
    fireEvent.pointerMove(control(), pointer(1, 63, { pointerType }));
    fireEvent.pointerUp(control(), pointer(1, 63, { pointerType, buttons: 0 }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith([30, 60]);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith([30, 60]);
    expect(thumb).not.toHaveAttribute('data-dragging');
    expect(input()).toBe(original);
  });

  it('targets Out directly with its grab offset while preserving In', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    placeThumbs();
    fireEvent.pointerDown(input('End').parentElement!, pointer(1, 123));
    fireEvent.pointerMove(control(), pointer(1, 143));
    fireEvent.pointerUp(control(), pointer(1, 143, { buttons: 0 }));
    expect(input('End')).toHaveFocus();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith([20, 70]);
  });

  it('selects the nearest rendered center on a bare track, with equal distances choosing Out', () => {
    const onCommit = vi.fn();
    const view = render(<Harness onCommit={onCommit} draggableRange={false} />);
    placeThumbs(20, 180);
    fireEvent.pointerDown(track(), pointer(1, 90));
    fireEvent.pointerUp(control(), pointer(1, 90, { buttons: 0 }));
    expect(input()).toHaveFocus();
    expect(onCommit).toHaveBeenLastCalledWith([45, 60]);
    view.unmount();
    render(<Harness onCommit={onCommit} draggableRange={false} />);
    placeThumbs();
    fireEvent.pointerDown(track(), pointer(1, 80));
    fireEvent.pointerUp(control(), pointer(1, 80, { buttons: 0 }));
    expect(input('End')).toHaveFocus();
    expect(onCommit).toHaveBeenLastCalledWith([20, 40]);
  });

  it('lets the first coincident max thumb move away from max even when Out is targeted', () => {
    const onCommit = vi.fn();
    render(<Harness value={[100, 100]} minRange={0} onCommit={onCommit} />);
    placeThumbs(200, 200);
    fireEvent.pointerDown(input('End').parentElement!, pointer(1, 200));
    fireEvent.pointerMove(control(), pointer(1, 160));
    fireEvent.pointerUp(control(), pointer(1, 160, { buttons: 0 }));
    expect(input()).toHaveFocus();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith([80, 100]);
  });

  it.each(['pointer', 'keyboard'])('preserves off-grid duration endpoints and enforces a feasible nonmultiple gap with %s', (method) => {
    const onCommit = vi.fn();
    const view = render(<Harness value={[0, 10]} min={0} max={10} step={3} minRange={1.5} onCommit={onCommit} />);
    placeThumbs(0, 200);
    if (method === 'keyboard') fireEvent.keyDown(input(), { key: 'End' });
    else {
      fireEvent.pointerDown(input().parentElement!, pointer(1, 0));
      fireEvent.pointerMove(control(), pointer(1, 200));
      fireEvent.pointerUp(control(), pointer(1, 200, { buttons: 0 }));
    }
    expect(onCommit).toHaveBeenLastCalledWith([6, 10]);
    view.unmount();
    render(<Harness value={[0, 6]} min={0} max={10} step={3} minRange={1.5} onCommit={onCommit} />);
    placeThumbs(0, 120);
    if (method === 'keyboard') fireEvent.keyDown(input('End'), { key: 'End' });
    else {
      fireEvent.pointerDown(input('End').parentElement!, pointer(1, 120));
      fireEvent.pointerMove(control(), pointer(1, 200));
      fireEvent.pointerUp(control(), pointer(1, 200, { buttons: 0 }));
    }
    expect(onCommit).toHaveBeenLastCalledWith([0, 9]);
  });

  it('keeps fractional gap boundaries exact and rejects a range with no feasible grid point', () => {
    const onCommit = vi.fn();
    const view = render(<Harness value={[1, 5]} min={0} max={18} step={0.01} minRange={0.1} onCommit={onCommit} />);
    placeThumbs(200 / 18, 1000 / 18);
    fireEvent.pointerDown(input().parentElement!, pointer(1, 200 / 18));
    fireEvent.pointerMove(control(), pointer(1, 200));
    fireEvent.pointerUp(control(), pointer(1, 200, { buttons: 0 }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith([4.9, 5]);
    view.rerender(<Harness value={[0.9, 1]} min={0} max={1} step={0.3} minRange={0.2} onCommit={onCommit} />);
    fireEvent.keyDown(input('End'), { key: 'End' });
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it('maps RTL thumb, seek and range positions consistently with fill and playhead', () => {
    const onCommit = vi.fn(); const onSeek = vi.fn();
    render(<DirectionProvider direction="rtl"><Harness onCommit={onCommit} onSeek={onSeek} playhead={30} /></DirectionProvider>);
    placeThumbs(160, 80);
    expect(layer()).toHaveStyle({ left: '40%', width: '40%' });
    expect(track().querySelector('[data-playhead]')).toHaveStyle({ left: '70%' });
    press(1, 20, 'seek'); release(1, 'seek');
    expect(onSeek).toHaveBeenLastCalledWith(90);
    press(); move(); release();
    expect(onCommit).toHaveBeenLastCalledWith([10, 50]);
    fireEvent.pointerDown(input().parentElement!, pointer(1, 160));
    fireEvent.pointerMove(control(), pointer(1, 140));
    fireEvent.pointerUp(control(), pointer(1, 140, { buttons: 0 }));
    expect(onCommit).toHaveBeenLastCalledWith([30, 50]);
    fireEvent.keyDown(input(), { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenLastCalledWith([29, 50]);
  });

  it('cancels direction changes without remounting inputs or committing the old scale', () => {
    const onCancel = vi.fn(); const onCommit = vi.fn();
    const view = render(<DirectionProvider direction="ltr"><Harness onCancel={onCancel} onCommit={onCommit} /></DirectionProvider>);
    const original = input();
    press(); move();
    view.rerender(<DirectionProvider direction="rtl"><Harness onCancel={onCancel} onCommit={onCommit} /></DirectionProvider>);
    release();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
    expect(input()).toBe(original);
  });

  it('does not mask keyboard focus for a rejected zero-width native press', () => {
    render(<><button>Outside</button><Harness /></>);
    placeThumbs();
    const outside = screen.getByRole('button', { name: 'Outside' });
    act(() => outside.focus());
    track().getBoundingClientRect = () => ({ ...rect, width: 0 });
    fireEvent.pointerDown(input().parentElement!, pointer(1, 40));
    expect(outside).toHaveFocus();
    expect(input().parentElement!.className).toContain('has-[input:focus-visible]:outline-2');
  });
  it.each(['mouse', 'pen', 'touch'])('seeks with %s without moving or committing either native handle', (pointerType) => {
    const onSeek = vi.fn(); const onChange = vi.fn(); const onCommit = vi.fn();
    render(<Harness onSeek={onSeek} onChange={onChange} onCommit={onCommit} />);
    press(1, 10, 'seek', { pointerType });
    if (pointerType === 'touch') {
      fireEvent.touchStart(layer('seek'), { changedTouches: [{ identifier: 1, clientX: 10, clientY: 0 }] });
      fireEvent.touchMove(document, { changedTouches: [{ identifier: 1, clientX: 30, clientY: 0 }] });
      fireEvent.touchEnd(document, { changedTouches: [{ identifier: 1, clientX: 30, clientY: 0 }] });
    }
    move(1, 30, 'seek', { pointerType });
    release(1, 'seek');
    expect(onSeek.mock.calls.map(([value]) => value)).toEqual([5, 15]);
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(input()).toHaveValue('20');
  });

  it.each(['mouse', 'pen', 'touch'])('owns one immutable %s range origin through feedback and releases capture before committing once', (pointerType) => {
    const onChange = vi.fn();
    const onCommit = vi.fn(() => expect(control().hasPointerCapture(1)).toBe(false));
    const onCancel = vi.fn();
    render(<Harness onChange={onChange} onCommit={onCommit} onCancel={onCancel} />);
    const original = input();
    press(1, 80, 'range', { pointerType });
    if (pointerType === 'touch') fireEvent.touchStart(layer(), { changedTouches: [{ identifier: 1, clientX: 80, clientY: 0 }] });
    move(1, 100, 'range', { pointerType }); move(1, 120, 'range', { pointerType }); release(); release();
    expect(onChange.mock.calls.map(([value]) => value)).toEqual([[30, 70], [40, 80]]);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith([40, 80]);
    expect(onCancel).not.toHaveBeenCalled();
    expect(input()).toBe(original);
  });

  it('seeks once for a filled click and never seeks on a canceled click', () => {
    const onSeek = vi.fn(); const onCommit = vi.fn();
    render(<Harness onSeek={onSeek} onCommit={onCommit} />);
    press(); move(1, 82); release();
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(40);
    expect(onCommit).not.toHaveBeenCalled();
    press(); fireEvent.pointerCancel(layer(), pointer()); release();
    expect(onSeek).toHaveBeenCalledOnce();
  });

  it.each(['pointerCancel', 'lostPointerCapture'] as const)('cancels %s without persisting the preview or seeking', (termination) => {
    const onCommit = vi.fn(); const onCancel = vi.fn(); const onSeek = vi.fn();
    render(<Harness onCommit={onCommit} onCancel={onCancel} onSeek={onSeek} />);
    press(); move();
    fireEvent[termination](layer(), pointer());
    move(1, 120); release();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onSeek).not.toHaveBeenCalled();
    expect(input()).toHaveValue('20');
    expect(control().hasPointerCapture(1)).toBe(false);
  });

  it('ignores competing starts and foreign moves or ends, including a document end outside its target', () => {
    const onChange = vi.fn(); const onCommit = vi.fn(); const onCancel = vi.fn();
    render(<Harness onChange={onChange} onCommit={onCommit} onCancel={onCancel} />);
    press(); move();
    press(2, 100); move(2, 140); release(2);
    fireEvent.pointerCancel(layer(), pointer(2));
    fireEvent.lostPointerCapture(layer(), pointer(2));
    fireEvent.pointerUp(document, pointer(2, 140, { buttons: 0 }));
    move(1, 120); release();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith([40, 80]);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it.each([
    { disabled: true }, { min: 1 }, { max: 120 }, { step: 2 }, { minRange: 2 }, { draggableRange: false }, { onSeek: () => {} },
  ])('invalidates the old range gesture when constraints or mode change: %o', (changed) => {
    const onCommit = vi.fn(); const onCancel = vi.fn();
    const view = render(<Harness onCommit={onCommit} onCancel={onCancel} />);
    const oldLayer = layer(); const original = input();
    press(); move();
    view.rerender(<Harness onCommit={onCommit} onCancel={onCancel} {...changed} />);
    fireEvent.pointerUp(oldLayer, pointer(1, 120, { buttons: 0 }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
    expect(input()).toBe(original);
  });

  it.each([{ width: 300 }, { left: 20 }, { top: 20 }, { height: 8 }])('invalidates changed track geometry before release: %o', (changed) => {
    const onCommit = vi.fn(); const onCancel = vi.fn();
    render(<Harness onCommit={onCommit} onCancel={onCancel} />);
    press(); move();
    track().getBoundingClientRect = () => ({ ...rect, ...changed });
    release();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('uses the latest callbacks without rebasing the original press on feedback values', () => {
    const oldChange = vi.fn(); const oldCommit = vi.fn(); const nextChange = vi.fn(); const nextCommit = vi.fn();
    const view = render(<RangeSlider value={initial} onValueChange={oldChange} onCommit={oldCommit} startLabel="Start" endLabel="End" />);
    press(); move();
    view.rerender(<RangeSlider value={[30, 70]} onValueChange={nextChange} onCommit={nextCommit} startLabel="Start" endLabel="End" />);
    move(1, 120); release();
    expect(oldChange).toHaveBeenCalledExactlyOnceWith([30, 70]);
    expect(oldCommit).not.toHaveBeenCalled();
    expect(nextChange).toHaveBeenCalledExactlyOnceWith([40, 80]);
    expect(nextCommit).toHaveBeenCalledExactlyOnceWith([40, 80]);
  });

  it.each(['keyboard', 'native input'])('accepts %s after retiring the custom preview, so old pointerup cannot overwrite it', (method) => {
    const events: string[] = []; const onCommit = vi.fn();
    render(<Harness onChange={() => events.push('change')} onCancel={() => events.push('cancel')} onCommit={onCommit} />);
    const original = input();
    press(); move(); events.length = 0;
    if (method === 'keyboard') fireEvent.keyDown(original, { key: 'ArrowRight' });
    else fireEvent.change(original, { target: { value: '35' } });
    expect(events).toEqual(['cancel', 'change']);
    release();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(method === 'keyboard' ? [31, 70] : [35, 70]);
    expect(input()).toBe(original);
  });

  it('recovers a lost release from a matching no-buttons move without applying its new coordinate', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    press(); move(); move(1, 180, 'range', { buttons: 0 }); release();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith([30, 70]);
  });

  it('retires an unfinished same-ID press before accepting a fresh origin', () => {
    const onCancel = vi.fn(); const onCommit = vi.fn();
    render(<Harness onCancel={onCancel} onCommit={onCommit} />);
    press(); move(); press(1, 100); move(1, 120); release();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith([40, 80]);
  });

  it('rejects nonprimary presses and invalid geometry without capture or callbacks', () => {
    const onChange = vi.fn(); const onCancel = vi.fn();
    render(<Harness onChange={onChange} onCancel={onCancel} />);
    press(1, 80, 'range', { button: 2 });
    press(1, 80, 'range', { isPrimary: false });
    track().getBoundingClientRect = () => ({ ...rect, width: 0 });
    press(); move(); release();
    expect(control().hasPointerCapture(1)).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('releases an unmounted owner once and leaves late document events inert', () => {
    const onChange = vi.fn(); const onCommit = vi.fn(); const onCancel = vi.fn();
    const view = render(<Harness onChange={onChange} onCommit={onCommit} onCancel={onCancel} />);
    const target = control();
    press(); move(); view.unmount();
    fireEvent.pointerMove(document, pointer(1, 120));
    fireEvent.pointerUp(document, pointer(1, 120, { buttons: 0 }));
    expect(target.hasPointerCapture(1)).toBe(false);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('rejects a competing native thumb pointer while its custom owner remains live', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    press(); move();
    fireEvent.pointerDown(input().parentElement!, pointer(2, 150));
    fireEvent.pointerUp(document, pointer(2, 150, { buttons: 0 }));
    move(1, 120); release();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith([40, 80]);
  });

  it('keeps a native thumb owner live when a competing custom pointer ends outside the control', () => {
    const onChange = vi.fn(); const onCommit = vi.fn(); const onSeek = vi.fn();
    render(<Harness onChange={onChange} onCommit={onCommit} onSeek={onSeek} />);
    const thumb = input().parentElement!;
    thumb.getBoundingClientRect = () => ({ ...rect, left: 34, right: 46, width: 12 });
    fireEvent.pointerDown(thumb, pointer(1, 40));
    fireEvent.pointerMove(control(), pointer(1, 60));
    expect(onChange).toHaveBeenLastCalledWith([30, 60]);
    press(2, 100);
    fireEvent.pointerUp(document, pointer(2, 100, { buttons: 0 }));
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerMove(control(), pointer(1, 80));
    expect(onChange).toHaveBeenLastCalledWith([40, 60]);
    fireEvent.pointerUp(control(), pointer(1, 80, { buttons: 0 }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith([40, 60]);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it.each(['pointerCancel', 'lostPointerCapture'] as const)('cancels a native thumb on %s without persisting or retaining its dragging marker', (termination) => {
    const onCancel = vi.fn(); const onCommit = vi.fn();
    render(<Harness onCancel={onCancel} onCommit={onCommit} />);
    placeThumbs();
    const thumb = input().parentElement!;
    fireEvent.pointerDown(thumb, pointer(1, 40));
    fireEvent.pointerMove(control(), pointer(1, 60));
    fireEvent[termination](control(), pointer());
    fireEvent.pointerUp(control(), pointer(1, 60, { buttons: 0 }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
    expect(input()).toHaveValue('20');
    expect(thumb).not.toHaveAttribute('data-dragging');
  });

  it('uses the replacement seek callback for an existing press', () => {
    const before = vi.fn(); const after = vi.fn();
    const view = render(<Harness onSeek={before} />);
    press(1, 10, 'seek');
    view.rerender(<Harness onSeek={after} />);
    move(1, 30, 'seek'); release(1, 'seek');
    expect(before).toHaveBeenCalledExactlyOnceWith(5);
    expect(after).toHaveBeenCalledExactlyOnceWith(15);
  });

  it('keeps two controls independent when their different owning pointers end', () => {
    const firstCommit = vi.fn(); const secondCommit = vi.fn();
    const view = render(<><Harness onCommit={firstCommit} /><Harness onCommit={secondCommit} /></>);
    const fills = view.container.querySelectorAll<HTMLDivElement>('[data-range-drag]');
    const controls = [...fills].map((fill) => fill.parentElement!.parentElement!);
    fireEvent.pointerDown(fills[0]!, pointer(1, 80));
    fireEvent.pointerMove(controls[0]!, pointer(1, 100));
    fireEvent.pointerDown(fills[1]!, pointer(2, 80));
    fireEvent.pointerMove(controls[1]!, pointer(2, 120));
    fireEvent.pointerUp(controls[1]!, pointer(2, 120, { buttons: 0 }));
    expect(secondCommit).toHaveBeenCalledExactlyOnceWith([40, 80]);
    expect(firstCommit).not.toHaveBeenCalled();
    fireEvent.pointerMove(controls[0]!, pointer(1, 120));
    fireEvent.pointerUp(controls[0]!, pointer(1, 120, { buttons: 0 }));
    expect(firstCommit).toHaveBeenCalledExactlyOnceWith([40, 80]);
  });
});

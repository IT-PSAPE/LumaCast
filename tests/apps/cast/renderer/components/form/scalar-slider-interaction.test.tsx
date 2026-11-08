import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Slider } from '@lumacast/ui';
import { InspectorSlider } from '../../../../../../apps/cast/renderer/components/form/inspector-slider';
import { HueSlider } from '../../../../../../apps/cast/renderer/components/form/color-picker/hue-slider';
import { AlphaSlider } from '../../../../../../apps/cast/renderer/components/form/color-picker/alpha-slider';

type Kind = 'inspector' | 'hue' | 'alpha' | 'shared';
const names = { inspector: 'Inspector', hue: 'Hue', alpha: 'Alpha', shared: 'Shared' };
const rect = { x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 12, width: 100, height: 12, toJSON: () => ({}) };
const methods = ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture'] as const;
let restore = () => {};
beforeEach(() => {
  const before = new Map(methods.map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]));
  const captured = new WeakMap<HTMLElement, Set<number>>();
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value(this: HTMLElement, id: number) {
    const ids = captured.get(this) ?? new Set<number>(); ids.add(id); captured.set(this, ids);
  } });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value(this: HTMLElement, id: number) { return captured.get(this)?.has(id) ?? false; } });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value(this: HTMLElement, id: number) {
    captured.get(this)?.delete(id);
    this.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: id, bubbles: true }));
  } });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
  restore = () => { for (const name of methods) {
    const descriptor = before.get(name);
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  } };
});
afterEach(() => { cleanup(); restore(); vi.restoreAllMocks(); });

function Harness({ kind, onChange }: { kind: Kind; onChange: (next: number) => void }) {
  const [value, setValue] = useState(kind === 'hue' ? 180 : 50);
  const change = (next: number) => { setValue(next); onChange(next); };
  if (kind === 'inspector') return <InspectorSlider value={value} min={0} max={100} onChange={change} ariaLabel={names[kind]} />;
  if (kind === 'hue') return <HueSlider hue={value} onChange={change} />;
  if (kind === 'alpha') return <AlphaSlider alpha={value} hsb={{ h: 210, s: 60, b: 80 }} onChange={change} />;
  return <Slider value={value} onValueChange={change} label={names[kind]} />;
}
const input = (kind: Kind) => screen.getByRole('slider', { name: names[kind] });
const control = (kind: Kind) => kind === 'inspector' ? input(kind).parentElement!.parentElement! : input(kind).parentElement!.parentElement!.parentElement!;
const pointer = (id = 1, x = 70, extra = {}) => ({ pointerId: id, clientX: x, clientY: 6, button: 0, buttons: 1, isPrimary: true, pointerType: 'mouse', ...extra });

describe.each(['inspector', 'hue', 'alpha', 'shared'] as const)('%s scalar ownership', (kind) => {
  it('keeps its owning pointer live after a foreign outside end', () => {
    const onChange = vi.fn();
    render(<Harness kind={kind} onChange={onChange} />);
    const original = input(kind);
    fireEvent.pointerDown(control(kind), pointer());
    fireEvent.pointerUp(document, pointer(2, 10, { buttons: 0 }));
    fireEvent.pointerMove(control(kind), pointer(1, 80));
    fireEvent.pointerUp(control(kind), pointer(1, 80, { buttons: 0 }));
    expect(onChange.mock.calls.map(([value]) => value)).toEqual(kind === 'hue' ? [252, 288] : [70, 80]);
    expect(input(kind)).toBe(original);
  });

  it('rejects a competing nonprimary press and its end without replacing the owner', () => {
    const onChange = vi.fn();
    render(<Harness kind={kind} onChange={onChange} />);
    fireEvent.pointerDown(control(kind), pointer());
    fireEvent.pointerDown(control(kind), pointer(2, 10, { isPrimary: false }));
    fireEvent.pointerUp(document, pointer(2, 10, { buttons: 0 }));
    fireEvent.pointerMove(control(kind), pointer(1, 80));
    fireEvent.pointerUp(control(kind), pointer(1, 80, { buttons: 0 }));
    expect(onChange.mock.calls.map(([value]) => value)).toEqual(kind === 'hue' ? [252, 288] : [70, 80]);
  });

  it.each(['pointerCancel', 'lostPointerCapture'] as const)('retires %s so later foreign movement cannot edit', (termination) => {
    const onChange = vi.fn();
    render(<Harness kind={kind} onChange={onChange} />);
    fireEvent.pointerDown(control(kind), pointer());
    fireEvent[termination](control(kind), pointer());
    fireEvent.pointerMove(control(kind), pointer(2, 80));
    fireEvent.pointerUp(document, pointer(2, 80, { buttons: 0 }));
    expect(onChange.mock.calls.map(([value]) => value)).toEqual(kind === 'hue' ? [252] : [70]);
  });

  it('owns touch without a second legacy writer and retains the focused input', () => {
    const onChange = vi.fn();
    render(<Harness kind={kind} onChange={onChange} />);
    const original = input(kind);
    fireEvent.pointerDown(control(kind), pointer(1, 70, { pointerType: 'touch' }));
    fireEvent.touchStart(control(kind), { changedTouches: [{ identifier: 1, clientX: 70, clientY: 6 }] });
    fireEvent.pointerMove(control(kind), pointer(1, 80, { pointerType: 'touch' }));
    fireEvent.touchMove(document, { changedTouches: [{ identifier: 1, clientX: 80, clientY: 6 }] });
    fireEvent.pointerUp(control(kind), pointer(1, 80, { buttons: 0, pointerType: 'touch' }));
    fireEvent.touchEnd(document, { changedTouches: [{ identifier: 1, clientX: 80, clientY: 6 }] });
    expect(onChange.mock.calls.map(([value]) => value)).toEqual(kind === 'hue' ? [252, 288] : [70, 80]);
    expect(original).toHaveFocus();
    expect(input(kind)).toBe(original);
  });

  it('allows fresh keyboard entry and native input edits after cancel without replaying pointer data', () => {
    const onChange = vi.fn();
    render(<><button>Outside</button><Harness kind={kind} onChange={onChange} /></>);
    const original = input(kind);
    fireEvent.pointerDown(control(kind), pointer());
    fireEvent.pointerCancel(control(kind), pointer());
    act(() => screen.getByRole('button', { name: 'Outside' }).focus());
    act(() => original.focus());
    fireEvent.keyDown(original, { key: 'ArrowRight' });
    fireEvent.change(original, { target: { value: kind === 'hue' ? '290' : '85' } });
    fireEvent.pointerUp(control(kind), pointer(1, 70, { buttons: 0 }));
    expect(onChange).toHaveBeenLastCalledWith(kind === 'hue' ? 290 : 85);
    expect(input(kind)).toBe(original);
    expect(original).toHaveFocus();
  });

  it('uses its explicit measurement surface rather than an unrelated ancestor rectangle', () => {
    const onChange = vi.fn();
    render(<Harness kind={kind} onChange={onChange} />);
    const surface = kind === 'inspector' ? control(kind) : input(kind).parentElement!.parentElement!;
    surface.getBoundingClientRect = () => ({ ...rect, x: 100, left: 100, right: 300, width: 200 });
    fireEvent.pointerDown(control(kind), pointer(1, 150));
    fireEvent.pointerMove(control(kind), pointer(1, 250));
    fireEvent.pointerUp(control(kind), pointer(1, 250, { buttons: 0 }));
    expect(onChange.mock.calls.map(([value]) => value)).toEqual(kind === 'hue' ? [90, 270] : [25, 75]);
    if (kind === 'inspector') expect(control(kind).firstElementChild).toBe(input(kind).parentElement);
  });

  it('uses the latest value callback while preserving the exact native input', () => {
    const before = vi.fn(); const after = vi.fn();
    const view = render(<Harness kind={kind} onChange={before} />);
    const original = input(kind);
    fireEvent.pointerDown(control(kind), pointer());
    view.rerender(<Harness kind={kind} onChange={after} />);
    fireEvent.pointerMove(control(kind), pointer(1, 80));
    fireEvent.pointerUp(control(kind), pointer(1, 80, { buttons: 0 }));
    expect(before).toHaveBeenCalledExactlyOnceWith(kind === 'hue' ? 252 : 70);
    expect(after).toHaveBeenCalledExactlyOnceWith(kind === 'hue' ? 288 : 80);
    expect(input(kind)).toBe(original);
  });

  it('puts its keyboard mark on the visible input ancestor and restores it after pointer entry', () => {
    render(<Harness kind={kind} onChange={vi.fn()} />);
    const original = input(kind);
    const visual = kind === 'inspector' ? control(kind) : original.parentElement!;
    const classes = () => visual.className;
    expect(classes()).toContain('has-[input:focus-visible]:outline-2');
    expect(classes()).toContain('forced-colors:has-[input:focus-visible]:outline-[Highlight]');
    expect(classes()).toContain(kind === 'hue' || kind === 'alpha' ? 'has-[input:focus-visible]:outline-offset-2' : 'has-[input:focus-visible]:-outline-offset-2');
    fireEvent.pointerDown(control(kind), pointer());
    fireEvent.pointerUp(control(kind), pointer(1, 70, { buttons: 0 }));
    expect(classes()).not.toContain('has-[input:focus-visible]:outline-2');
    fireEvent.keyDown(original, { key: 'ArrowRight' });
    expect(classes()).toContain('has-[input:focus-visible]:outline-2');
    expect(original).toHaveFocus();
  });

  it('retains the existing coarse keyboard step', () => {
    const onChange = vi.fn();
    render(<Harness kind={kind} onChange={onChange} />);
    fireEvent.keyDown(input(kind), { key: 'ArrowRight', shiftKey: true });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(kind === 'hue' ? 190 : 60);
  });
});

it('retains Inspector largeStep10 while styled Slider keeps its span-based large step', () => {
  const inspector = vi.fn(); const styled = vi.fn();
  render(<><InspectorSlider value={6} min={4} max={8} onChange={inspector} ariaLabel="Inspector" /><Slider value={6} min={4} max={8} onValueChange={styled} label="Shared" /></>);
  fireEvent.keyDown(input('inspector'), { key: 'ArrowRight', shiftKey: true });
  fireEvent.keyDown(input('shared'), { key: 'ArrowRight', shiftKey: true });
  expect(inspector).toHaveBeenCalledExactlyOnceWith(8);
  expect(styled).toHaveBeenCalledExactlyOnceWith(7);
});

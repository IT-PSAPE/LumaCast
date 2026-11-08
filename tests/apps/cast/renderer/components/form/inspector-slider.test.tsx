import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { InspectorSlider } from '../../../../../../apps/cast/renderer/components/form/inspector-slider';

// The slider lives inside dropdown menus. Its owned pointer path must keep
// click/drag edits working while native input keys stay out of menu navigation.

afterEach(cleanup);

function renderSlider(overrides: Partial<Parameters<typeof InspectorSlider>[0]> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <InspectorSlider value={6} min={4} max={8} onChange={onChange} label="Size" ariaLabel="Grid size" {...overrides} />,
  );
  return { ...utils, onChange, input: utils.getByLabelText('Grid size') as HTMLInputElement };
}

describe('InspectorSlider', () => {
  it('exposes a real range input carrying the current bounds and value', () => {
    const { input } = renderSlider();
    expect(input.type).toBe('range');
    expect(input.min).toBe('4');
    expect(input.max).toBe('8');
    expect(input.value).toBe('6');
  });

  it('reports the numeric value alongside the label', () => {
    const { getByText } = renderSlider();
    expect(getByText('Size')).not.toBeNull();
    expect(getByText('6')).not.toBeNull();
  });

  it('forwards a change to onChange', () => {
    const { input, onChange } = renderSlider();
    fireEvent.change(input, { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it('clamps a value beyond the bounds instead of forwarding it raw', () => {
    const { input, onChange } = renderSlider();
    fireEvent.change(input, { target: { value: '99' } });
    expect(onChange).toHaveBeenCalledWith(8);
  });

  it('snaps to the step for fractional steps', () => {
    const { input, onChange } = renderSlider({ value: 1, min: 0, max: 2, step: 0.5 });
    fireEvent.change(input, { target: { value: '1.6' } });
    expect(onChange).toHaveBeenCalledWith(1.5);
  });

  // The regression: an enclosing menu must not see the keys the slider needs,
  // or arrow/Home/End drive menu navigation instead of the value.
  it.each(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'])(
    'keeps %s away from an enclosing menu handler',
    (key) => {
      const onAncestorKeyDown = vi.fn();
      const { getByLabelText } = render(
        <div onKeyDown={onAncestorKeyDown}>
          <InspectorSlider value={6} min={4} max={8} onChange={vi.fn()} label="Size" ariaLabel="Grid size" />
        </div>,
      );
      fireEvent.keyDown(getByLabelText('Grid size'), { key });
      expect(onAncestorKeyDown).not.toHaveBeenCalled();
    },
  );

  // Escape still has to close the menu, and Tab still has to move focus out.
  it.each(['Escape', 'Tab'])('still lets %s reach the enclosing menu', (key) => {
    const onAncestorKeyDown = vi.fn();
    const { getByLabelText } = render(
      <div onKeyDown={onAncestorKeyDown}>
        <InspectorSlider value={6} min={4} max={8} onChange={vi.fn()} label="Size" ariaLabel="Grid size" />
      </div>,
    );
    fireEvent.keyDown(getByLabelText('Grid size'), { key });
    expect(onAncestorKeyDown).toHaveBeenCalled();
  });

  it('supports click-anywhere and captured drag edits on the original native input', () => {
    const { input, onChange } = renderSlider();
    const control = input.parentElement!.parentElement!;
    control.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 32, width: 100, height: 32, toJSON: () => ({}) });
    const capture = new Set<number>();
    control.setPointerCapture = (id) => { capture.add(id); };
    control.hasPointerCapture = (id) => capture.has(id);
    control.releasePointerCapture = (id) => { capture.delete(id); };
    const pointer = { pointerId: 1, clientX: 75, clientY: 16, button: 0, buttons: 1, isPrimary: true };
    fireEvent.pointerDown(control, pointer);
    fireEvent.pointerMove(control, { ...pointer, clientX: 100 });
    fireEvent.pointerUp(control, { ...pointer, clientX: 100, buttons: 0 });
    expect(onChange.mock.calls.map(([value]) => value)).toEqual([7, 8]);
    expect(control.firstElementChild).toBe(input.parentElement);
    expect(control.querySelector('input')).toBe(input);
  });

  it('exposes the implicit slider role with a live aria-valuenow', () => {
    const { getByRole } = renderSlider();
    const slider = getByRole('slider', { name: 'Grid size' });
    expect(slider.getAttribute('aria-valuenow')).toBe('6');
  });

  it.each([
    ['ArrowRight', 7],
    ['ArrowUp', 7],
    ['ArrowLeft', 5],
    ['ArrowDown', 5],
  ] as const)('steps the value on %s', (key, expected) => {
    const { input, onChange } = renderSlider();
    fireEvent.keyDown(input, { key });
    expect(onChange).toHaveBeenCalledWith(expected);
  });

  it('jumps to the bounds on Home and End', () => {
    const { input, onChange } = renderSlider();
    fireEvent.keyDown(input, { key: 'End' });
    expect(onChange).toHaveBeenCalledWith(8);
    fireEvent.keyDown(input, { key: 'Home' });
    expect(onChange).toHaveBeenCalledWith(4);
  });
});

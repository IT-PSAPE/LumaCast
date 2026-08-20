import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { InspectorSlider } from './inspector-slider';

// This slider is used inside dropdown menus, which is where it previously
// broke: a wrapper preventDefault()ed pointerdown (killing the native range
// drag) and the menu panel's own keydown handler claimed the arrow keys. These
// cover both, plus the value round-trip through the snap/clamp logic.

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

  it('does not suppress the default action on pointerdown, which the native range thumb needs', () => {
    const { input } = renderSlider();
    const event = new Event('pointerdown', { bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

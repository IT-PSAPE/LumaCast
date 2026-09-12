import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WorkbenchProvider } from '@renderer/contexts/workbench-context';
import { ColorPicker } from '../../../../../app/renderer/components/form/color-picker';

// ColorPicker's popover renders through the app's Popover, which reads the
// workbench overlay stack — every render needs a WorkbenchProvider ancestor,
// matching the app's own composition (see bin-shell.test.tsx).

afterEach(cleanup);

function renderPicker(overrides: Partial<Parameters<typeof ColorPicker>[0]> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <WorkbenchProvider>
      <ColorPicker value="#3366CC" onChange={onChange} {...overrides} />
    </WorkbenchProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open color picker' }));
  return { ...utils, onChange };
}

describe('ColorPicker', () => {
  it('opens the popover from the swatch trigger and exposes it as a labelled disclosure', () => {
    const onChange = vi.fn();
    render(
      <WorkbenchProvider>
        <ColorPicker value="#3366CC" onChange={onChange} />
      </WorkbenchProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Open color picker' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('adjusts hue with the arrow keys via the Base UI slider', () => {
    const { onChange } = renderPicker({ value: '#FF0000' }); // hue 0
    const hueThumb = screen.getByRole('slider', { name: 'Hue' });
    expect(hueThumb.getAttribute('aria-valuenow')).toBe('0');
    fireEvent.keyDown(hueThumb, { key: 'ArrowRight' });
    expect(hueThumb.getAttribute('aria-valuenow')).toBe('1');
    expect(hueThumb.getAttribute('aria-valuetext')).toBe('Hue 1 degrees');
    expect(onChange).toHaveBeenCalled();
  });

  it('adjusts alpha with the arrow keys via the Base UI slider', () => {
    const { onChange } = renderPicker({ value: '#FF0000', showAlpha: true });
    const alphaThumb = screen.getByRole('slider', { name: 'Alpha' });
    expect(alphaThumb.getAttribute('aria-valuenow')).toBe('100');
    fireEvent.keyDown(alphaThumb, { key: 'ArrowLeft' });
    expect(alphaThumb.getAttribute('aria-valuenow')).toBe('99');
    expect(alphaThumb.getAttribute('aria-valuetext')).toBe('Alpha 99 percent');
    expect(onChange).toHaveBeenCalled();
  });

  it('does not render an alpha slider when showAlpha is false', () => {
    renderPicker({ showAlpha: false });
    expect(screen.queryByRole('slider', { name: 'Alpha' })).toBeNull();
  });

  it('adjusts saturation and brightness from the keyboard-operable 2D area', () => {
    const { onChange } = renderPicker({ value: '#FF0000' }); // s=100, b=100
    const area = screen.getByRole('slider', { name: 'Color saturation and brightness' });
    expect(area.getAttribute('aria-valuetext')).toBe('Saturation 100%, brightness 100%');
    fireEvent.keyDown(area, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalled();
    expect(area.getAttribute('aria-valuetext')).toBe('Saturation 100%, brightness 99%');
  });

  it('commits a typed hex value on Enter', () => {
    const { onChange } = renderPicker({ value: '#3366CC' });
    const hexInput = screen.getByLabelText('Hex color') as HTMLInputElement;
    // Real focus (not a synthetic focus event) so the component's Enter
    // handler can call .blur() and have jsdom actually fire the blur event.
    act(() => hexInput.focus());
    fireEvent.change(hexInput, { target: { value: '00FF00' } });
    fireEvent.keyDown(hexInput, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('#00FF00');
  });

  it('commits a typed hex value on blur', () => {
    const { onChange } = renderPicker({ value: '#3366CC' });
    const hexInput = screen.getByLabelText('Hex color');
    fireEvent.focus(hexInput);
    fireEvent.change(hexInput, { target: { value: 'ABCDEF' } });
    fireEvent.blur(hexInput);
    expect(onChange).toHaveBeenCalledWith('#ABCDEF');
  });

  it('does not commit an incomplete hex value', () => {
    const { onChange } = renderPicker({ value: '#3366CC' });
    const hexInput = screen.getByLabelText('Hex color');
    fireEvent.focus(hexInput);
    fireEvent.change(hexInput, { target: { value: 'ABC' } });
    fireEvent.blur(hexInput);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('labels each RGB channel input so it is announced individually', () => {
    renderPicker({ value: '#3366CC' });
    // Mode defaults to Hex; switch to RGB via the mode dropdown to reach the
    // per-channel NumberFields and check each is independently labelled.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Hex' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'RGB' }));

    const red = screen.getByLabelText('Red') as HTMLInputElement;
    const green = screen.getByLabelText('Green') as HTMLInputElement;
    const blue = screen.getByLabelText('Blue') as HTMLInputElement;
    expect(red.value).toBe('51'); // 0x33
    expect(green.value).toBe('102'); // 0x66
    expect(blue.value).toBe('204'); // 0xCC
  });

  it('commits a channel edit typed into a labelled NumberField', () => {
    const { onChange } = renderPicker({ value: '#3366CC' });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Hex' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'RGB' }));

    const red = screen.getByLabelText('Red');
    fireEvent.change(red, { target: { value: '255' } });
    expect(onChange).toHaveBeenCalledWith('#ff66cc');
  });
});

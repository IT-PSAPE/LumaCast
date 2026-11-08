import { useState, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Slider } from '@lumacast/ui';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function stubPointerGeometry() {
  const methods = ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture'] as const;
  const before = new Map(methods.map((name) => [
    name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
  ]));
  for (const name of methods) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      value: name === 'hasPointerCapture' ? () => true : vi.fn(),
    });
  }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 20,
    width: 100, height: 20, toJSON: () => ({}),
  } as DOMRect);
  return () => {
    for (const name of methods) {
      const descriptor = before.get(name);
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, name);
    }
  };
}

function Harness({
  onChange,
  ...props
}: Partial<ComponentProps<typeof Slider>> & { onChange?: (value: number) => void }) {
  const [value, setValue] = useState(50);
  return (
    <Slider
      label="Volume"
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      {...props}
    />
  );
}

describe('Slider', () => {
  it('changes and commits keyboard edits normally', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<Harness onChange={onChange} onCommit={onCommit} />);
    const slider = screen.getByRole('slider', { name: 'Volume' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveAttribute('aria-valuenow', '51');
    expect(onChange).toHaveBeenCalledWith(51);
    expect(onCommit).toHaveBeenCalledWith(51);
  });

  it('keeps focus while temporarily unavailable and resumes editing afterward', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const view = render(<Harness onChange={onChange} onCommit={onCommit} />);
    const slider = screen.getByRole('slider', { name: 'Volume' });
    act(() => slider.focus());
    view.rerender(<Harness onChange={onChange} onCommit={onCommit} readOnly />);

    expect(slider).toHaveFocus();
    expect(slider).not.toBeDisabled();
    expect(slider.closest('[aria-disabled="true"]')).toBeTruthy();
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.keyDown(slider, { key: 'End' });
    fireEvent.change(slider, { target: { value: '80' } });
    expect(slider).toHaveAttribute('aria-valuenow', '50');
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(slider).toHaveFocus();

    view.rerender(<Harness onChange={onChange} onCommit={onCommit} />);
    expect(slider.closest('[aria-disabled="true"]')).toBeNull();
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveAttribute('aria-valuenow', '51');
    expect(onCommit).toHaveBeenCalledWith(51);
    expect(slider).toHaveFocus();
  });

  it('blocks pointer and touch edits while temporarily unavailable', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<Harness onChange={onChange} onCommit={onCommit} readOnly />);
    const slider = screen.getByRole('slider', { name: 'Volume' });
    const track = slider.parentElement!.parentElement!;
    act(() => slider.focus());

    fireEvent.pointerDown(track, { button: 0, pointerId: 1, clientX: 90 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 100 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 100 });
    const touch = { identifier: 1, clientX: 90, clientY: 0 };
    fireEvent.touchStart(track, { changedTouches: [touch] });
    fireEvent.touchMove(document, { changedTouches: [touch] });
    fireEvent.touchEnd(document, { changedTouches: [touch] });

    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(slider).toHaveAttribute('aria-valuenow', '50');
    expect(slider).toHaveFocus();
  });

  it('retains native disabled behavior when editing is unavailable', () => {
    const view = render(<Harness />);
    const slider = screen.getByRole('slider', { name: 'Volume' });
    act(() => slider.focus());
    view.rerender(<Harness disabled />);
    expect(slider).toBeDisabled();
  });

  it.each(['pointer', 'touch'])('accepts a fresh %s gesture after temporary unavailability', (input) => {
    const restorePointerGeometry = stubPointerGeometry();
    try {
      const onChange = vi.fn();
      const onCommit = vi.fn();
      const view = render(<Harness onChange={onChange} onCommit={onCommit} readOnly />);
      const slider = screen.getByRole('slider', { name: 'Volume' });
      act(() => slider.focus());
      view.rerender(<Harness onChange={onChange} onCommit={onCommit} />);
      const track = slider.parentElement!.parentElement!;
      fireEvent.pointerDown(track, {
        button: 0, buttons: 1, pointerId: 1, clientX: 70, isPrimary: true,
        pointerType: input === 'touch' ? 'touch' : 'mouse',
      });
      fireEvent.pointerUp(track.parentElement!, { buttons: 0, pointerId: 1, clientX: 70 });
      expect(onChange).toHaveBeenCalledWith(70);
      expect(onCommit).toHaveBeenCalledWith(70);
      expect(slider).toHaveAttribute('aria-valuenow', '70');
    } finally {
      restorePointerGeometry();
    }
  });

  it.each(['pointer', 'touch'])('rejects an invalidated %s release after editing resumes by keyboard', (input) => {
    const restorePointerGeometry = stubPointerGeometry();
    try {
      const onChange = vi.fn();
      const onCommit = vi.fn();
      const view = render(<Harness onChange={onChange} onCommit={onCommit} />);
      const slider = screen.getByRole('slider', { name: 'Volume' });
      const track = slider.parentElement!.parentElement!;
      act(() => slider.focus());
      fireEvent.pointerDown(track, {
        button: 0, buttons: 1, pointerId: 1, clientX: 70, isPrimary: true,
        pointerType: input === 'touch' ? 'touch' : 'mouse',
      });
      expect(onChange).toHaveBeenCalledWith(70);
      view.rerender(<Harness onChange={onChange} onCommit={onCommit} readOnly />);
      view.rerender(<Harness onChange={onChange} onCommit={onCommit} />);
      fireEvent.keyDown(slider, { key: 'ArrowRight' });
      expect(onCommit).toHaveBeenCalledExactlyOnceWith(71);

      fireEvent.pointerMove(track.parentElement!, { buttons: 1, pointerId: 1, clientX: 80 });
      fireEvent.pointerUp(track.parentElement!, { buttons: 0, pointerId: 1, clientX: 80 });
      expect(onCommit).toHaveBeenCalledExactlyOnceWith(71);
      expect(slider).toHaveAttribute('aria-valuenow', '71');
      expect(slider).toHaveFocus();
    } finally {
      restorePointerGeometry();
    }
  });
});

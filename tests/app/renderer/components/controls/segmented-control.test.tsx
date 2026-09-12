import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SegmentedControl } from '../../../../../app/renderer/components/controls/segmented-control';

afterEach(cleanup);

function SingleControl({ onValueChange }: { onValueChange?: (value: string) => void }) {
  const [value, setValue] = useState('left');
  return (
    <SegmentedControl
      label="Alignment"
      value={value}
      onValueChange={(next) => {
        const nextValue = next as string;
        setValue(nextValue);
        onValueChange?.(nextValue);
      }}
    >
      <SegmentedControl.Icon value="left" title="Align left" aria-label="Align left">L</SegmentedControl.Icon>
      <SegmentedControl.Icon value="center" title="Align center" aria-label="Align center">C</SegmentedControl.Icon>
      <SegmentedControl.Icon value="right" title="Align right" aria-label="Align right">R</SegmentedControl.Icon>
    </SegmentedControl>
  );
}

function MultipleControl({ onValueChange }: { onValueChange?: (value: string[]) => void }) {
  const [value, setValue] = useState<string[]>(['bold']);
  return (
    <SegmentedControl
      label="Formatting"
      selectionMode="multiple"
      value={value}
      onValueChange={(next) => {
        const nextValue = next as string[];
        setValue(nextValue);
        onValueChange?.(nextValue);
      }}
    >
      <SegmentedControl.Label value="bold">Bold</SegmentedControl.Label>
      <SegmentedControl.Label value="italic">Italic</SegmentedControl.Label>
    </SegmentedControl>
  );
}

describe('SegmentedControl', () => {
  it('renders role="group" with aria-pressed buttons, one pressed in single mode', () => {
    render(<SingleControl />);
    const group = screen.getByRole('group', { name: 'Alignment' });
    expect(group).toBeTruthy();
    const left = screen.getByRole('button', { name: 'Align left' });
    const center = screen.getByRole('button', { name: 'Align center' });
    expect(left.getAttribute('aria-pressed')).toBe('true');
    expect(center.getAttribute('aria-pressed')).toBe('false');
    // `title` tooltips on icon toggles are preserved pending a dedicated tooltip pass.
    expect(left.getAttribute('title')).toBe('Align left');
  });

  it('single mode: onValueChange receives a plain string and moves the pressed state', () => {
    const onValueChange = vi.fn();
    render(<SingleControl onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Align center' }));
    expect(onValueChange).toHaveBeenCalledWith('center');
    expect(screen.getByRole('button', { name: 'Align center' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Align left' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('multiple mode: onValueChange receives an array and toggles independently', () => {
    const onValueChange = vi.fn();
    render(<MultipleControl onValueChange={onValueChange} />);
    const bold = screen.getByRole('button', { name: 'Bold' });
    const italic = screen.getByRole('button', { name: 'Italic' });
    expect(bold.getAttribute('aria-pressed')).toBe('true');
    expect(italic.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(italic);
    expect(onValueChange).toHaveBeenCalledWith(['bold', 'italic']);
    expect(italic.getAttribute('aria-pressed')).toBe('true');
    expect(bold.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(bold);
    expect(onValueChange).toHaveBeenLastCalledWith(['italic']);
  });

  it('arrow-key navigation moves focus across items and Home/End jump to the ends', async () => {
    render(<SingleControl />);
    const left = screen.getByRole('button', { name: 'Align left' });
    left.focus();
    fireEvent.keyDown(left, { key: 'ArrowRight' });
    // Base UI's composite roving focus moves the actual DOM focus in a queued
    // microtask (it waits for its FocusManager's `returnFocus` to run first).
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Align center' })));
    fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Align right' })));
    fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });
    await waitFor(() => expect(document.activeElement).toBe(left));
  });
});

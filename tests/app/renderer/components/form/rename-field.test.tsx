import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RenameField, type RenameFieldHandle } from '../../../../../app/renderer/components/form/rename-field';

afterEach(cleanup);

describe('RenameField', () => {
  it('renders a bare input with no type attribute (the e2e suite locates it via input:not([type]))', () => {
    render(<RenameField value="Deck 1" onValueChange={vi.fn()} />);
    const input = screen.getByDisplayValue('Deck 1');
    expect(input.tagName).toBe('INPUT');
    expect(input.hasAttribute('type')).toBe(false);
  });

  it('starts read-only, and double-click enters editing', () => {
    render(<RenameField value="Deck 1" onValueChange={vi.fn()} />);
    const input = screen.getByDisplayValue('Deck 1') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    fireEvent.doubleClick(input);
    expect(input.readOnly).toBe(false);
  });

  it('commits a changed draft on Enter', () => {
    const onValueChange = vi.fn();
    render(<RenameField value="Deck 1" onValueChange={onValueChange} />);
    const input = screen.getByDisplayValue('Deck 1') as HTMLInputElement;
    fireEvent.doubleClick(input);
    fireEvent.change(input, { target: { value: 'Deck 2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onValueChange).toHaveBeenCalledWith('Deck 2');
    expect(input.readOnly).toBe(true);
  });

  it('commits a changed draft on blur', () => {
    const onValueChange = vi.fn();
    render(<RenameField value="Deck 1" onValueChange={onValueChange} />);
    const input = screen.getByDisplayValue('Deck 1') as HTMLInputElement;
    fireEvent.doubleClick(input);
    fireEvent.change(input, { target: { value: 'Deck 2' } });
    fireEvent.blur(input);
    expect(onValueChange).toHaveBeenCalledWith('Deck 2');
  });

  it('discards the draft on Escape without committing', () => {
    const onValueChange = vi.fn();
    render(<RenameField value="Deck 1" onValueChange={onValueChange} />);
    const input = screen.getByDisplayValue('Deck 1') as HTMLInputElement;
    fireEvent.doubleClick(input);
    fireEvent.change(input, { target: { value: 'Deck 2' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onValueChange).not.toHaveBeenCalled();
    expect(input.value).toBe('Deck 1');
    expect(input.readOnly).toBe(true);
  });

  it('never commits an unchanged or blank draft', () => {
    const onValueChange = vi.fn();
    render(<RenameField value="Deck 1" onValueChange={onValueChange} />);
    const input = screen.getByDisplayValue('Deck 1') as HTMLInputElement;
    fireEvent.doubleClick(input);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onValueChange).not.toHaveBeenCalled();
    expect(input.value).toBe('Deck 1');
  });

  it('exposes startEditing/stopEditing through the imperative handle', () => {
    const ref = createRef<RenameFieldHandle>();
    render(<RenameField ref={ref} value="Deck 1" onValueChange={vi.fn()} />);
    const input = screen.getByDisplayValue('Deck 1') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    act(() => ref.current?.startEditing());
    expect(input.readOnly).toBe(false);
    act(() => ref.current?.stopEditing());
    expect(input.readOnly).toBe(true);
  });

  it('does not enter editing when disabled via enabled=false', () => {
    render(<RenameField value="Deck 1" onValueChange={vi.fn()} enabled={false} />);
    const input = screen.getByDisplayValue('Deck 1') as HTMLInputElement;
    fireEvent.doubleClick(input);
    expect(input.readOnly).toBe(true);
  });
});

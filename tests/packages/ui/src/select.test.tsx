import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Select } from '@lumacast/ui';

afterEach(cleanup);

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
] as const;

// Base UI's Select settles its floating position/open state asynchronously;
// a subsequent interaction needs a tick for that to land (mirrors the
// FieldSelect tests this component's styling was extracted from).
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('Select', () => {
  it('renders the selected option label in the trigger', () => {
    render(<Select value="b" onValueChange={vi.fn()} options={OPTIONS} label="Letter" />);
    expect(screen.getByRole('combobox', { name: 'Letter' })).toHaveTextContent('Beta');
  });

  it('opens the popup and lists every option', async () => {
    render(<Select value="a" onValueChange={vi.fn()} options={OPTIONS} label="Letter" />);
    const trigger = screen.getByRole('combobox', { name: 'Letter' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await settle();

    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('calls onValueChange with the chosen option', async () => {
    const onValueChange = vi.fn();
    render(<Select value="a" onValueChange={onValueChange} options={OPTIONS} label="Letter" />);
    const trigger = screen.getByRole('combobox', { name: 'Letter' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await settle();

    fireEvent.keyDown(document.activeElement ?? trigger, { key: 'ArrowDown' });
    await settle();
    fireEvent.keyDown(document.activeElement ?? trigger, { key: 'Enter' });
    await settle();

    expect(onValueChange).toHaveBeenCalledWith('b');
  });

  it('disables the trigger via Base UI, exposing data-disabled', () => {
    render(<Select value="a" onValueChange={vi.fn()} options={OPTIONS} label="Letter" disabled />);
    const trigger = screen.getByRole('combobox', { name: 'Letter' });
    expect(trigger.hasAttribute('data-disabled')).toBe(true);
  });
});

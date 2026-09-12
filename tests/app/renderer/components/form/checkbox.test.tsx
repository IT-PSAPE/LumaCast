import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Checkbox } from '../../../../../app/renderer/components/form/checkbox';

afterEach(cleanup);

function BasicCheckbox({ disabled = false, onCheckedChange }: { disabled?: boolean; onCheckedChange?: (checked: boolean) => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <Checkbox.Root
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => {
        setChecked(next);
        onCheckedChange?.(next);
      }}
    >
      <Checkbox.Indicator />
      <Checkbox.Label>Accept terms</Checkbox.Label>
    </Checkbox.Root>
  );
}

describe('Checkbox', () => {
  it('renders role="checkbox" with aria-checked reflecting state, named by Checkbox.Label', () => {
    render(<BasicCheckbox />);
    const box = screen.getByRole('checkbox', { name: 'Accept terms' });
    expect(box.getAttribute('aria-checked')).toBe('false');
  });

  it('clicking toggles aria-checked and fires onCheckedChange(true)', () => {
    const onCheckedChange = vi.fn();
    render(<BasicCheckbox onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole('checkbox', { name: 'Accept terms' });
    fireEvent.click(box);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(box.getAttribute('aria-checked')).toBe('true');
  });

  it('the checkmark indicator only mounts once checked', () => {
    render(<BasicCheckbox />);
    const box = screen.getByRole('checkbox', { name: 'Accept terms' });
    expect(box.querySelector('svg')).toBeNull();
    fireEvent.click(box);
    expect(box.querySelector('svg')).not.toBeNull();
  });

  it('disabled checkboxes ignore clicks', () => {
    const onCheckedChange = vi.fn();
    render(<BasicCheckbox disabled onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole('checkbox', { name: 'Accept terms' });
    fireEvent.click(box);
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(box.getAttribute('aria-checked')).toBe('false');
  });

  it('space/enter keyboard activation toggles the checkbox', () => {
    const onCheckedChange = vi.fn();
    render(<BasicCheckbox onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole('checkbox', { name: 'Accept terms' });
    box.focus();
    fireEvent.keyDown(box, { key: ' ' });
    fireEvent.keyUp(box, { key: ' ' });
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

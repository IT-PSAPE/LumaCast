import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { WorkbenchProvider } from '@renderer/contexts/workbench-context';
import { Field, FieldCheckbox, FieldInput, FieldSelect } from '../../../../../app/renderer/components/form/field';

// A stateful harness for the number field: stepping is only meaningful across
// more than one key press if the new value is fed back in as `value`, exactly
// as every real inspector consumer (shape-element-inspector.tsx etc.) does.
function ControlledNumberField(props: { initial: string; label?: string; min?: number; max?: number; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(props.initial);
  return (
    <FieldInput
      type="number"
      label={props.label}
      min={props.min}
      max={props.max}
      value={value}
      onChange={(next) => {
        setValue(next);
        props.onChange?.(next);
      }}
    />
  );
}

afterEach(() => {
  cleanup();
  const overlay = document.getElementById('overlay-root');
  if (overlay) overlay.replaceChildren();
});

describe('Field.Input (text)', () => {
  it('associates a visible label with the control (getByLabelText)', () => {
    render(<FieldInput label="Name" value="Alice" onChange={vi.fn()} />);
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    expect(input.value).toBe('Alice');
  });

  it('forwards every keystroke as the raw string', () => {
    const onChange = vi.fn();
    render(<FieldInput label="Name" value="Alice" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alicia' } });
    expect(onChange).toHaveBeenCalledWith('Alicia');
  });
});

describe('Field.Input (number)', () => {
  it('associates a visible label with the control', () => {
    render(<FieldInput type="number" label="Minutes" value="5" onChange={vi.fn()} />);
    const input = screen.getByLabelText('Minutes') as HTMLInputElement;
    expect(input.value).toBe('5');
  });

  it('exposes an aria-label for an icon-only field with no visible label', () => {
    render(<FieldInput type="number" ariaLabel="Font size" value="24" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Font size')).not.toBeNull();
  });

  // Base UI's NumberField only reports a value change through `onValueChange` when
  // the typed text parses to a number. Partial/invalid text (a lone "-", "", a
  // trailing ".") never parses, so the raw-string contract depends on this
  // native-onChange hook, not the parsed bridge — this is the case that would
  // silently drop keystrokes if the bridge were the only path wired up.
  it('reports an unparseable in-progress edit as the exact raw text', () => {
    const onChange = vi.fn();
    render(<FieldInput type="number" label="Amount" value="5" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '-' } });
    expect(onChange).toHaveBeenCalledWith('-');
  });

  it('steps the value on ArrowUp/ArrowDown and reports the stepped string', () => {
    const onChange = vi.fn();
    render(<ControlledNumberField initial="5" label="Amount" onChange={onChange} />);
    const input = screen.getByLabelText('Amount');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith('6');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith('5');
  });

  it('clamps stepping at the given max and reports no further change', () => {
    const onChange = vi.fn();
    render(<ControlledNumberField initial="59" label="Seconds" min={0} max={59} onChange={onChange} />);
    fireEvent.keyDown(screen.getByLabelText('Seconds'), { key: 'ArrowUp' });
    // Already at max: NumberField reports no value change, so the raw-string
    // contract stays silent too rather than re-announcing the same value.
    expect(onChange).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Seconds') as HTMLInputElement).value).toBe('59');
  });

  // The inline text editor's font-size field (inline-text-editor.tsx) handles
  // ArrowUp/ArrowDown/Enter itself and calls preventDefault(). Base UI's own
  // NumberField keydown handler bails out as soon as it sees the event already
  // marked defaultPrevented, so it must never also apply its own step.
  it('lets a consumer-supplied onKeyDown fully own Arrow keys (e.g. the inline text editor)', () => {
    const onChange = vi.fn();
    const onCustomStep = vi.fn();
    function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        onCustomStep(event.key);
      }
    }
    render(<FieldInput type="number" ariaLabel="Font size" value="24" onChange={onChange} onKeyDown={handleKeyDown} />);
    fireEvent.keyDown(screen.getByLabelText('Font size'), { key: 'ArrowUp' });
    expect(onCustomStep).toHaveBeenCalledWith('ArrowUp');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Field.Select', () => {
  const OPTIONS = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Gamma' },
  ];

  function renderSelect(overrides: Partial<Parameters<typeof FieldSelect>[0]> = {}) {
    const onChange = vi.fn();
    const utils = render(
      <WorkbenchProvider>
        <FieldSelect label="Letter" value="a" onChange={onChange} options={OPTIONS} {...overrides} />
      </WorkbenchProvider>,
    );
    return { ...utils, onChange };
  }

  it('exposes a combobox trigger associated with its label', () => {
    renderSelect();
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAccessibleName('Letter');
    expect(within(trigger).getByText('Alpha')).not.toBeNull();
  });

  it('renders explicitly composed option parts without an options array', () => {
    render(
      <WorkbenchProvider>
        <FieldSelect label="Letter" value="b" onChange={vi.fn()}>
          <FieldSelect.Option value="a">Alpha</FieldSelect.Option>
          <FieldSelect.Option value="b">Beta</FieldSelect.Option>
        </FieldSelect>
      </WorkbenchProvider>,
    );

    expect(within(screen.getByRole('combobox')).getByText('Beta')).not.toBeNull();
  });

  // Base UI settles the popup's floating position/focus asynchronously after
  // it opens; a subsequent key press needs a tick for that to land, and by
  // then it can have moved DOM focus off the trigger, so re-read
  // `document.activeElement` rather than assuming it stayed put.
  async function settle() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }

  it('opens and selects a composed option while preserving child-before-dynamic order', async () => {
    const onChange = vi.fn();
    render(
      <WorkbenchProvider>
        <FieldSelect
          label="Letter"
          value="a"
          onChange={onChange}
          options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]}
        >
          <FieldSelect.Option value="">No letter</FieldSelect.Option>
        </FieldSelect>
      </WorkbenchProvider>,
    );

    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    await settle();

    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['No letter', 'Alpha', 'Beta']);
    fireEvent.click(options[0]);
    await settle();
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('opens a listbox portaled into #overlay-root with data-popover-content, and selects by keyboard', async () => {
    const { onChange } = renderSelect();
    const trigger = screen.getByRole('combobox');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await settle();

    const listbox = screen.getByRole('listbox');
    const overlayRoot = document.getElementById('overlay-root');
    expect(overlayRoot?.contains(listbox)).toBe(true);
    expect(listbox.closest('[data-popover-content="true"]')).not.toBeNull();

    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(options[0]).toHaveAttribute('data-highlighted');

    fireEvent.keyDown(document.activeElement ?? trigger, { key: 'ArrowDown' });
    await settle();
    expect(options[1]).toHaveAttribute('data-highlighted');

    fireEvent.keyDown(document.activeElement ?? trigger, { key: 'Enter' });
    await settle();
    expect(onChange).toHaveBeenCalledWith('b');
    await settle(); // flush the popup's own close/focus-return effects
  });

  it('registers with the workbench overlay stack while open', async () => {
    renderSelect();
    const trigger = screen.getByRole('combobox');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await settle();
    const positioner = screen.getByRole('listbox').closest('[style*="z-index"]');
    expect(positioner).not.toBeNull();
    await settle();
  });
});

describe('Field.Checkbox', () => {
  it('renders an accessible, toggleable checkbox', () => {
    const onChange = vi.fn();
    render(<FieldCheckbox checked={false} label="Enabled" onChange={onChange} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Enabled' });
    expect(checkbox).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(checkbox);
    // Base UI's onCheckedChange also passes an eventDetails object; FieldCheckbox's
    // own contract to its caller is a plain `(checked: boolean) => void`.
    expect(onChange.mock.calls[0]?.[0]).toBe(true);
  });
});

describe('Field export shape', () => {
  it('keeps the compound Field object stable', () => {
    expect(Field.Input).toBe(FieldInput);
    expect(Field.Select).toBe(FieldSelect);
    expect(Field.Checkbox).toBe(FieldCheckbox);
  });
});

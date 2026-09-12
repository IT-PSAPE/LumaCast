import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReacstButtonGroup } from '@renderer/components/controls/button-group';

afterEach(cleanup);

// Backed by Base UI's Toolbar: the group's buttons are independent actions
// (add text / add shape / …, per its one real consumer in stage-panel.tsx),
// not an exclusive selection, so Toolbar's roving-tabindex group — not
// ToggleGroup — is the right primitive. These cover the roving-tabindex
// arrow-key navigation Toolbar provides (it does not offer Home/End).
describe('ReacstButtonGroup', () => {
  function renderGroup() {
    const onText = vi.fn();
    const onShape = vi.fn();
    const onImage = vi.fn();
    render(
      <ReacstButtonGroup.Root>
        <ReacstButtonGroup.Icon native label="Add text" onClick={onText}>T</ReacstButtonGroup.Icon>
        <ReacstButtonGroup.Icon native label="Add shape" onClick={onShape}>S</ReacstButtonGroup.Icon>
        <ReacstButtonGroup.Icon native label="Add image" onClick={onImage}>I</ReacstButtonGroup.Icon>
      </ReacstButtonGroup.Root>,
    );
    return { onText, onShape, onImage };
  }

  it('renders each item as a real button reachable by name', () => {
    const { onText } = renderGroup();
    const text = screen.getByRole('button', { name: 'Add text' });
    expect(text.tagName).toBe('BUTTON');
    fireEvent.click(text);
    expect(onText).toHaveBeenCalledTimes(1);
  });

  // Toolbar moves the actual DOM focus in a microtask (after its own
  // highlighted-index state commits), so each step needs to flush that
  // microtask before asserting focus landed.
  it('moves roving focus across items with the arrow keys and wraps at the ends', async () => {
    renderGroup();
    const text = screen.getByRole('button', { name: 'Add text' });
    const shape = screen.getByRole('button', { name: 'Add shape' });
    const image = screen.getByRole('button', { name: 'Add image' });

    text.focus();
    expect(text).toHaveFocus();
    fireEvent.keyDown(text, { key: 'ArrowRight' });
    await act(async () => {});
    expect(shape).toHaveFocus();
    fireEvent.keyDown(shape, { key: 'ArrowRight' });
    await act(async () => {});
    expect(image).toHaveFocus();
    // Loops back to the start past the last item (Toolbar's default loopFocus).
    fireEvent.keyDown(image, { key: 'ArrowRight' });
    await act(async () => {});
    expect(text).toHaveFocus();
  });

  it('also moves roving focus backward with ArrowLeft', async () => {
    renderGroup();
    const text = screen.getByRole('button', { name: 'Add text' });
    const shape = screen.getByRole('button', { name: 'Add shape' });
    // Reach "shape" through the roving-tabindex mechanism itself (a manual
    // .focus() on a non-default item would not update Toolbar's own
    // highlighted-index state), then step back with ArrowLeft.
    text.focus();
    fireEvent.keyDown(text, { key: 'ArrowRight' });
    await act(async () => {});
    expect(shape).toHaveFocus();
    fireEvent.keyDown(shape, { key: 'ArrowLeft' });
    await act(async () => {});
    expect(text).toHaveFocus();
  });

  it('renders non-native items as divs, and keeps a disabled item focusable per Toolbar convention', () => {
    render(
      <ReacstButtonGroup.Root>
        <ReacstButtonGroup.Item label="Custom">Custom</ReacstButtonGroup.Item>
        <ReacstButtonGroup.Icon native label="Disabled" disabled>D</ReacstButtonGroup.Icon>
      </ReacstButtonGroup.Root>,
    );
    const custom = screen.getByRole('button', { name: 'Custom' });
    expect(custom.tagName).toBe('DIV');
    const disabled = screen.getByRole('button', { name: 'Disabled' });
    // Toolbar disables via aria-disabled/data-disabled rather than the native
    // `disabled` attribute, so the item stays in the roving-tabindex order.
    expect(disabled).toHaveAttribute('aria-disabled', 'true');
    expect(disabled.hasAttribute('data-disabled')).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Popover } from '@renderer/components/overlays/popover';
import { overlayRoot, overlayStackStore } from './workbench-overlay-stack';

vi.mock('@renderer/contexts/workbench-context', () => import('./workbench-overlay-stack'));

function Fixture({ onClose, placement }: { onClose: () => void; placement?: 'bottom' | 'top-start' }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  // A first render without the anchor mirrors the real callers, which read
  // `triggerRef.current` and only have it once the trigger has mounted.
  const [, forceAnchor] = useState(0);
  return (
    <div>
      <button type="button" ref={(node) => { triggerRef.current = node; forceAnchor(1); }}>Trigger</button>
      <button type="button">Elsewhere</button>
      {/* Stands in for a nested menu surface portalled by another overlay. */}
      <div data-context-menu-owned="true"><button type="button">Submenu item</button></div>
      <Popover anchor={triggerRef.current} open onClose={onClose} placement={placement} className="w-56">
        <button type="button">Inside</button>
      </Popover>
    </div>
  );
}

// Base UI treats a mouse dismissal as "intentional": it only counts once the
// press has both started and finished outside the popup.
function press(target: Element) {
  fireEvent.pointerDown(target);
  fireEvent.mouseDown(target);
  fireEvent.pointerUp(target);
  fireEvent.mouseUp(target);
  fireEvent.click(target);
}

afterEach(() => {
  cleanup();
  overlayStackStore.reset();
});

describe('Popover', () => {
  it('renders its surface into the overlay root, tagged as popover content', async () => {
    render(<Fixture onClose={() => {}} />);

    const popup = await waitFor(() => {
      const found = overlayRoot().querySelector('[data-popover-content="true"]');
      if (!found) throw new Error('popover not mounted');
      return found as HTMLElement;
    });

    expect(popup.className).toContain('w-56');
    expect(popup.className).toContain('pointer-events-auto');
    expect(screen.getByRole('button', { name: 'Inside' })).toBeTruthy();
    expect(overlayStackStore.entries).toHaveLength(1);
  });

  it('maps a compound placement onto Base UI side and align', async () => {
    render(<Fixture onClose={() => {}} placement="top-start" />);

    const popup = await waitFor(() => {
      const found = overlayRoot().querySelector<HTMLElement>('[data-popover-content="true"]');
      if (!found) throw new Error('popover not mounted');
      return found;
    });

    expect(popup.dataset.side).toBe('top');
    expect(popup.dataset.align).toBe('start');
    expect(popup.dataset.popoverPlacement).toBe('top-start');
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);
    await waitFor(() => expect(overlayRoot().querySelector('[data-popover-content="true"]')).not.toBeNull());

    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('ignores presses on its own anchor and inside other popover surfaces', async () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);
    await waitFor(() => expect(overlayRoot().querySelector('[data-popover-content="true"]')).not.toBeNull());

    // The anchor toggles the popover itself; dismissing here would close and
    // immediately reopen it.
    press(screen.getByRole('button', { name: 'Trigger' }));

    // A press inside a sibling menu surface must not tear this one down before
    // the click reaches the item.
    press(screen.getByRole('button', { name: 'Submenu item' }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onClose).not.toHaveBeenCalled();

    press(screen.getByRole('button', { name: 'Elsewhere' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

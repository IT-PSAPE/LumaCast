import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Dialog } from '@renderer/components/overlays/dialog';
import { overlayRoot, overlayStackStore } from './workbench-overlay-stack';

vi.mock('@renderer/contexts/workbench-context', () => import('./workbench-overlay-stack'));

function Fixture({ closeOnEscape = true }: { closeOnEscape?: boolean }) {
  return (
    <Dialog.Root closeOnEscape={closeOnEscape}>
      <Dialog.Trigger>Open</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Rename slide</Dialog.Title>
              <Dialog.CloseButton />
            </Dialog.Header>
            <Dialog.Body>
              <Dialog.Description>Pick a new name.</Dialog.Description>
              <input aria-label="Name" />
            </Dialog.Body>
            <Dialog.Footer>
              <button type="button">Save</button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

afterEach(() => {
  cleanup();
  overlayStackStore.reset();
});

describe('Dialog', () => {
  it('renders a modal dialog inside the overlay root, labelled and described by its own parts', async () => {
    render(<Fixture />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.dataset.shortcutsScope).toBe('ignore');
    expect(overlayRoot().contains(dialog)).toBe(true);

    const title = screen.getByRole('heading', { name: 'Rename slide' });
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
    expect(dialog.getAttribute('aria-describedby')).toBe(screen.getByText('Pick a new name.').id);
  });

  it('moves focus into the dialog on open and returns it to the trigger on close', async () => {
    render(<Fixture />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('closes on Escape, and honours closeOnEscape={false}', async () => {
    const { rerender } = render(<Fixture />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('dialog');

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    rerender(<Fixture closeOnEscape={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dialog.isConnected).toBe(true);
  });

  it('registers with the workbench overlay stack only while open', async () => {
    render(<Fixture />);
    expect(overlayStackStore.entries).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByRole('dialog');
    expect(overlayStackStore.entries).toHaveLength(1);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(overlayStackStore.entries).toHaveLength(0));
  });

  it('reports open state through a controlled root', async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog.Root open onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Positioner>
            <Dialog.Content>
              <Dialog.Title>Controlled</Dialog.Title>
              <Dialog.CloseButton />
            </Dialog.Content>
          </Dialog.Positioner>
        </Dialog.Portal>
      </Dialog.Root>,
    );

    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

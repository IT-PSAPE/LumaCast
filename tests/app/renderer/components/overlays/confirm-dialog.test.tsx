import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfirmProvider, useConfirm, useConfirmDelete } from '@renderer/components/overlays/confirm-dialog';
import { overlayRoot, overlayStackStore } from './workbench-overlay-stack';

vi.mock('@renderer/contexts/workbench-context', () => import('./workbench-overlay-stack'));

const answers: boolean[] = [];

function Fixture() {
  const confirm = useConfirm();
  const confirmDelete = useConfirmDelete();
  return (
    <>
      <button type="button" onClick={() => confirm({ title: 'Publish?' }).then((answer) => answers.push(answer))}>
        Ask
      </button>
      <button type="button" onClick={() => confirmDelete('Slide 2').then((answer) => answers.push(answer))}>
        Delete
      </button>
    </>
  );
}

function renderFixture() {
  return render(<ConfirmProvider><Fixture /></ConfirmProvider>);
}

afterEach(() => {
  cleanup();
  answers.length = 0;
  overlayStackStore.reset();
});

describe('ConfirmProvider', () => {
  it('asks in an alertdialog inside the overlay root and resolves true when confirmed', async () => {
    renderFixture();
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(overlayRoot().contains(dialog)).toBe(true);
    expect(overlayStackStore.entries).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(answers).toEqual([true]));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('resolves false when cancelled and when dismissed with Escape', async () => {
    renderFixture();
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByRole('alertdialog');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(answers).toEqual([false]));

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await screen.findByRole('alertdialog');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(answers).toEqual([false, false]));
  });

  it('cannot be dismissed by a press outside the popup', async () => {
    renderFixture();
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    const dialog = await screen.findByRole('alertdialog');

    const backdrop = overlayRoot().querySelector('[data-open]');
    fireEvent.pointerDown(backdrop ?? document.body);
    fireEvent.mouseDown(backdrop ?? document.body);
    fireEvent.click(backdrop ?? document.body);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dialog.isConnected).toBe(true);
    expect(answers).toEqual([]);
  });

  it('gives the destructive delete action a real button with a brand focus ring', async () => {
    renderFixture();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('alertdialog');

    expect(screen.getByRole('heading', { name: 'Delete Slide 2?' })).toBeTruthy();
    const destructive = screen.getByRole('button', { name: 'Delete' });
    expect(destructive.tagName).toBe('BUTTON');
    expect(destructive.className).toContain('focus-visible:ring-brand');

    fireEvent.click(destructive);
    await waitFor(() => expect(answers).toEqual([true]));
  });
});

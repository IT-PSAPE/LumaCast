import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider, Modal, OverlayStackProvider, Select, useConfirm } from '@lumacast/ui';

afterEach(() => {
  cleanup();
  document.getElementById('overlay-root')?.remove();
});

function openSelect(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
  fireEvent.mouseDown(trigger, { button: 0 });
  fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
  fireEvent.mouseUp(trigger, { button: 0 });
  fireEvent.click(trigger, { button: 0 });
}

describe('Modal overlay container', () => {
  it('portals into #overlay-root, not body', () => {
    render(
      <OverlayStackProvider>
        <Modal open onClose={() => undefined} title="Settings">
          content
        </Modal>
      </OverlayStackProvider>,
    );
    const root = document.getElementById('overlay-root');
    expect(root).not.toBeNull();
    expect(root).toContainElement(screen.getByRole('dialog', { name: 'Settings' }));
  });

  it('keeps a Select popup inside a Modal reachable to assistive tech', async () => {
    render(
      <OverlayStackProvider>
        <Modal open onClose={() => undefined} title="Settings">
          <Select
            value="a"
            onValueChange={() => undefined}
            label="Choice"
            options={[
              { value: 'a', label: 'Alpha' },
              { value: 'b', label: 'Beta' },
            ]}
          />
        </Modal>
      </OverlayStackProvider>,
    );
    openSelect(screen.getByRole('combobox'));
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(expect.arrayContaining(['Alpha', 'Beta']));
    // The overlay root must not have been hidden by the dialog.
    expect(document.getElementById('overlay-root')).not.toHaveAttribute('aria-hidden', 'true');
  });
});

describe('ConfirmDialog', () => {
  function Trigger({ onResult }: { onResult: (v: boolean) => void }) {
    const confirm = useConfirm();
    return (
      <button type="button" onClick={() => void confirm({ title: 'Delete it?', confirmLabel: 'Delete' }).then(onResult)}>
        ask
      </button>
    );
  }

  it('exposes role="alertdialog" and resolves with the chosen answer', async () => {
    const results: boolean[] = [];
    render(
      <OverlayStackProvider>
        <ConfirmProvider>
          <Trigger onResult={(v) => results.push(v)} />
        </ConfirmProvider>
      </OverlayStackProvider>,
    );
    fireEvent.click(screen.getByText('ask'));
    expect(await screen.findByRole('alertdialog', { name: 'Delete it?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await vi_waitFor(() => expect(results).toEqual([true]));
  });
});

async function vi_waitFor(assertion: () => void) {
  const { waitFor } = await import('@testing-library/react');
  await waitFor(assertion);
}

describe('Modal', () => {
  it('renders nothing while closed', () => {
    render(
      <Modal open={false} onClose={vi.fn()} title="Cues">
        <p>body</p>
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('exposes the app class names the stylesheet targets', () => {
    render(
      <Modal open onClose={vi.fn()} title="Cues">
        <p>body</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('modal');
    // The backdrop is rendered by the dialog portal, not as a wrapper the popup
    // controls, so assert the class exists somewhere in the portal rather than
    // pinning it to a private placement.
    expect(document.getElementById('overlay-root')?.querySelector('.modal-backdrop')).not.toBeNull();
    expect(dialog.querySelector('.modal-heading')).not.toBeNull();
  });

  it('labels the dialog with its title and gives the close control an accessible name', () => {
    render(
      <Modal open onClose={vi.fn()} title="Cues">
        <p>body</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Cues' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveClass('btn');
  });

  it('hides the close glyph from assistive tech while the button keeps its label', () => {
    render(
      <Modal open onClose={vi.fn()} title="Cues">
        <p>body</p>
      </Modal>,
    );
    const close = screen.getByRole('button', { name: 'Close dialog' });
    expect(close.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('closes when the close control is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Cues">
        <p>body</p>
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape from inside the dialog', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Cues">
        <p>body</p>
      </Modal>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not hardcode a z-index on the popup or backdrop; the overlay stack owns stacking', () => {
    render(
      <Modal open onClose={vi.fn()} title="Cues">
        <p>body</p>
      </Modal>,
    );
    const root = document.getElementById('overlay-root');
    expect(screen.getByRole('dialog').className).not.toMatch(/\bz-(50|51)\b/);
    expect(root?.querySelector('.modal-backdrop')?.className ?? '').not.toMatch(/\bz-(50|51)\b/);
  });

  it('renders children inside the popup', () => {
    render(
      <Modal open onClose={vi.fn()} title="Cues">
        <p>body copy</p>
      </Modal>,
    );
    expect(screen.getByText('body copy')).not.toBeNull();
  });
});

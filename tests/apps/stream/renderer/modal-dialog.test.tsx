import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ModalDialog } from '../../../../apps/stream/renderer/modal-dialog';

function pressTab(candidates: HTMLElement[], shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  if (event.defaultPrevented) return;
  const currentIndex = candidates.indexOf(document.activeElement as HTMLElement);
  const nextIndex = (currentIndex + (shiftKey ? -1 : 1) + candidates.length) % candidates.length;
  candidates[nextIndex]?.focus();
}

function DialogHarness() {
  const [open, setOpen] = useState(true);
  const openerRef = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={openerRef}>Open settings</button>
    {open && <ModalDialog backdropClassName="backdrop" className="dialog" labelledBy="dialog-title" openerRef={openerRef} onClose={() => setOpen(false)}>
      <h2 id="dialog-title">Settings</h2>
      <button>First control</button>
      <details><summary>Recording audio tracks</summary><button>Track 1</button></details>
      <button>Last control</button>
    </ModalDialog>}
  </>;
}

describe('Stream modal dialog', () => {
  it('moves focus inside, traps tab navigation, and restores focus after Escape', () => {
    render(<DialogHarness />);

    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    const first = screen.getByRole('button', { name: 'First control' });
    const last = screen.getByRole('button', { name: 'Last control' });
    const trackDisclosure = screen.getByText('Recording audio tracks');
    const tracks = trackDisclosure.closest('details');
    const initialTabOrder = [first, trackDisclosure as HTMLElement, last];
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(first).toHaveFocus();

    pressTab(initialTabOrder, true);
    expect(last).toHaveFocus();
    pressTab(initialTabOrder);
    expect(first).toHaveFocus();
    pressTab(initialTabOrder);
    expect(trackDisclosure).toHaveFocus();
    fireEvent.click(trackDisclosure);
    expect(tracks).toHaveProperty('open', true);
    const trackButton = screen.getByRole('button', { name: 'Track 1' });
    pressTab([first, trackDisclosure as HTMLElement, trackButton, last]);
    expect(trackButton).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open settings' })).toHaveFocus();
  });

  it('closes on backdrop clicks but keeps open when the dialog itself is clicked', () => {
    render(<DialogHarness />);
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    const backdrop = screen.getByRole('presentation');

    fireEvent.mouseDown(dialog);
    expect(dialog).toBeInTheDocument();
    fireEvent.mouseDown(backdrop);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

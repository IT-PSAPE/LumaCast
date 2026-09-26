import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Modal } from '@lumacast/ui';

afterEach(cleanup);

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
    expect(document.querySelector('.modal-backdrop')).not.toBeNull();
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

  it('renders children inside the popup', () => {
    render(
      <Modal open onClose={vi.fn()} title="Cues">
        <p>body copy</p>
      </Modal>,
    );
    expect(screen.getByText('body copy')).not.toBeNull();
  });
});

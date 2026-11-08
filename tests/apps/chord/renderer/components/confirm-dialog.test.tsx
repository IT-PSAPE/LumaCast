import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModalProps } from '@lumacast/ui';

const callbacks = vi.hoisted(() => ({ dismissals: [] as Array<() => void> }));
vi.mock('@lumacast/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lumacast/ui')>();
  return {
    ...actual,
    Modal: (props: ModalProps) => {
      callbacks.dismissals.push(props.onClose);
      return <actual.Modal {...props} />;
    },
  };
});
import { confirmChoice, ConfirmHost } from '../../../../../apps/chord/renderer/components/confirm-dialog';

beforeEach(() => { callbacks.dismissals = []; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('confirmChoice / ConfirmHost', () => {
  it('renders the title, message and choices, and resolves with the clicked choice', async () => {
    render(<ConfirmHost />);
    let pending!: Promise<string | null>;
    act(() => { pending = confirmChoice(
      'Import lyrics',
      [
        { value: 'append', label: 'Append' },
        { value: 'replace', label: 'Replace', variant: 'danger' },
      ],
      'This project already has lyrics.',
    ); });

    expect(await screen.findByText('Import lyrics')).toBeInTheDocument();
    expect(screen.getByText('This project already has lyrics.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Append' }));
    await expect(pending).resolves.toBe('append');
  });

  it('resolves null when dismissed without a choice', async () => {
    render(<ConfirmHost />);
    let pending!: Promise<string | null>;
    act(() => { pending = confirmChoice('Delete cue?', [{ value: 'delete', label: 'Delete' }]); });
    await screen.findByText('Delete cue?');

    fireEvent.click(screen.getByLabelText('Close dialog'));
    await expect(pending).resolves.toBeNull();
  });

  it('renders nothing when no confirm is pending', () => {
    const { container } = render(<ConfirmHost />);
    expect(container).toBeEmptyDOMElement();
  });

  it('settles a replaced request once and ignores its stale dismissal callback', async () => {
    render(<ConfirmHost />);
    const firstSettled = vi.fn();
    let first!: Promise<string | null>;
    act(() => { first = confirmChoice('First', [{ value: 'first', label: 'First choice' }]); });
    void first.then(firstSettled);
    await screen.findByText('First');
    const staleDismiss = callbacks.dismissals.at(-1)!;
    let second!: Promise<string | null>;
    act(() => { second = confirmChoice('Second', [{ value: 'second', label: 'Second choice' }]); });
    await expect(first).resolves.toBeNull();
    act(() => { staleDismiss(); staleDismiss(); });
    expect(screen.getByText('Second')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Second choice' }));
    await expect(second).resolves.toBe('second');
    expect(firstSettled).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('does not replace a visible request with one whose scope is already aborted', async () => {
    render(<ConfirmHost />);
    let pending!: Promise<string | null>;
    act(() => { pending = confirmChoice('Current', [{ value: 'current', label: 'Keep current' }]); });
    const controller = new AbortController();
    controller.abort();
    await expect(confirmChoice('Cancelled', [], undefined, { signal: controller.signal })).resolves.toBeNull();
    expect(screen.queryByText('Cancelled')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Keep current' }));
    await expect(pending).resolves.toBe('current');
  });

  it('actively settles an aborted request once and releases its abort listener', async () => {
    render(<ConfirmHost />);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const settled = vi.fn();
    let pending!: Promise<string | null>;
    act(() => { pending = confirmChoice('Scoped', [{ value: 'ok', label: 'Accept' }], undefined, { signal: controller.signal }); });
    void pending.then(settled);
    await screen.findByText('Scoped');
    const staleDismiss = callbacks.dismissals.at(-1)!;
    act(() => { controller.abort(); controller.abort(); staleDismiss(); });
    await expect(pending).resolves.toBeNull();
    expect(screen.queryByText('Scoped')).not.toBeInTheDocument();
    expect(settled).toHaveBeenCalledExactlyOnceWith(null);
    expect(remove).toHaveBeenCalledExactlyOnceWith('abort', expect.any(Function));
  });

  it('removes a replaced scope listener so aborting it cannot clear the successor', async () => {
    render(<ConfirmHost />);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    let first!: Promise<string | null>;
    let second!: Promise<string | null>;
    act(() => { first = confirmChoice('First', [], undefined, { signal: controller.signal }); });
    act(() => { second = confirmChoice('Second', [{ value: 'ok', label: 'Accept second' }]); });
    await expect(first).resolves.toBeNull();
    expect(remove).toHaveBeenCalledExactlyOnceWith('abort', expect.any(Function));
    act(() => controller.abort());
    fireEvent.click(await screen.findByRole('button', { name: 'Accept second' }));
    await expect(second).resolves.toBe('ok');
  });
});

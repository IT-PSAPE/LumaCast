import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster, useToast } from '@lumacast/ui';

// Toast state is module-level; clear it between tests.
function clearAll() {
  act(() => {
    useToast().dismissAll();
  });
  act(() => {
    vi.advanceTimersByTime(1000);
  });
}

// The exit timer is scheduled by an effect after the dismiss commit, so the
// exit delay must be advanced in a separate act from the dismiss itself.
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  act(() => {
    vi.advanceTimersByTime(500);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  clearAll();
  vi.useRealTimers();
});

describe('Toast', () => {
  it('renders toast() output into a mounted Toaster', () => {
    render(<Toaster />);
    act(() => {
      useToast().toast({ title: 'Saved', description: 'All good' });
    });
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('All good')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeInTheDocument();
  });

  it.each(['info', 'success', 'warning'] as const)('auto-dismisses %s after its duration', (tone) => {
    render(<Toaster />);
    act(() => {
      useToast().toast({ title: `T-${tone}`, tone, duration: 1000 });
    });
    expect(screen.getByText(`T-${tone}`)).toBeInTheDocument();
    advance(1000);
    expect(screen.queryByText(`T-${tone}`)).toBeNull();
  });

  it('uses a 5s default duration for non-errors', () => {
    render(<Toaster />);
    act(() => {
      useToast().toast({ title: 'Default', tone: 'info' });
    });
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByText('Default')).toBeInTheDocument();
    advance(1000);
    expect(screen.queryByText('Default')).toBeNull();
  });

  it('does not auto-dismiss errors by default', () => {
    render(<Toaster />);
    act(() => {
      useToast().toast({ title: 'Boom', tone: 'error' });
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('Boom')).toBeInTheDocument();
  });

  it('auto-dismisses an error when given an explicit duration', () => {
    render(<Toaster />);
    act(() => {
      useToast().toast({ title: 'Brief error', tone: 'error', duration: 500 });
    });
    advance(1000);
    expect(screen.queryByText('Brief error')).toBeNull();
  });

  it('replaces a toast with the same id in place instead of stacking', () => {
    render(<Toaster />);
    act(() => {
      useToast().toast({ id: 'upload', title: 'Uploading 1/3', duration: null });
    });
    act(() => {
      useToast().toast({ id: 'upload', title: 'Uploading 2/3', duration: null });
    });
    expect(screen.queryByText('Uploading 1/3')).toBeNull();
    expect(screen.getByText('Uploading 2/3')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('caps the stack at max and drops the oldest', () => {
    render(<Toaster max={2} />);
    act(() => {
      const { toast } = useToast();
      toast({ title: 'one', duration: null });
      toast({ title: 'two', duration: null });
      toast({ title: 'three', duration: null });
    });
    expect(screen.queryByText('one')).toBeNull();
    expect(screen.getByText('two')).toBeInTheDocument();
    expect(screen.getByText('three')).toBeInTheDocument();
  });

  it('maps tone to the live region role', () => {
    render(<Toaster />);
    act(() => {
      const { toast } = useToast();
      toast({ title: 'info-t', tone: 'info', duration: null });
      toast({ title: 'ok-t', tone: 'success', duration: null });
      toast({ title: 'err-t', tone: 'error', duration: null });
    });
    expect(screen.getByText('info-t').closest('[role]')).toHaveAttribute('role', 'status');
    expect(screen.getByText('ok-t').closest('[role]')).toHaveAttribute('role', 'status');
    const error = screen.getByText('err-t').closest('[role]');
    expect(error).toHaveAttribute('role', 'alert');
    expect(error).toHaveAttribute('aria-live', 'assertive');
  });

  it('announces warnings politely, not as an alert', () => {
    render(<Toaster />);
    act(() => {
      useToast().toast({ title: 'warn-t', tone: 'warning', duration: null });
    });
    const warning = screen.getByText('warn-t').closest('[role]');
    expect(warning).toHaveAttribute('role', 'status');
    expect(warning).toHaveAttribute('aria-live', 'polite');
  });

  it('keeps aria-live polite for info and success and assertive only for error', () => {
    render(<Toaster />);
    act(() => {
      const { toast } = useToast();
      toast({ title: 'i', tone: 'info', duration: null });
      toast({ title: 's', tone: 'success', duration: null });
      toast({ title: 'e', tone: 'error', duration: null });
    });
    expect(screen.getByText('i').closest('[role]')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('s').closest('[role]')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('e').closest('[role]')).toHaveAttribute('aria-live', 'assertive');
  });

  it('dismisses via the close control', () => {
    render(<Toaster />);
    act(() => {
      useToast().toast({ title: 'Closable', duration: null });
    });
    act(() => {
      screen.getByRole('button', { name: 'Dismiss' }).click();
    });
    advance(0);
    expect(screen.queryByText('Closable')).toBeNull();
  });
});

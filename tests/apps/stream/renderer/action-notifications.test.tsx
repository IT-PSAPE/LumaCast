import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionNotifications, actionNotificationTone } from '../../../../apps/stream/renderer/action-notifications';

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@lumacast/ui', () => ({
  Toaster: ({ position, max }: { position: string; max: number }) => <div role="region" aria-label="Notifications" data-position={position} data-max={max} />,
  useToast: () => ({ toast }),
}));
afterEach(() => { cleanup(); toast.mockClear(); });

describe('action notifications', () => {
  it('shows brief feedback at bottom right and does not repeat it on unrelated renders', () => {
    const { rerender } = render(<ActionNotifications message="Camera disconnected." />);
    expect(screen.getByRole('region', { name: 'Notifications' })).toHaveAttribute('data-position', 'bottom-right');
    expect(screen.getByRole('region', { name: 'Notifications' })).toHaveAttribute('data-max', '1');
    expect(toast).toHaveBeenCalledWith({ description: 'Camera disconnected.', tone: 'warning', duration: 6000 });
    rerender(<ActionNotifications message="Camera disconnected." />);
    expect(toast).toHaveBeenCalledTimes(1);
    rerender(<ActionNotifications message="" />);
    expect(toast).toHaveBeenCalledTimes(1);
    rerender(<ActionNotifications message="Recording could not start." />);
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ tone: 'error' }));
  });

  it('distinguishes saved actions, unavailable sources, and failures', () => {
    expect(actionNotificationTone('Saved replay to disk.')).toBe('success');
    expect(actionNotificationTone('Could not restore Main camera: device not found.')).toBe('warning');
    expect(actionNotificationTone('Camera capture ended.')).toBe('warning');
    expect(actionNotificationTone('Recording could not start.')).toBe('error');
  });

  it('repeats the same warning only when its event sequence changes', () => {
    const { rerender } = render(<ActionNotifications message="Camera 1 is unavailable." sequence={4} />);
    expect(toast).toHaveBeenCalledTimes(1);
    rerender(<ActionNotifications message="Camera 1 is unavailable." sequence={4} />);
    expect(toast).toHaveBeenCalledTimes(1);
    rerender(<ActionNotifications message="Camera 1 is unavailable." sequence={5} />);
    expect(toast).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenLastCalledWith({
      description: 'Camera 1 is unavailable.',
      tone: 'warning',
      duration: 6000,
    });
  });
});

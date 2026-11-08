import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ShowBrowserContent } from '../../../../../../apps/cast/renderer/screens/show/browser-content';
import type { SlideBrowserIntegrations } from '../../../../../../apps/cast/renderer/features/items/slide-browser-integrations';

// The fixed-tabs show page renders only the selected item's slide tree. The
// playlist-wide continuous browser no longer exists.
vi.mock('../../../../../../apps/cast/renderer/features/items/slide-browser-content', () => ({
  SlideBrowserContent: ({ variant, integrations }: { variant: string; integrations: SlideBrowserIntegrations }) => (
    <div data-testid="single-content" data-variant={variant}>
      {integrations.renderBindingsBadge('slide-1')}
      {integrations.renderActionsMenu(['slide-1', 'slide-2'])}
    </div>
  ),
}));

vi.mock('../../../../../../apps/cast/renderer/features/automation/slide-bindings-badge', () => ({
  SlideBindingsBadge: ({ slideId }: { slideId: string }) => <span data-testid="bindings-badge">{slideId}</span>,
}));

vi.mock('../../../../../../apps/cast/renderer/screens/shared/slide-actions-menu', () => ({
  SlideActionsMenu: ({ slideIds }: { slideIds: string[] }) => <span data-testid="slide-actions">{slideIds.join(',')}</span>,
}));

afterEach(() => {
  cleanup();
});

describe('ShowBrowserContent variant dispatch', () => {
  it.each(['single-grid', 'single-list'] as const)(
    '%s mounts only the single-slide tree with the matching variant',
    (variant) => {
      const { getByTestId } = render(<ShowBrowserContent variant={variant} />);
      expect(getByTestId('single-content').getAttribute('data-variant')).toBe(variant);
      expect(getByTestId('bindings-badge').textContent).toBe('slide-1');
      expect(getByTestId('slide-actions').textContent).toBe('slide-1,slide-2');
    },
  );

  it('empty mounts only the empty placeholder and no browser tree', () => {
    const { container, queryByTestId } = render(<ShowBrowserContent variant="empty" />);
    expect(queryByTestId('single-content')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

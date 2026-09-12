import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ShowBrowserContent } from '../../../../../app/renderer/screens/show/browser-content';

// The fixed-tabs show page renders only the selected item's slide tree. The
// playlist-wide continuous browser no longer exists.
vi.mock('../../../../../app/renderer/features/items/slide-browser-content', () => ({
  SlideBrowserContent: ({ variant }: { variant: string }) => (
    <div data-testid="single-content" data-variant={variant} />
  ),
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
    },
  );

  it('empty mounts only the empty placeholder and no browser tree', () => {
    const { container, queryByTestId } = render(<ShowBrowserContent variant="empty" />);
    expect(queryByTestId('single-content')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

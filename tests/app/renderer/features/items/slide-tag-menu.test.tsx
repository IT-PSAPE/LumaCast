import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlideTagMenu } from '../../../../../app/renderer/features/items/slide-tag-menu';

const mocks = vi.hoisted(() => ({
  slideTags: [] as Array<{ id: string; name: string; colorKey: 'blue' | 'red' }>,
  assignSlideTags: vi.fn(),
  openCreate: vi.fn(),
  openRename: vi.fn(),
  recolor: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../../../../../app/renderer/components/overlays/context-menu', () => ({
  ContextMenu: {
    Submenu: ({ label, children, disabled }: { label: string; children: React.ReactNode; disabled?: boolean }) => (
      <section aria-label={label} data-disabled={disabled ? 'true' : undefined}>{children}</section>
    ),
    Item: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => (
      <button type="button" onClick={onSelect}>{children}</button>
    ),
    Separator: () => <hr />,
  },
}));

vi.mock('../../../../../app/renderer/contexts/app-context', () => ({
  useCast: () => ({
    mutatePatch: (action: () => Promise<unknown>) => action(),
    setStatusText: vi.fn(),
  }),
}));

vi.mock('../../../../../app/renderer/contexts/use-project-content', () => ({
  useProjectContent: () => ({ slideTags: mocks.slideTags }),
}));

vi.mock('../../../../../app/renderer/features/items/slide-tag-manager', () => ({
  useSlideTagManager: () => ({
    openCreate: mocks.openCreate,
    openRename: mocks.openRename,
    recolor: mocks.recolor,
    remove: mocks.remove,
  }),
}));

afterEach(() => {
  cleanup();
  mocks.slideTags = [];
  vi.clearAllMocks();
});

describe('SlideTagMenu', () => {
  it('starts with no predefined tags and offers tag creation', () => {
    render(<SlideTagMenu slideIds={['slide-1']} />);
    expect(screen.getByRole('button', { name: 'Add tag…' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'None' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add tag…' }));
    expect(mocks.openCreate).toHaveBeenCalledTimes(1);
  });

  it('assigns one reusable tag to the full selected slide range', async () => {
    mocks.slideTags = [{ id: 'tag-1', name: 'Chorus', colorKey: 'blue' }];
    mocks.assignSlideTags.mockResolvedValue({});
    (window as unknown as { castApi: Record<string, unknown> }).castApi = { assignSlideTags: mocks.assignSlideTags };

    render(<SlideTagMenu slideIds={['slide-2', 'slide-3']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chorus' }));

    expect(mocks.assignSlideTags).toHaveBeenCalledWith({ slideIds: ['slide-2', 'slide-3'], tagId: 'tag-1' });
  });
});

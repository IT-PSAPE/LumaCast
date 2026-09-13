import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlideActionsMenu } from '../../../../../app/renderer/features/items/slide-actions-menu';

const mocks = vi.hoisted(() => ({
  duplicateSlide: vi.fn(),
  deleteSlide: vi.fn(),
  moveSlide: vi.fn(),
  confirm: vi.fn(),
  slides: [] as Array<{ id: string }>,
}));

vi.mock('../../../../../app/renderer/components/overlays/context-menu', () => ({
  ContextMenu: {
    Item: ({ children, onSelect, disabled }: { children: React.ReactNode; onSelect?: () => void; disabled?: boolean }) => (
      <button type="button" disabled={disabled} onClick={onSelect}>{children}</button>
    ),
    Separator: () => <hr />,
  },
}));

vi.mock('../../../../../app/renderer/contexts/slide-context', () => ({
  useSlides: () => ({
    slides: mocks.slides,
    duplicateSlide: mocks.duplicateSlide,
    deleteSlide: mocks.deleteSlide,
    moveSlide: mocks.moveSlide,
  }),
}));

vi.mock('../../../../../app/renderer/components/overlays/confirm-dialog', () => ({
  useConfirm: () => mocks.confirm,
}));

vi.mock('../../../../../app/renderer/features/automation/slide-automation-menu', () => ({ SlideAutomationMenu: () => null }));
vi.mock('../../../../../app/renderer/features/automation/slide-bindings-menu', () => ({ SlideBindingsMenu: () => null }));
vi.mock('../../../../../app/renderer/features/items/slide-tag-menu', () => ({ SlideTagMenu: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.slides = [];
});

describe('SlideActionsMenu — move up/down (single selection only)', () => {
  it('offers Move up/down for a single selected slide and moves it', () => {
    mocks.slides = [{ id: 'slide-1' }, { id: 'slide-2' }, { id: 'slide-3' }];
    mocks.moveSlide.mockResolvedValue(undefined);
    render(<SlideActionsMenu slideIds={['slide-2']} />);

    const up = screen.getByRole('button', { name: 'Move up' });
    const down = screen.getByRole('button', { name: 'Move down' });
    expect(up.hasAttribute('disabled')).toBe(false);
    expect(down.hasAttribute('disabled')).toBe(false);

    fireEvent.click(up);
    expect(mocks.moveSlide).toHaveBeenCalledWith('slide-2', 'up');

    fireEvent.click(down);
    expect(mocks.moveSlide).toHaveBeenCalledWith('slide-2', 'down');
  });

  it('disables Move up on the first slide and Move down on the last slide', () => {
    mocks.slides = [{ id: 'slide-1' }, { id: 'slide-2' }];

    const { unmount } = render(<SlideActionsMenu slideIds={['slide-1']} />);
    expect(screen.getByRole('button', { name: 'Move up' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Move down' }).hasAttribute('disabled')).toBe(false);
    unmount();

    render(<SlideActionsMenu slideIds={['slide-2']} />);
    expect(screen.getByRole('button', { name: 'Move up' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Move down' }).hasAttribute('disabled')).toBe(true);
  });

  it('hides Move up/down for a multi-slide selection', () => {
    mocks.slides = [{ id: 'slide-1' }, { id: 'slide-2' }];
    render(<SlideActionsMenu slideIds={['slide-1', 'slide-2']} />);

    expect(screen.queryByRole('button', { name: 'Move up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move down' })).toBeNull();
  });
});

describe('SlideActionsMenu', () => {
  it('duplicates every slide in the selected target range', async () => {
    mocks.duplicateSlide.mockResolvedValue(undefined);
    render(<SlideActionsMenu slideIds={['slide-1', 'slide-2']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate 2 slides' }));

    await waitFor(() => expect(mocks.duplicateSlide).toHaveBeenCalledTimes(2));
    expect(mocks.duplicateSlide.mock.calls.map(([id]) => id)).toEqual(['slide-1', 'slide-2']);
  });

  it('confirms once and deletes the selected slides in reverse order', async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.deleteSlide.mockResolvedValue(undefined);
    render(<SlideActionsMenu slideIds={['slide-1', 'slide-2', 'slide-3']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete 3 slides' }));

    await waitFor(() => expect(mocks.deleteSlide).toHaveBeenCalledTimes(3));
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.deleteSlide.mock.calls.map(([id]) => id)).toEqual(['slide-3', 'slide-2', 'slide-1']);
  });
});

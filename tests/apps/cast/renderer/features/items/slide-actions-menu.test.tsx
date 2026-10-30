import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlideActionsMenu } from '../../../../../../apps/cast/renderer/features/items/slide-actions-menu';

const mocks = vi.hoisted(() => ({
  duplicateSlide: vi.fn(),
  deleteSlide: vi.fn(),
  moveSlide: vi.fn(),
  reorderSlide: vi.fn(),
  setCurrentSlideIndex: vi.fn(),
  currentSlideIndex: 0,
  setLyricBlankSlides: vi.fn(),
  confirm: vi.fn(),
  slides: [] as Array<{ id: string; runtimeBlank?: 'start' | 'end' }>,
  currentItemRef: null as { type: 'presentation' | 'lyric'; id: string } | null,
}));

vi.mock('@lumacast/ui', async () => {
  const actual = await vi.importActual<typeof import('@lumacast/ui')>('@lumacast/ui');
  return {
    ...actual,
    useConfirm: () => mocks.confirm,
    ContextMenu: {
      Item: ({ children, onSelect, disabled }: { children: React.ReactNode; onSelect?: () => void; disabled?: boolean }) => (
        <button type="button" disabled={disabled} onClick={onSelect}>{children}</button>
      ),
      Separator: () => <hr />,
      Submenu: ({ label, children }: { label: string; children: React.ReactNode }) => <section aria-label={label}>{children}</section>,
    },
  };
});

vi.mock('../../../../../../apps/cast/renderer/contexts/slide-context', () => ({
  useSlides: () => ({
    slides: mocks.slides,
    currentSlideIndex: mocks.currentSlideIndex,
    setCurrentSlideIndex: mocks.setCurrentSlideIndex,
    duplicateSlide: mocks.duplicateSlide,
    deleteSlide: mocks.deleteSlide,
    moveSlide: mocks.moveSlide,
    reorderSlide: mocks.reorderSlide,
    setLyricBlankSlides: mocks.setLyricBlankSlides,
  }),
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/navigation-context', () => ({
  useNavigation: () => ({ currentItemRef: mocks.currentItemRef }),
}));

vi.mock('../../../../../../apps/cast/renderer/features/automation/slide-automation-menu', () => ({ SlideAutomationMenu: () => null }));
vi.mock('../../../../../../apps/cast/renderer/features/automation/slide-bindings-menu', () => ({ SlideBindingsMenu: () => null }));
vi.mock('../../../../../../apps/cast/renderer/features/items/slide-tag-menu', () => ({ SlideTagMenu: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.slides = [];
  mocks.currentItemRef = null;
  mocks.currentSlideIndex = 0;
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

  it('moves a discontiguous selection as a stable block and restores the active slide', async () => {
    mocks.slides = [{ id: 'slide-1' }, { id: 'slide-2' }, { id: 'slide-3' }, { id: 'slide-4' }, { id: 'slide-5' }];
    mocks.currentSlideIndex = 2;
    mocks.reorderSlide.mockResolvedValue(undefined);
    render(<SlideActionsMenu slideIds={['slide-2', 'slide-4']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Move 2 slides up' }));

    await waitFor(() => expect(mocks.reorderSlide).toHaveBeenCalledTimes(2));
    expect(mocks.reorderSlide.mock.calls).toEqual([['slide-2', 0], ['slide-4', 1]]);
    expect(mocks.setCurrentSlideIndex).toHaveBeenCalledWith(3);
  });

  it('respects first and last boundaries for a selected group', () => {
    mocks.slides = [{ id: 'slide-1' }, { id: 'slide-2' }, { id: 'slide-3' }, { id: 'slide-4' }];
    const { unmount } = render(<SlideActionsMenu slideIds={['slide-1', 'slide-3']} />);
    expect(screen.getByRole('button', { name: 'Move 2 slides up' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Move 2 slides down' }).hasAttribute('disabled')).toBe(false);
    unmount();

    render(<SlideActionsMenu slideIds={['slide-2', 'slide-4']} />);
    expect(screen.getByRole('button', { name: 'Move 2 slides up' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Move 2 slides down' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('SlideActionsMenu', () => {
  it('excludes generated blanks from bulk duplicate and delete actions', async () => {
    mocks.slides = [{ id: 'start', runtimeBlank: 'start' }, { id: 'slide-1' }, { id: 'slide-2' }, { id: 'end', runtimeBlank: 'end' }];
    mocks.duplicateSlide.mockResolvedValue(undefined);
    mocks.deleteSlide.mockResolvedValue(undefined);
    mocks.confirm.mockResolvedValue(true);
    render(<SlideActionsMenu slideIds={['start', 'slide-1', 'slide-2', 'end']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate 2 slides' }));
    await waitFor(() => expect(mocks.duplicateSlide).toHaveBeenCalledTimes(2));
    expect(mocks.duplicateSlide.mock.calls.map(([id]) => id)).toEqual(['slide-1', 'slide-2']);
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 slides' }));
    await waitFor(() => expect(mocks.deleteSlide).toHaveBeenCalledTimes(2));
    expect(mocks.deleteSlide.mock.calls.map(([id]) => id)).toEqual(['slide-2', 'slide-1']);
  });

  it('configures lyric blank slides and keeps runtime blanks immutable', () => {
    mocks.currentItemRef = { type: 'lyric', id: 'lyric-1' };
    mocks.slides = [{ id: 'runtime:lyric:lyric-1:blank:start', runtimeBlank: 'start' }];
    render(<SlideActionsMenu slideIds={['runtime:lyric:lyric-1:blank:start']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Beginning and end' }));
    expect(mocks.setLyricBlankSlides).toHaveBeenCalledWith('both');
    expect(screen.queryByRole('button', { name: 'Duplicate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('duplicates every slide in the selected target range', async () => {
    mocks.slides = [{ id: 'slide-1' }, { id: 'slide-2' }];
    mocks.duplicateSlide.mockResolvedValue(undefined);
    render(<SlideActionsMenu slideIds={['slide-1', 'slide-2']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate 2 slides' }));

    await waitFor(() => expect(mocks.duplicateSlide).toHaveBeenCalledTimes(2));
    expect(mocks.duplicateSlide.mock.calls.map(([id]) => id)).toEqual(['slide-1', 'slide-2']);
  });

  it('confirms once and deletes the selected slides in reverse order', async () => {
    mocks.slides = [{ id: 'slide-1' }, { id: 'slide-2' }, { id: 'slide-3' }];
    mocks.confirm.mockResolvedValue(true);
    mocks.deleteSlide.mockResolvedValue(undefined);
    render(<SlideActionsMenu slideIds={['slide-1', 'slide-2', 'slide-3']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete 3 slides' }));

    await waitFor(() => expect(mocks.deleteSlide).toHaveBeenCalledTimes(3));
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.deleteSlide.mock.calls.map(([id]) => id)).toEqual(['slide-3', 'slide-2', 'slide-1']);
  });
});

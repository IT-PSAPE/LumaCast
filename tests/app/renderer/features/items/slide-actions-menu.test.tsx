import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlideActionsMenu } from '../../../../../app/renderer/features/items/slide-actions-menu';

const mocks = vi.hoisted(() => ({
  duplicateSlide: vi.fn(),
  deleteSlide: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('../../../../../app/renderer/components/overlays/context-menu', () => ({
  ContextMenu: {
    Item: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => <button type="button" onClick={onSelect}>{children}</button>,
    Separator: () => <hr />,
  },
}));

vi.mock('../../../../../app/renderer/contexts/slide-context', () => ({
  useSlides: () => ({ duplicateSlide: mocks.duplicateSlide, deleteSlide: mocks.deleteSlide }),
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

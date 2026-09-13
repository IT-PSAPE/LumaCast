import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlideAutomationMenu } from '../../../../../app/renderer/features/automation/slide-automation-menu';

const mocks = vi.hoisted(() => ({
  ensureCue: vi.fn(),
  createBinding: vi.fn(),
}));

vi.mock('../../../../../app/renderer/components/overlays/context-menu', () => ({
  ContextMenu: {
    Submenu: ({ label, children, disabled }: { label: string; children: React.ReactNode; disabled?: boolean }) => (
      <section aria-label={label} data-disabled={disabled ? 'true' : undefined}>{children}</section>
    ),
    Item: ({ children, onSelect, disabled }: { children: React.ReactNode; onSelect?: () => void; disabled?: boolean }) => (
      <button type="button" disabled={disabled} onClick={onSelect}>{children}</button>
    ),
    Separator: () => <hr />,
  },
}));

vi.mock('../../../../../app/renderer/contexts/use-project-content', () => ({
  useProjectContent: () => ({
    overlays: [],
    stages: [],
    mediaAssets: [
      { id: 'video-1', name: 'Intro Clip', type: 'video' },
      { id: 'image-1', name: 'Backdrop', type: 'image' },
    ],
  }),
}));

vi.mock('../../../../../app/renderer/features/automation/automation-context', () => ({
  useAutomation: () => ({
    state: { macros: [{ id: 'macro-1', name: 'Fade macro' }], isLoading: false },
    actions: { ensureCue: mocks.ensureCue, createBinding: mocks.createBinding },
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SlideAutomationMenu', () => {
  it('binds the Video submenu to video.arm, not mediaLayer.set', async () => {
    mocks.ensureCue.mockResolvedValue({ id: 'cue-video' } as any);
    render(<SlideAutomationMenu slideId="slide-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Intro Clip' }));

    await waitFor(() => expect(mocks.createBinding).toHaveBeenCalledTimes(1));
    expect(mocks.ensureCue).toHaveBeenCalledWith({ kind: 'video.arm', payload: { assetId: 'video-1' } });
    expect(mocks.createBinding).toHaveBeenCalledWith({
      triggerType: 'slide.activate',
      sourceId: 'slide-1',
      targetType: 'cue',
      targetId: 'cue-video',
    });
  });

  it('keeps the Image submenu on mediaLayer.set', async () => {
    mocks.ensureCue.mockResolvedValue({ id: 'cue-image' } as any);
    render(<SlideAutomationMenu slideId="slide-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Backdrop' }));

    await waitFor(() => expect(mocks.createBinding).toHaveBeenCalledTimes(1));
    expect(mocks.ensureCue).toHaveBeenCalledWith({ kind: 'mediaLayer.set', payload: { assetId: 'image-1' } });
  });

  it('defaults new bindings to slide.activate and switches to slide.take once "Take" is chosen', async () => {
    mocks.ensureCue.mockResolvedValue({ id: 'cue-video' } as any);
    render(<SlideAutomationMenu slideId="slide-1" />);

    // Default (no "When" selection made yet): binds on activate.
    fireEvent.click(screen.getByRole('button', { name: 'Intro Clip' }));
    await waitFor(() => expect(mocks.createBinding).toHaveBeenCalledTimes(1));
    expect(mocks.createBinding).toHaveBeenNthCalledWith(1, expect.objectContaining({ triggerType: 'slide.activate' }));

    // Choosing "Take" changes the trigger type used by every subsequent bind.
    fireEvent.click(screen.getByRole('button', { name: 'Take' }));
    fireEvent.click(screen.getByRole('button', { name: 'Intro Clip' }));
    await waitFor(() => expect(mocks.createBinding).toHaveBeenCalledTimes(2));
    expect(mocks.createBinding).toHaveBeenNthCalledWith(2, expect.objectContaining({ triggerType: 'slide.take' }));
  });

  it('also applies the chosen "When" trigger type to macro bindings', async () => {
    render(<SlideAutomationMenu slideId="slide-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Take' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fade macro' }));

    await waitFor(() => expect(mocks.createBinding).toHaveBeenCalledWith({
      triggerType: 'slide.take',
      sourceId: 'slide-1',
      targetType: 'macro',
      targetId: 'macro-1',
    }));
  });
});

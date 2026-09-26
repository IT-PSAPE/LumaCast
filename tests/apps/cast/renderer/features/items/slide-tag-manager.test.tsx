import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SlideTag } from '@lumacast/composition';
import { SlideTagManagerProvider, useSlideTagManager } from '../../../../../../apps/cast/renderer/features/items/slide-tag-manager';

const mocks = vi.hoisted(() => ({
  createSlideTag: vi.fn(),
  updateSlideTag: vi.fn(),
  deleteSlideTag: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/app-context', () => ({
  useCast: () => ({ mutatePatch: (action: () => Promise<unknown>) => action(), setStatusText: vi.fn() }),
}));

vi.mock('../../../../../../apps/cast/renderer/components/overlays/confirm-dialog', () => ({
  useConfirm: () => mocks.confirm,
}));

vi.mock('../../../../../../apps/cast/renderer/components/overlays/dialog', () => ({
  Dialog: {
    Root: ({ children, open }: { children: React.ReactNode; open?: boolean }) => open ? <div>{children}</div> : null,
    Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Backdrop: () => null,
    Positioner: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Header: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Title: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
    CloseButton: () => null,
    Body: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Footer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  },
}));

vi.mock('../../../../../../apps/cast/renderer/components/form/field', () => ({
  FieldInput: ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => (
    <label>{label}<input value={value} onChange={(event) => onChange(event.target.value)} /></label>
  ),
}));

// Only the button is stubbed: @lumacast/ui is a shared barrel that also
// supplies `cn` and the typography primitives this component graph renders
// with, so the mock has to spread the real module.
vi.mock('@lumacast/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('@lumacast/ui')>(),
  ReacstButton: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

const tag: SlideTag = {
  id: 'tag-1',
  name: 'Verse',
  colorKey: 'blue',
  order: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function Harness() {
  const manager = useSlideTagManager();
  return (
    <>
      <button type="button" onClick={manager.openCreate}>New</button>
      <button type="button" onClick={() => manager.openRename(tag)}>Rename</button>
      <button type="button" onClick={() => { void manager.recolor(tag, 'red'); }}>Recolor</button>
      <button type="button" onClick={() => { void manager.remove(tag); }}>Remove</button>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SlideTagManagerProvider', () => {
  it('creates a named tag with a chosen palette color', async () => {
    mocks.createSlideTag.mockResolvedValue({});
    (window as unknown as { castApi: Record<string, unknown> }).castApi = {
      createSlideTag: mocks.createSlideTag,
      updateSlideTag: mocks.updateSlideTag,
      deleteSlideTag: mocks.deleteSlideTag,
    };
    render(<SlideTagManagerProvider><Harness /></SlideTagManagerProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Chorus' } });
    fireEvent.click(screen.getByRole('button', { name: 'Red' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.createSlideTag).toHaveBeenCalledWith({ name: 'Chorus', colorKey: 'red' }));
  });

  it('renames, recolors, and deletes a reusable tag definition', async () => {
    mocks.updateSlideTag.mockResolvedValue({});
    mocks.deleteSlideTag.mockResolvedValue({});
    mocks.confirm.mockResolvedValue(true);
    (window as unknown as { castApi: Record<string, unknown> }).castApi = {
      createSlideTag: mocks.createSlideTag,
      updateSlideTag: mocks.updateSlideTag,
      deleteSlideTag: mocks.deleteSlideTag,
    };
    render(<SlideTagManagerProvider><Harness /></SlideTagManagerProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Bridge' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Recolor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(mocks.updateSlideTag).toHaveBeenCalledWith({ id: 'tag-1', name: 'Bridge' }));
    expect(mocks.updateSlideTag).toHaveBeenCalledWith({ id: 'tag-1', colorKey: 'red' });
    await waitFor(() => expect(mocks.deleteSlideTag).toHaveBeenCalledWith('tag-1'));
  });
});

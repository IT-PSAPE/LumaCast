import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WorkbenchProvider } from '../../../../../../apps/cast/renderer/contexts/workbench-context';
import { ContextMenu } from '../../../../../../apps/cast/renderer/components/overlays/context-menu';
import { ItemContextMenuItems } from '../../../../../../apps/cast/renderer/features/items/item-context-menu-items';

const mocks = vi.hoisted(() => ({
  setStatusText: vi.fn(),
  mutatePatch: vi.fn(async (action: () => Promise<unknown>) => action()),
  runOperation: vi.fn(async (_label: string, action: () => Promise<unknown>) => action()),
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/app-context', () => ({
  useCast: () => ({
    ...mocks,
    snapshot: { lyrics: [{ id: 'target-lyric', blankSlideMode: 'start' }] },
  }),
}));

async function openMenu(type: 'lyric' | 'presentation' = 'lyric') {
  render(
    <WorkbenchProvider>
      <ContextMenu.Root open position={{ x: 10, y: 10 }}>
        <ItemContextMenuItems
          itemRef={{ type, id: 'target-lyric' }} renameRef={{ current: null }}
          isFirst isLast onMove={vi.fn()} onDelete={vi.fn()}
        />
      </ContextMenu.Root>
    </WorkbenchProvider>,
  );
  if (type === 'lyric') fireEvent.click(await screen.findByRole('menuitem', { name: 'Blank slides' }));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('LyricItemBlankSlidesMenu', () => {
  it('hides lyric blank-slide options for presentation context menus', async () => {
    await openMenu('presentation');
    expect(screen.queryByRole('menuitem', { name: 'Blank slides' })).toBeNull();
  });

  it.each([
    ['None', 'none'], ['At beginning', 'start'], ['At end', 'end'], ['Beginning and end', 'both'],
  ])('updates the context-menu lyric to %s without changing navigation', async (label, mode) => {
    const setLyricBlankSlides = vi.fn().mockResolvedValue({});
    window.castApi = { setLyricBlankSlides } as unknown as Window['castApi'];
    await openMenu();

    expect(screen.getByRole('menuitem', { name: 'At beginning Selected' })).not.toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(`^${label}( Selected)?$`) }));
    });
    expect(setLyricBlankSlides).toHaveBeenCalledWith({ lyricId: 'target-lyric', mode });
    expect(mocks.setStatusText).toHaveBeenCalledWith('Updated blank slides');
  });

  it('reports a failed update without an unhandled rejection', async () => {
    const setLyricBlankSlides = vi.fn().mockRejectedValue(new Error('Lyric no longer exists'));
    window.castApi = { setLyricBlankSlides } as unknown as Window['castApi'];
    await openMenu();

    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'None' })); });
    expect(mocks.setStatusText).toHaveBeenCalledWith('Lyric no longer exists');
    expect(mocks.setStatusText).not.toHaveBeenCalledWith('Updated blank slides');
  });
});

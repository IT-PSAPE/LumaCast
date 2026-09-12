import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PlaylistSeparator } from '@lumacast/composition';
import { SeparatorRow } from '../../../../../app/renderer/features/playlists/separator-row';

const mocks = vi.hoisted(() => ({
  movePlaylistRow: vi.fn(),
  removePlaylistRow: vi.fn(),
  renameSeparator: vi.fn(),
  setSeparatorColor: vi.fn(),
  clearRecentlyCreated: vi.fn(),
  confirm: vi.fn(),
}));

const row = { id: 'sep-1', kind: 'separator', label: 'Act One', colorKey: null } as unknown as PlaylistSeparator;

vi.mock('../../../../../app/renderer/contexts/navigation-context', () => ({
  useNavigation: () => ({
    currentPlaylistRows: [row, { id: 'item-1' }],
    movePlaylistRow: mocks.movePlaylistRow,
    removePlaylistRow: mocks.removePlaylistRow,
    renameSeparator: mocks.renameSeparator,
    setSeparatorColor: mocks.setSeparatorColor,
    recentlyCreatedId: null,
    clearRecentlyCreated: mocks.clearRecentlyCreated,
  }),
}));

vi.mock('../../../../../app/renderer/components/overlays/confirm-dialog', () => ({
  useConfirm: () => mocks.confirm,
}));

vi.mock('../../../../../app/renderer/components/layout/sortable-list', () => ({
  useSortableItem: () => ({
    containerRef: () => undefined,
    containerStyle: {},
    isDragging: false,
    handleProps: {},
  }),
}));

vi.mock('@renderer/contexts/workbench-context', () => ({
  useWorkbench: () => ({
    state: {},
    actions: {},
    overlayStack: {
      rootElement: document.body,
      stack: [],
      baseZIndex: 1000,
      register: () => undefined,
      unregister: () => undefined,
    },
  }),
}));

afterEach(cleanup);

describe('SeparatorRow', () => {
  it('renders as a drag overlay, outside the ContextMenu.Root its sortable twin provides', () => {
    render(<SeparatorRow row={row} onDragOver={() => undefined} onDrop={() => undefined} overlay />);

    expect(screen.getByDisplayValue('Act One')).toBeTruthy();
    // The overlay is a floating copy: no menu travels with it.
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('opens its context menu when rendered as a live row', () => {
    render(<SeparatorRow row={row} onDragOver={() => undefined} onDrop={() => undefined} />);

    fireEvent.contextMenu(screen.getByDisplayValue('Act One'));

    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Move up' }).getAttribute('data-disabled')).toBe('');
  });
});

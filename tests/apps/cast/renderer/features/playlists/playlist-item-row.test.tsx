import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { PlaylistItemEntry, PlaylistRow } from '@lumacast/composition';
import { PlaylistItemRow } from '../../../../../../apps/cast/renderer/features/playlists/playlist-item-row';

const mocks = vi.hoisted(() => ({ bodyProps: null as any }));

vi.mock('../../../../../../apps/cast/renderer/components/layout/sortable-list', () => ({
  useSortableItem: () => ({ containerRef: () => undefined, containerStyle: {}, isDragging: false, handleProps: {} }),
}));

vi.mock('../../../../../../apps/cast/renderer/features/playlists/playlist-item-row-body', async () => {
  const React = await import('react');
  return {
    PlaylistItemRowBody: (props: any) => {
      mocks.bodyProps = props;
      return React.createElement('div', { 'data-testid': 'playlist-item-row-body' });
    },
  };
});

vi.mock('@lumacast/ui', async () => {
  const React = await import('react');
  return { ContextMenu: { Root: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children) } };
});

afterEach(() => {
  cleanup();
  mocks.bodyProps = null;
});

describe('PlaylistItemRow', () => {
  it('passes group selection through its sortable wrapper', () => {
    const row = { id: 'entry-1', kind: 'item' } as PlaylistItemEntry;
    const actionRows = [row, { id: 'separator-1', kind: 'separator' }] as PlaylistRow[];
    const onSelectionClick = vi.fn();
    const onRemoveRows = vi.fn();
    const onMoveRows = vi.fn();

    render(
      <PlaylistItemRow
        row={row}
        onDragOver={() => undefined}
        onDrop={() => undefined}
        isMultiSelected
        actionRows={actionRows}
        onSelectionClick={onSelectionClick}
        onRemoveRows={onRemoveRows}
        onMoveRows={onMoveRows}
      />,
    );

    expect(mocks.bodyProps).toMatchObject({
      isMultiSelected: true,
      actionRows,
      onSelectionClick,
      onRemoveRows,
      onMoveRows,
    });
  });
});

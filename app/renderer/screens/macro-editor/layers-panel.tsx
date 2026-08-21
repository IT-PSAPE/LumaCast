import { useCallback } from 'react';
import { EmptyState } from '@renderer/components/display/empty-state';
import { SortableList, useSortableOrder, type SortableOrderCommit } from '@renderer/components/layout/sortable-list';
import { useInspector } from '@renderer/features/inspector/inspector-context';
import { useMacroEditorScreen, type MacroEditorCueRow } from './screen-context';
import { SortableLayerRow } from './sortable-layer-row';

const cueRowId = (row: MacroEditorCueRow) => row.localId;

export function MacroEditorLayersPanel() {
  const { state: { rows: draftRows, currentMacro, selectedRowId }, actions: { reorderRows, selectRow } } = useMacroEditorScreen();
  const { setInspectorTab } = useInspector();

  // Cue rows are a local editor draft, not a snapshot table, so `reorderRows`
  // resolves synchronously — the optimistic layer costs nothing here and keeps
  // every list panel on one code path.
  const commitReorder = useCallback(
    ({ orderedIds }: SortableOrderCommit) => { reorderRows(orderedIds); },
    [reorderRows],
  );

  const { items: rows, dnd } = useSortableOrder({
    items: draftRows,
    getId: cueRowId,
    commit: commitReorder,
  });

  function handleSelect(rowId: string) {
    selectRow(rowId);
    setInspectorTab('properties');
  }

  if (!currentMacro) {
    return (
      <EmptyState.Root data-ui-region="cue-list-panel">
        <EmptyState.Title>No macro selected.</EmptyState.Title>
      </EmptyState.Root>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState.Root data-ui-region="cue-list-panel">
        <EmptyState.Title>No cues yet.</EmptyState.Title>
        <EmptyState.Description>Use the canvas's Add cue button to start the sequence.</EmptyState.Description>
      </EmptyState.Root>
    );
  }

  return (
    <SortableList.Root {...dnd}>
      <div data-ui-region="cue-list-panel" className="flex w-full flex-col gap-1.5">
        {rows.map((row) => (
          <SortableLayerRow
            key={row.localId}
            row={row}
            isSelected={row.localId === selectedRowId}
            onSelect={handleSelect}
          />
        ))}
      </div>
    </SortableList.Root>
  );
}

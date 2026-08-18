import { useCallback } from 'react';
import { GripVertical } from 'lucide-react';
import { EmptyState } from '@renderer/components/display/empty-state';
import { SelectableRow } from '@renderer/components/display/selectable-row';
import { SortableList, useSortableItem, useSortableOrder, type SortableOrderCommit } from '@renderer/components/layout/sortable-list';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { useInspector } from '@renderer/features/inspector/inspector-context';
import { CUE_KIND_LABELS, describeCue } from '@lumacast/automation';
import { useMacroEditorScreen, type MacroEditorCueRow } from './screen-context';

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

function SortableLayerRow({
  row,
  isSelected,
  onSelect,
}: {
  row: MacroEditorCueRow;
  isSelected: boolean;
  onSelect: (rowId: string) => void;
}) {
  const { overlays, stages, mediaAssets, macros } = useProjectContent();
  const { containerRef, containerStyle, handleProps } = useSortableItem(row.localId);

  const label = row.link
    ? describeCue(row.link.cue, { overlays, stages, mediaAssets, macros })
    : row.draftKind
    ? CUE_KIND_LABELS[row.draftKind]
    : 'Unconfigured cue';

  return (
    <div ref={containerRef} style={containerStyle}>
      <SelectableRow.Root selected={isSelected} onClick={() => onSelect(row.localId)} className="w-full">
        <SelectableRow.Leading>
          {/* A span, not a button: the row itself is a <button>, and nesting a
              real button inside is invalid DOM. dnd-kit's attributes supply
              role="button"/tabIndex/aria, so the handle stays keyboard-operable. */}
          <span
            aria-label="Drag to reorder"
            className="inline-flex cursor-grab text-tertiary hover:text-secondary"
            {...handleProps}
          >
            <GripVertical size={14} strokeWidth={1.5} />
          </span>
        </SelectableRow.Leading>
        <SelectableRow.Label>{label}</SelectableRow.Label>
      </SelectableRow.Root>
    </div>
  );
}

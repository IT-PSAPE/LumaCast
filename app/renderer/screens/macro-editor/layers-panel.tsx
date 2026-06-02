import { GripVertical } from 'lucide-react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { EmptyState } from '@renderer/components/display/empty-state';
import { SelectableRow } from '@renderer/components/display/selectable-row';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { useInspector } from '@renderer/features/inspector/inspector-context';
import { CUE_KIND_LABELS, describeCue } from '@renderer/features/automation/describe-cue';
import { useMacroEditorScreen, type MacroEditorCueRow } from './screen-context';

export function MacroEditorLayersPanel() {
  const { state: { rows, currentMacro, selectedRowId }, actions: { reorderRows, selectRow } } = useMacroEditorScreen();
  const { setInspectorTab } = useInspector();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = rows.findIndex((row) => row.localId === active.id);
    const newIndex = rows.findIndex((row) => row.localId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = rows.slice();
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    reorderRows(next.map((row) => row.localId));
  }

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
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={rows.map((row) => row.localId)} strategy={verticalListSortingStrategy}>
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
      </SortableContext>
    </DndContext>
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.localId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
  };

  const label = row.link
    ? describeCue(row.link.cue, { overlays, stages, mediaAssets, macros })
    : row.draftKind
    ? CUE_KIND_LABELS[row.draftKind]
    : 'Unconfigured cue';

  return (
    <div ref={setNodeRef} style={style}>
      <SelectableRow.Root selected={isSelected} onClick={() => onSelect(row.localId)} className="w-full">
        <SelectableRow.Leading>
          {/* A span, not a button: the row itself is a <button>, and nesting a
              real button inside is invalid DOM. dnd-kit's attributes supply
              role="button"/tabIndex/aria, so the handle stays keyboard-operable. */}
          <span
            aria-label="Drag to reorder"
            className="inline-flex cursor-grab text-tertiary hover:text-secondary"
            {...attributes}
            {...listeners}
          >
            <GripVertical size={14} strokeWidth={1.5} />
          </span>
        </SelectableRow.Leading>
        <SelectableRow.Label>{label}</SelectableRow.Label>
      </SelectableRow.Root>
    </div>
  );
}

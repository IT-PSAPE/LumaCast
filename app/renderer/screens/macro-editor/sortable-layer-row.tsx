import { GripVertical } from 'lucide-react';
import { SelectableRow } from '@renderer/components/display/selectable-row';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { CUE_KIND_LABELS, describeCue } from '@lumacast/automation';
import { useSortableItem } from '@renderer/components/layout/sortable-list';
import type { MacroEditorCueRow } from './screen-context';

interface SortableLayerRowProps {
  row: MacroEditorCueRow;
  isSelected: boolean;
  onSelect: (rowId: string) => void;
}

export function SortableLayerRow({ row, isSelected, onSelect }: SortableLayerRowProps) {
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

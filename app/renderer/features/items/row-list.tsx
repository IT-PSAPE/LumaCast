import { Check, ListMusic } from 'lucide-react';
import { ItemIcon } from '@renderer/components/display/entity-icon';
import { EmptyState } from '@renderer/components/display/empty-state';
import { SelectableRow } from '@renderer/components/display/selectable-row';
import type { Row } from './import-export-shared';

export function RowList({
  rows,
  isSelected,
  onToggle,
  emptyMessage,
}: {
  rows: Row[];
  isSelected: (row: Row) => boolean;
  onToggle: (row: Row) => void;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState.Root className="rounded border border-dashed border-primary bg-tertiary/15 py-8">
        <EmptyState.Title>{emptyMessage}</EmptyState.Title>
      </EmptyState.Root>
    );
  }

  return (
    <div className="flex max-h-96 flex-col gap-0.5 overflow-y-auto rounded border border-primary bg-tertiary/15 p-1">
      {rows.map((row) => (
        <SelectableRow.Root
          key={`${row.kind}:${row.id}`}
          selected={isSelected(row)}
          onClick={() => onToggle(row)}
        >
          <SelectableRow.Leading>
            {row.kind === 'playlist' ? (
              <ListMusic size={14} strokeWidth={1.75} className="text-tertiary" />
            ) : (
              <ItemIcon entity={row.item.type} size={14} strokeWidth={1.75} className="text-tertiary" />
            )}
          </SelectableRow.Leading>
          <SelectableRow.Label>{row.title}</SelectableRow.Label>
          <SelectableRow.Trailing>
            <span className="text-xs uppercase tracking-wide text-tertiary">
              {row.kind === 'item' ? row.item.type : 'playlist'}
            </span>
            {isSelected(row) ? <Check size={12} strokeWidth={2.5} className="text-brand_solid" /> : null}
          </SelectableRow.Trailing>
        </SelectableRow.Root>
      ))}
    </div>
  );
}

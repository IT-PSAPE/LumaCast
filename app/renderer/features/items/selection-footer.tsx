import { ReacstButton } from '@renderer/components/controls/button';

export function SelectionFooter({
  selectedCount,
  preview,
  hasSelection,
  onClear,
  onExport,
  inFlight,
}: {
  selectedCount: number;
  preview: string[];
  hasSelection: boolean;
  onClear: () => void;
  onExport: () => void;
  inFlight: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-primary bg-tertiary/25 px-3 py-2">
      <div className="flex flex-col gap-0.5 text-xs text-tertiary">
        <span className="text-sm text-primary">
          {selectedCount === 0 ? 'Nothing selected' : `${selectedCount} selected`}
        </span>
        {preview.length > 0 ? (
          <span className="truncate">
            {preview.slice(0, 3).join(', ')}{preview.length > 3 ? `, +${preview.length - 3} more` : ''}
          </span>
        ) : (
          <span>Pick items above.</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <ReacstButton variant="ghost" onClick={onClear} disabled={!hasSelection}>Clear</ReacstButton>
        <ReacstButton onClick={onExport} disabled={!hasSelection || inFlight}>
          {inFlight ? 'Exporting…' : `Export${hasSelection ? ` (${selectedCount})` : ''}`}
        </ReacstButton>
      </div>
    </div>
  );
}

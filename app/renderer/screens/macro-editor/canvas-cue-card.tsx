import { useProjectContent } from '@renderer/contexts/use-project-content';
import { CUE_KIND_LABELS, describeCue } from '@lumacast/automation';
import { cn } from '@renderer/utils/cn';
import { Workflow } from 'lucide-react';
import type { MacroEditorCueRow } from './screen-context';

interface CanvasCueCardProps {
  row: MacroEditorCueRow;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}

export function CanvasCueCard({ row, index, isSelected, onClick }: CanvasCueCardProps) {
  const { overlays, stages, mediaAssets, macros } = useProjectContent();
  const label = row.link
    ? describeCue(row.link.cue, { overlays, stages, mediaAssets, macros })
    : row.draftKind
    ? CUE_KIND_LABELS[row.draftKind]
    : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-md border bg-secondary/40 px-4 py-3 text-left transition-colors',
        isSelected ? 'border-brand bg-active' : 'border-primary hover:border-secondary',
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded bg-tertiary text-secondary">
        <Workflow size={14} strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs uppercase tracking-wide text-tertiary">Cue {index + 1}</span>
        <span className={cn('truncate text-sm', label ? 'text-primary' : 'text-tertiary italic')}>
          {label ?? 'Unconfigured — set kind + target in the inspector'}
        </span>
      </div>
    </button>
  );
}

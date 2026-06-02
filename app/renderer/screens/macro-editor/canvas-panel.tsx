import { Plus, Workflow } from 'lucide-react';
import { ReacstButton } from '@renderer/components/controls/button';
import { EmptyState } from '@renderer/components/display/empty-state';
import { cn } from '@renderer/utils/cn';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { useInspector } from '@renderer/features/inspector/inspector-context';
import { CUE_KIND_LABELS, describeCue } from '@renderer/features/automation/describe-cue';
import { useMacroEditorScreen, type MacroEditorCueRow } from './screen-context';

export function MacroEditorCanvasPanel() {
  const { state: { currentMacro, rows, selectedRowId }, actions: { addCueDraft, selectRow } } = useMacroEditorScreen();
  const { setInspectorTab } = useInspector();

  function handleAddCue() {
    addCueDraft();
    setInspectorTab('properties');
  }

  function handleSelectRow(rowId: string) {
    selectRow(rowId);
    setInspectorTab('properties');
  }

  if (!currentMacro) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <EmptyState.Root>
          <EmptyState.Title>Select a macro to edit</EmptyState.Title>
          <EmptyState.Description>Pick one from the Macros list, or create a new macro from the Macros tab in the show panel.</EmptyState.Description>
        </EmptyState.Root>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto p-8">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
        {rows.length === 0 ? (
          <EmptyState.Root>
            <EmptyState.Title>No cues yet</EmptyState.Title>
            <EmptyState.Description>Click the button below to add the first cue.</EmptyState.Description>
          </EmptyState.Root>
        ) : (
          rows.map((row, index) => (
            <CanvasCueCard
              key={row.localId}
              row={row}
              index={index}
              isSelected={row.localId === selectedRowId}
              onClick={() => handleSelectRow(row.localId)}
            />
          ))
        )}
        <ReacstButton
          variant="ghost"
          onClick={handleAddCue}
          className="mt-2 w-full justify-center border border-dashed border-secondary py-3"
        >
          <span className="inline-flex items-center gap-1.5">
            <Plus className="size-4" />
            Add cue
          </span>
        </ReacstButton>
      </div>
    </div>
  );
}

function CanvasCueCard({
  row,
  index,
  isSelected,
  onClick,
}: {
  row: MacroEditorCueRow;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}) {
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

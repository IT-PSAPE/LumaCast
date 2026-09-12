import { Plus } from 'lucide-react';
import { ReacstButton } from '@renderer/components/controls/button';
import { EmptyState } from '@renderer/components/display/empty-state';
import { useInspector } from '@renderer/features/inspector/inspector-context';
import { useMacroEditorScreen } from './screen-context';
import { CanvasCueCard } from './canvas-cue-card';

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

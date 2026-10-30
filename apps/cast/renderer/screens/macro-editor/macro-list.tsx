import { useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Id } from '@lumacast/kernel';
import { SortableList, useSortableOrder, type SortableOrderCommit } from '@renderer/components/layout/sortable-list';
import { commitSelectedReorder, runSelectionActions } from '@lumacast/selection';
import type { Macro } from '@lumacast/automation';
import { useConfirm } from '@lumacast/ui';
import { useAutomation } from '@renderer/features/automation/automation-context';
import { useMultiSelection, useMultiSelectionKeyHandler, type SelectionModifiers } from '@lumacast/selection';
import { MacroListItem } from './macro-list-item';

const macroId = (macro: Macro) => macro.id;

interface MacroListProps {
  macros: Macro[];
  currentMacroId: Macro['id'] | null;
  onSelect: (id: Macro['id']) => void;
  onDuplicate: (id: Macro['id']) => void;
  onDelete: (macro: Macro) => void;
}

export function MacroList({ macros, currentMacroId, onSelect, onDuplicate, onDelete }: MacroListProps) {
  const confirm = useConfirm();
  const { actions: { reorderMacro, duplicateMacro, deleteMacro } } = useAutomation();
  const selection = useMultiSelection(macros.map(macroId), 'macro-editor');
  const handleSelectionKeys = useMultiSelectionKeyHandler({
    selectedCount: selection.selectedIds.size,
    selectAll: selection.selectAll,
    clearSelection: selection.clearSelection,
  });

  const commitReorder = useCallback(
    // Unguarded: a rejection is what reverts the optimistic order.
    (change: SortableOrderCommit) => commitSelectedReorder(change, reorderMacro),
    [reorderMacro],
  );

  const { items: orderedMacros, dnd } = useSortableOrder({
    items: macros,
    getId: macroId,
    commit: commitReorder,
    selectedIds: selection.selectedIds,
  });

  const handleSelect = useCallback((id: Id, event: ReactMouseEvent<HTMLElement>) => {
    const modifiers: SelectionModifiers = {
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
    };
    selection.select(id, modifiers);
    if (!modifiers.shiftKey && !modifiers.metaKey && !modifiers.ctrlKey) onSelect(id);
  }, [onSelect, selection.select]);

  const handleContextMenu = useCallback((id: Id, event: ReactMouseEvent<HTMLElement>) => {
    const modifiers: SelectionModifiers = {
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
    };
    if (modifiers.shiftKey || modifiers.metaKey || modifiers.ctrlKey) {
      selection.select(id, modifiers);
    } else if (!selection.selectedIds.has(id)) {
      selection.select(id);
      onSelect(id);
    }
  }, [onSelect, selection.select, selection.selectedIds]);

  const handleDuplicateMany = useCallback(async (ids: Id[]) => {
    await runSelectionActions(ids, duplicateMacro);
  }, [duplicateMacro]);

  const handleDeleteMany = useCallback(async (ids: Id[]) => {
    const ok = await confirm({
      title: `Delete ${ids.length} macros?`,
      description: 'These macros will be permanently removed. Existing slide bindings to them are also removed.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    await runSelectionActions(ids, deleteMacro);
  }, [confirm, deleteMacro]);

  return (
    <SortableList.Root {...dnd}>
      <div className="grid min-w-0 grid-cols-1 content-start gap-1" role="grid" aria-label="Macros" data-shortcuts-scope="ignore" onKeyDown={handleSelectionKeys}>
        {orderedMacros.map((macro) => (
          <MacroListItem
            key={macro.id}
            macro={macro}
            isActive={currentMacroId === macro.id}
            selection={selection}
            onSelect={(event) => handleSelect(macro.id, event)}
            onContextMenu={(event) => handleContextMenu(macro.id, event)}
            onDuplicate={() => onDuplicate(macro.id)}
            onDelete={() => onDelete(macro)}
            onDuplicateMany={(ids) => { void handleDuplicateMany(ids); }}
            onDeleteMany={(ids) => { void handleDeleteMany(ids); }}
          />
        ))}
      </div>
    </SortableList.Root>
  );
}

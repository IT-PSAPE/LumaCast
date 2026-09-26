import { useCallback } from 'react';
import { SortableList, useSortableOrder, type SortableOrderCommit } from '@renderer/components/layout/sortable-list';
import type { Macro } from '@lumacast/automation';
import { useAutomation } from '@renderer/features/automation/automation-context';
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
  const { actions: { reorderMacro } } = useAutomation();

  const commitReorder = useCallback(
    // Unguarded: a rejection is what reverts the optimistic order.
    ({ id, toIndex }: SortableOrderCommit) => reorderMacro(id, toIndex),
    [reorderMacro],
  );

  const { items: orderedMacros, dnd } = useSortableOrder({
    items: macros,
    getId: macroId,
    commit: commitReorder,
  });

  return (
    <SortableList.Root {...dnd}>
      <div className="grid min-w-0 grid-cols-1 content-start gap-1" role="grid" aria-label="Macros">
        {orderedMacros.map((macro, index) => (
          <MacroListItem
            key={macro.id}
            macro={macro}
            index={index}
            isActive={currentMacroId === macro.id}
            onSelect={onSelect}
            onDuplicate={() => onDuplicate(macro.id)}
            onDelete={() => onDelete(macro)}
          />
        ))}
      </div>
    </SortableList.Root>
  );
}

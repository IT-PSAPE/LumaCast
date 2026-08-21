import { useMemo } from 'react';
import type { Id } from '@lumacast/kernel';
import type { Macro, TriggerBinding } from '@lumacast/automation';
import { useWorkbench } from '../../contexts/workbench-context';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { filterByText } from '../../utils/filter-by-text';
import { BinShell } from '@renderer/components/layout/bin-shell';
import { useBinControls } from '@renderer/components/controls/bin-controls';
import { useAutomation } from './automation-context';
import { MacroCard } from './macro-card';

export function MacroBinPanel() {
  const { actions: { setWorkbenchMode } } = useWorkbench();
  const {
    state: { macros, bindings, currentMacroId },
    actions: { setCurrentMacroId, runMacro, deleteMacro, duplicateMacro, updateMacroFields, createBinding, deleteBinding },
  } = useAutomation();
  const { state: { searchValue, viewMode, grid } } = useBinControls();
  const gridSize = grid?.value ?? 3;

  const filteredMacros = useMemo(
    () => filterByText(macros, searchValue, (macro: Macro) => [macro.name, macro.description]),
    [macros, searchValue],
  );

  function handleOpenMacro(id: Id) {
    setCurrentMacroId(id);
    setWorkbenchMode('macro-editor');
  }

  const startupBindingsByMacro = useMemo(() => {
    const map = new Map<Id, TriggerBinding>();
    for (const binding of bindings) {
      if (binding.triggerType === 'app.startup' && binding.targetType === 'macro') {
        map.set(binding.targetId, binding);
      }
    }
    return map;
  }, [bindings]);

  async function toggleRunOnStartup(macroId: Id) {
    const existing = startupBindingsByMacro.get(macroId);
    if (existing) {
      await deleteBinding(existing.id);
    } else {
      await createBinding({ triggerType: 'app.startup', sourceId: null, targetType: 'macro', targetId: macroId });
    }
  }

  return (
    <BinShell>
      <BinShell.Content>
        <BinPanelLayout gridItemSize={gridSize} mode={viewMode}>
          {filteredMacros.map((macro, index) => (
            <MacroCard
              key={macro.id}
              macro={macro}
              index={index}
              isSelected={macro.id === currentMacroId}
              runsOnStartup={startupBindingsByMacro.has(macro.id)}
              onSelect={setCurrentMacroId}
              onOpen={handleOpenMacro}
              onRunMacro={runMacro}
              onDeleteMacro={deleteMacro}
              onDuplicateMacro={duplicateMacro}
              onToggleRunOnStartup={toggleRunOnStartup}
              // updateMacroFields → updateMacro rejects when the macro no longer
              // exists (#214); mutatePatch has already reported the failure (#221),
              // so absorb the rethrow here.
              onRename={(name) => { void updateMacroFields(macro.id, { name }).catch(() => undefined); }}
            />
          ))}
        </BinPanelLayout>
      </BinShell.Content>
    </BinShell>
  );
}

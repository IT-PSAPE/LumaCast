import { useMemo } from 'react';
import type { Id } from '@lumacast/kernel';
import type { Macro, TriggerBinding } from '@lumacast/automation';
import { useConfirm } from '@lumacast/ui';
import { useWorkbench } from '../../contexts/workbench-context';
import { useMultiSelection } from '@lumacast/selection';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { filterByText } from '../../utils/filter-by-text';
import { BinShell } from '@renderer/components/layout/bin-shell';
import { useBinControls } from '@renderer/components/controls/bin-controls';
import { useAutomation } from './automation-context';
import { MacroCard } from './macro-card';
import { runSelectionActions, useMultiSelectionKeyHandler } from '@lumacast/selection';

export function MacroBinPanel() {
  const { actions: { setWorkbenchMode } } = useWorkbench();
  const {
    state: { macros, bindings, currentMacroId },
    actions: { setCurrentMacroId, runMacro, deleteMacro, duplicateMacro, updateMacroFields, createBinding, deleteBinding },
  } = useAutomation();
  const { state: { searchValue, viewMode, grid } } = useBinControls();
  const confirm = useConfirm();
  const gridSize = grid?.value ?? 3;

  const filteredMacros = useMemo(
    () => filterByText(macros, searchValue, (macro: Macro) => [macro.name, macro.description]),
    [macros, searchValue],
  );
  const orderedIds = filteredMacros.map((macro) => macro.id);
  const selection = useMultiSelection(orderedIds, 'macros');
  const handleSelectionKeys = useMultiSelectionKeyHandler({
    selectedCount: selection.selectedIds.size,
    selectAll: selection.selectAll,
    clearSelection: selection.clearSelection,
  });

  function handleSelectionClick(id: Id, modifiers: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) {
    selection.select(id, modifiers);
    return Boolean(modifiers.shiftKey || modifiers.metaKey || modifiers.ctrlKey);
  }

  function handleContextMenuTarget(id: Id) {
    if (!selection.selectedIds.has(id)) selection.select(id);
  }

  function handleOpenMacro(id: Id) {
    setCurrentMacroId(id);
    setWorkbenchMode('macro-editor');
  }

  async function handleDeleteMacros(clickedId: Id) {
    const ids = selection.actionIds(clickedId);
    if (ids.length === 0) return;
    const nameById = new Map(filteredMacros.map((macro) => [macro.id, macro.name]));
    const ok = await confirm({
      title: ids.length === 1 ? `Delete "${nameById.get(ids[0]) ?? 'macro'}"?` : `Delete ${ids.length} macros?`,
      description: ids.length === 1
        ? 'This macro will be permanently removed. Existing slide bindings to it are also removed.'
        : 'These macros will be permanently removed. Existing slide bindings to them are also removed.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (ok) await runSelectionActions(ids, (id) => deleteMacro(id));
  }

  async function handleDuplicateMacros(clickedId: Id) {
    await runSelectionActions(selection.actionIds(clickedId), (id) => duplicateMacro(id));
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
      <BinShell.Content data-shortcuts-scope="ignore" onKeyDown={handleSelectionKeys}>
        <BinPanelLayout gridItemSize={gridSize} mode={viewMode} virtualize>
          {filteredMacros.map((macro) => (
            <MacroCard
              key={macro.id}
              macro={macro}
              isSelected={macro.id === currentMacroId}
              isResourceSelected={selection.selectedIds.has(macro.id)}
              runsOnStartup={startupBindingsByMacro.has(macro.id)}
              onSelect={setCurrentMacroId}
              onSelectionClick={handleSelectionClick}
              onContextMenuTarget={handleContextMenuTarget}
              onOpen={handleOpenMacro}
              onRunMacro={runMacro}
              onDeleteMacro={handleDeleteMacros}
              onDuplicateMacro={handleDuplicateMacros}
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

import { memo, useMemo, useRef } from 'react';
import { Check, Play, Workflow } from 'lucide-react';
import type { Id } from '@lumacast/kernel';
import type { Macro, TriggerBinding } from '@lumacast/automation';
import { useWorkbench } from '../../contexts/workbench-context';
import { ContextMenu, useContextMenuTrigger } from '../../components/overlays/context-menu';
import { useConfirm } from '../../components/overlays/confirm-dialog';
import { RenameField, type RenameFieldHandle } from '../../components/form/rename-field';
import { Thumbnail } from '../../components/display/thumbnail';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { filterByText } from '../../utils/filter-by-text';
import { BinShell } from '@renderer/components/layout/bin-shell';
import { useBinControls } from '@renderer/components/controls/bin-controls';
import { useAutomation } from './automation-context';

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

interface MacroCardProps {
  macro: Macro;
  index: number;
  isSelected: boolean;
  runsOnStartup: boolean;
  onSelect: (id: Id | null) => void;
  onOpen: (id: Id) => void;
  onRunMacro: (id: Id) => Promise<void>;
  onDeleteMacro: (id: Id) => Promise<void>;
  onDuplicateMacro: (id: Id) => Promise<Macro | null>;
  onToggleRunOnStartup: (id: Id) => Promise<void>;
  onRename: (next: string) => void;
}

function MacroCardImpl(props: MacroCardProps) {
  return (
    <ContextMenu.Root>
      <MacroCardBody {...props} />
    </ContextMenu.Root>
  );
}

function MacroCardBody({ macro, index, isSelected, runsOnStartup, onSelect, onOpen, onRunMacro, onDeleteMacro, onDuplicateMacro, onToggleRunOnStartup, onRename }: MacroCardProps) {
  const renameRef = useRef<RenameFieldHandle>(null);
  const confirm = useConfirm();
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ onDelete: () => { void handleDelete(); } });
  const cueCountLabel = `${macro.cues.length} ${macro.cues.length === 1 ? 'cue' : 'cues'}`;

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${macro.name}"?`,
      description: 'This macro will be permanently removed. Existing slide bindings to it are also removed.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    // onDeleteMacro → deleteMacro rejects when the macro no longer exists
    // (#214), which a delete can race with a concurrent delete. mutatePatch has
    // already reported the failure, so absorb the rethrow here.
    if (ok) await onDeleteMacro(macro.id).catch(() => undefined);
  }

  return (
    <>
      <div {...triggerHandlers} ref={triggerRef} className="rounded-xs focus-visible:ring-2 focus-visible:ring-brand">
        <Thumbnail.Tile onClick={() => onSelect(macro.id)} onDoubleClick={() => onOpen(macro.id)} selected={isSelected}>
          <Thumbnail.Body>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-tertiary text-secondary">
              <Workflow className="size-7" strokeWidth={1.5} />
              <span className="text-xs text-tertiary">{cueCountLabel}</span>
            </div>
          </Thumbnail.Body>
          <Thumbnail.Caption>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-sm font-semibold tabular-nums text-secondary">{index + 1}</span>
              <RenameField ref={renameRef} value={macro.name} onValueChange={onRename} className="label-xs" />
            </div>
          </Thumbnail.Caption>
        </Thumbnail.Tile>
      </div>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item onSelect={() => onOpen(macro.id)}>Edit</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { void onDuplicateMacro(macro.id); }}>Duplicate</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { void onRunMacro(macro.id); }}>
            <span className="inline-flex items-center gap-1.5">
              <Play className="size-3.5" />Run now
            </span>
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { void onToggleRunOnStartup(macro.id); }}>
            <span className="inline-flex items-center gap-1.5">
              {runsOnStartup ? <Check className="size-3.5" /> : <span className="inline-block size-3.5" />}
              Run on startup
            </span>
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete(); }}>Delete</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}

const MacroCard = memo(MacroCardImpl);

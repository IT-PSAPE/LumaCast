import { Trash2 } from 'lucide-react';
import { ReacstButton, Label, Select, TextField, Textarea } from '@lumacast/ui';
import { FieldInput } from '@renderer/components/form/field';
import { Section } from '@renderer/features/inspector/inspector-section';
import { useAutomation } from '@renderer/features/automation/automation-context';
import { parseNumber } from '@renderer/utils/slides';
import { useMacroEditorScreen } from './screen-context';
import type { OnScopeExit, ScopeLevel } from '@lumacast/automation';

export function MacroInspector() {
  const {
    state: { currentMacro, rows, pendingName, pendingDescription },
    actions: { updateMacroName, updateMacroDescription, deleteCurrentMacro },
  } = useMacroEditorScreen();
  const { actions: { updateMacroFields } } = useAutomation();
  if (!currentMacro) return null;

  const macroId = currentMacro.id;
  const loopEnabled = currentMacro.loopEnabled;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Section.Root>
        <Section.Header><Label.xs>Macro</Label.xs></Section.Header>
        <Section.Body>
          <TextField label="Name" value={pendingName} onValueChange={updateMacroName} className="col-span-full" />
          <Textarea label="Description" value={pendingDescription} onValueChange={updateMacroDescription} rows={3} className="col-span-full" />
          <div className="text-xs text-tertiary">
            {rows.length} {rows.length === 1 ? 'cue' : 'cues'} in this macro.
          </div>
        </Section.Body>
      </Section.Root>
      <Section.Root>
        <Section.Header><Label.xs>Scope & lifecycle</Label.xs></Section.Header>
        <Section.Body>
          {/* updateMacroFields → updateMacro rejects when the macro no longer exists (#214); mutatePatch has already reported the failure (#221), so absorb the rethrow here. */}
<Select label="Scope" value={currentMacro.scopeLevel} onValueChange={(value) => { void updateMacroFields(macroId, { scopeLevel: value as ScopeLevel }).catch(() => undefined); }} options={[{ value: 'global' satisfies ScopeLevel, label: 'Global (runs until cancelled)' }, { value: 'item' satisfies ScopeLevel, label: 'Item (stops when leaving the item)' }, { value: 'slide' satisfies ScopeLevel, label: 'Slide (stops when leaving the slide)' }]} className="col-span-full" />
          {currentMacro.scopeLevel !== 'global' && (
            <Select label="On scope exit" value={currentMacro.onScopeExit} onValueChange={(value) => { void updateMacroFields(macroId, { onScopeExit: value as OnScopeExit }).catch(() => undefined); }} options={[{ value: 'cancel' satisfies OnScopeExit, label: 'Cancel pending work' }, { value: 'revert' satisfies OnScopeExit, label: 'Revert (undo effects)' }, { value: 'none' satisfies OnScopeExit, label: 'Keep running' }]} className="col-span-full" />
          )}
        </Section.Body>
      </Section.Root>
      <Section.Root>
        <Section.Header><Label.xs>Looping</Label.xs></Section.Header>
        <Section.Body>
          {/* updateMacroFields → updateMacro rejects when the macro no longer exists (#214); mutatePatch has already reported the failure (#221), so absorb the rethrow here. */}
<Select label="Loop" value={loopEnabled ? 'on' : 'off'} onValueChange={(value) => { void updateMacroFields(macroId, { loopEnabled: value === 'on' }).catch(() => undefined); }} options={[{ value: "off", label: 'Run once' }, { value: "on", label: 'Repeat' }]} className="col-span-full" />
          {loopEnabled && (
            <FieldInput
              label="Max iterations (blank = until scope exit / cancel)"
              type="number"
              min={1}
              value={currentMacro.loopCount ?? ''}
              onChange={(value) => {
                const trimmed = value.trim();
                if (trimmed === '') { void updateMacroFields(macroId, { loopCount: null }).catch(() => undefined); return; }
                const parsed = parseNumber(value, currentMacro.loopCount ?? 1);
                void updateMacroFields(macroId, { loopCount: Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : null }).catch(() => undefined);
              }}
              wide
            />
          )}
        </Section.Body>
      </Section.Root>
      <div className="mt-auto p-2">
        {/* deleteCurrentMacro → deleteMacro rejects when the macro no longer
            exists (#214), which a delete can race with a concurrent delete.
            mutatePatch has already reported the failure, so absorb the rethrow
            here. */}
        <ReacstButton variant="danger" onClick={() => { void deleteCurrentMacro().catch(() => undefined); }} className="w-full">
          <span className="inline-flex items-center gap-1.5"><Trash2 className="size-4" />Delete macro</span>
        </ReacstButton>
      </div>
    </div>
  );
}

import { ReacstButton } from '@renderer/components/controls/button';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { Tabs } from '@renderer/components/display/tabs';
import { EmptyState } from '@renderer/components/display/empty-state';
import { useInspector } from '@renderer/features/inspector/inspector-context';
import { useMacroEditorScreen } from './screen-context';
import { MacroInspector } from './macro-inspector';
import { CueInspector } from './cue-inspector';
import { TriggersInspector } from './triggers-inspector';
import type { InspectorTab } from '@renderer/types/ui';

export function MacroEditorInspectorPanel() {
  const { state: { currentMacro, rows, selectedRowId, hasPendingChanges, isPushingChanges }, actions: { saveChanges } } = useMacroEditorScreen();
  const { inspectorTab, setInspectorTab } = useInspector();
  const selectedRow = rows.find((row) => row.localId === selectedRowId) ?? null;

  // Triggers only makes sense at the macro level — bindings are per-macro.
  // When a cue is selected, force back to Properties so the tab list and
  // visible panel stay consistent.
  const effectiveTab: InspectorTab = selectedRow
    ? 'properties'
    : (inspectorTab === 'triggers' || inspectorTab === 'properties')
    ? inspectorTab
    : 'properties';

  function handleTabChange(value: string) {
    setInspectorTab(value as InspectorTab);
  }

  if (!currentMacro) {
    return (
      <LumaCastPanel.Root className="h-full border-l border-secondary" data-ui-region="macro-inspector-panel">
        <div className="flex h-full items-center justify-center p-6">
          <EmptyState.Root>
            <EmptyState.Title>No macro selected</EmptyState.Title>
          </EmptyState.Root>
        </div>
      </LumaCastPanel.Root>
    );
  }

  return (
    <LumaCastPanel.Root className="h-full border-l border-secondary" data-ui-region="macro-inspector-panel">
      <Tabs.Root value={effectiveTab} onValueChange={handleTabChange}>
        <section className="flex flex-1 flex-col">
          <div className="border-b border-primary">
            <Tabs.List label="Inspector">
              <Tabs.Trigger value="properties">Properties</Tabs.Trigger>
              {!selectedRow && <Tabs.Trigger value="triggers">Triggers</Tabs.Trigger>}
            </Tabs.List>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {effectiveTab === 'properties' && (
              selectedRow ? <CueInspector row={selectedRow} /> : <MacroInspector />
            )}
            {effectiveTab === 'triggers' && <TriggersInspector />}
          </div>
        </section>
      </Tabs.Root>
      {hasPendingChanges && (
        <LumaCastPanel.Footer className="p-2">
          {/* saveChanges → updateMacroFields/setMacroCues → updateMacro rejects when
              the macro no longer exists (#214); mutatePatch has already reported the
              failure (#221), so absorb the rethrow here. */}
          <ReacstButton onClick={() => { void saveChanges().catch(() => undefined); }} disabled={isPushingChanges} className="w-full">
            {isPushingChanges ? 'Pushing…' : 'Save Changes'}
          </ReacstButton>
        </LumaCastPanel.Footer>
      )}
    </LumaCastPanel.Root>
  );
}

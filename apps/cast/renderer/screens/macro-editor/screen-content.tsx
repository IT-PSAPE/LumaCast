import { useEffect } from 'react';
import { Plus } from 'lucide-react';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { ScrollArea } from '@renderer/components/layout/scroll-area';
import { EmptyState, DropdownMenu, useConfirm, Panel } from '@lumacast/ui';
import { useInspector } from '@renderer/features/inspector/inspector-context';
import { useAutomation } from '@renderer/features/automation/automation-context';
import { useMacroEditorScreen } from './screen-context';
import { MacroEditorLayersPanel } from './layers-panel';
import { MacroEditorCanvasPanel } from './canvas-panel';
import { MacroEditorInspectorPanel } from './inspector-panel';
import { MacroList } from './macro-list';
import type { Macro } from '@lumacast/automation';

export function MacroEditorScreenContent() {
  const { state: { macros, currentMacro, selectedRowId }, actions: { selectMacro, selectRow } } = useMacroEditorScreen();
  const { actions: { createMacro, duplicateMacro, deleteMacro } } = useAutomation();
  const { setInspectorTab } = useInspector();
  const confirm = useConfirm();

  // ESC clears the selected cue and refocuses the inspector on the macro.
  // Skip when the user is editing a form field — they expect ESC to blur the
  // field, not navigate.
  useEffect(() => {
    if (!selectedRowId) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.getAttribute('contenteditable') === 'true') return;
      event.preventDefault();
      selectRow(null);
      setInspectorTab('properties');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedRowId, selectRow, setInspectorTab]);

  async function handleDelete(macro: Macro) {
    const ok = await confirm({
      title: `Delete "${macro.name}"?`,
      description: 'This macro will be permanently removed. Existing slide bindings to it are also removed.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    // deleteMacro rejects when the macro no longer exists (#214), which a
    // delete can race with a concurrent delete. mutatePatch has already
    // reported the failure, so absorb the rethrow here.
    if (ok) await deleteMacro(macro.id).catch(() => undefined);
  }

  return (
    <SplitPanel.Panel splitId="editor-main" orientation="horizontal" className="h-full" data-ui-region="editor-layout">
      <SplitPanel.Segment id="editor-left" defaultSize={280} minSize={140} collapsible>
        <LumaCastPanel.Root className="h-full border-r border-secondary">
          <SplitPanel.Panel splitId="macro-list-panel" orientation="vertical" className="h-full">
            <SplitPanel.Segment id="macro-list" defaultSize={440} minSize={180}>
              <Panel className="min-h-0">
                <Panel.Header>
                  <Panel.HeaderTitle>Macros</Panel.HeaderTitle>
                  <Panel.HeaderActions>
                    <DropdownMenu
                      align="end"
                      trigger={(
                        <button type="button" aria-label="Add" className="cursor-pointer rounded-sm bg-tertiary p-1 text-primary transition-colors hover:text-primary [&>svg]:size-4">
                          <Plus />
                        </button>
                      )}
                      entries={[
                        { id: 'new-macro', label: 'New macro', onSelect: () => { void createMacro(); } },
                      ]}
                    />
                  </Panel.HeaderActions>
                </Panel.Header>
                <Panel.Body className="flex flex-col items-start scrollbar-hidden">
                  {macros.length === 0 ? (
                    <EmptyState.Root>
                      <EmptyState.Title>No macros yet</EmptyState.Title>
                      <EmptyState.Description>Click the + button to create your first macro.</EmptyState.Description>
                    </EmptyState.Root>
                  ) : (
                    <ScrollArea.Root scrollPadding={8}>
                      <ScrollArea.Viewport className="p-2">
                        <MacroList
                          macros={macros}
                          currentMacroId={currentMacro?.id ?? null}
                          onSelect={selectMacro}
                          onDuplicate={(id) => { void duplicateMacro(id); }}
                          onDelete={(macro) => { void handleDelete(macro); }}
                        />
                      </ScrollArea.Viewport>
                      <ScrollArea.Scrollbar>
                        <ScrollArea.Thumb />
                      </ScrollArea.Scrollbar>
                    </ScrollArea.Root>
                  )}
                </Panel.Body>
              </Panel>
            </SplitPanel.Segment>
            <SplitPanel.Segment id="macro-cues" fill defaultSize={220} minSize={160}>
              <Panel className="min-h-0">
                <Panel.Header className="border-t">
                  <Panel.HeaderTitle>Layers</Panel.HeaderTitle>
                </Panel.Header>
                <Panel.Body padded className="scrollbar-hidden">
                  <MacroEditorLayersPanel />
                </Panel.Body>
              </Panel>
            </SplitPanel.Segment>
          </SplitPanel.Panel>
        </LumaCastPanel.Root>
      </SplitPanel.Segment>
      <SplitPanel.Segment id="editor-center" fill defaultSize={840} minSize={360}>
        <MacroEditorCanvasPanel />
      </SplitPanel.Segment>
      <SplitPanel.Segment id="editor-right" defaultSize={320} minSize={140} collapsible>
        <MacroEditorInspectorPanel />
      </SplitPanel.Segment>
    </SplitPanel.Panel>
  );
}

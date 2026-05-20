import { useEffect } from 'react';
import { Plus, Workflow } from 'lucide-react';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { Thumbnail } from '@renderer/components/display/thumbnail';
import { ScrollArea, useScrollAreaActiveItem } from '@renderer/components/layout/scroll-area';
import { Label } from '@renderer/components/display/text';
import { Dropdown } from '@renderer/components/form/dropdown';
import { EmptyState } from '@renderer/components/display/empty-state';
import { ContextMenu, useContextMenuTrigger } from '@renderer/components/overlays/context-menu';
import { useConfirm } from '@renderer/components/overlays/confirm-dialog';
import { useInspector } from '@renderer/features/inspector/inspector-context';
import { useAutomation } from '@renderer/features/automation/automation-context';
import { MacroEditorScreenProvider, useMacroEditorScreen } from './screen-context';
import { MacroEditorLayersPanel } from './layers-panel';
import { MacroEditorCanvasPanel } from './canvas-panel';
import { MacroEditorInspectorPanel } from './inspector-panel';
import type { Macro } from '@core/types';

export function MacroEditorScreen() {
  return (
    <MacroEditorScreenProvider>
      <MacroEditorScreenContent />
    </MacroEditorScreenProvider>
  );
}

function MacroEditorScreenContent() {
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
      destructive: true,
    });
    if (ok) await deleteMacro(macro.id);
  }

  return (
    <SplitPanel.Panel splitId="editor-main" orientation="horizontal" className="h-full" data-ui-region="editor-layout">
      <SplitPanel.Segment id="editor-left" defaultSize={280} minSize={140} collapsible>
        <LumaCastPanel.Root className="h-full border-r border-secondary">
          <SplitPanel.Panel splitId="macro-list-panel" orientation="vertical" className="h-full">
            <SplitPanel.Segment id="macro-list" defaultSize={440} minSize={180}>
              <LumaCastPanel.Group className="h-full min-h-0">
                <LumaCastPanel.GroupTitle>
                  <Label.sm className="mr-auto">Macros</Label.sm>
                  <Dropdown>
                    <Dropdown.Trigger
                      aria-label="Add"
                      className="cursor-pointer rounded-sm bg-tertiary p-1 text-primary transition-colors hover:text-primary [&>svg]:size-4"
                    >
                      <Plus />
                    </Dropdown.Trigger>
                    <Dropdown.Panel placement="bottom-end">
                      <Dropdown.Item onClick={() => { void createMacro(); }}>
                        New macro
                      </Dropdown.Item>
                    </Dropdown.Panel>
                  </Dropdown>
                </LumaCastPanel.GroupTitle>
                <LumaCastPanel.Content>
                  {macros.length === 0 ? (
                    <EmptyState.Root>
                      <EmptyState.Title>No macros yet</EmptyState.Title>
                      <EmptyState.Description>Click the + button to create your first macro.</EmptyState.Description>
                    </EmptyState.Root>
                  ) : (
                    <ScrollArea.Root scrollPadding={8}>
                      <ScrollArea.Viewport className="p-2">
                        <div className="grid min-w-0 grid-cols-1 content-start gap-1" role="grid" aria-label="Macros">
                          {macros.map((macro, index) => (
                            <MacroListItem
                              key={macro.id}
                              macro={macro}
                              index={index}
                              isActive={currentMacro?.id === macro.id}
                              onSelect={selectMacro}
                              onDuplicate={() => { void duplicateMacro(macro.id); }}
                              onDelete={() => { void handleDelete(macro); }}
                            />
                          ))}
                        </div>
                      </ScrollArea.Viewport>
                      <ScrollArea.Scrollbar>
                        <ScrollArea.Thumb />
                      </ScrollArea.Scrollbar>
                    </ScrollArea.Root>
                  )}
                </LumaCastPanel.Content>
              </LumaCastPanel.Group>
            </SplitPanel.Segment>
            <SplitPanel.Segment id="macro-cues" defaultSize={220} minSize={160}>
              <LumaCastPanel.Group className="h-full min-h-0">
                <LumaCastPanel.GroupTitle className="border-t">
                  <Label.xs className="mr-auto">Layers</Label.xs>
                </LumaCastPanel.GroupTitle>
                <LumaCastPanel.Content className="overflow-y-auto p-2">
                  <MacroEditorLayersPanel />
                </LumaCastPanel.Content>
              </LumaCastPanel.Group>
            </SplitPanel.Segment>
          </SplitPanel.Panel>
        </LumaCastPanel.Root>
      </SplitPanel.Segment>
      <SplitPanel.Segment id="editor-center" defaultSize={840} minSize={360}>
        <MacroEditorCanvasPanel />
      </SplitPanel.Segment>
      <SplitPanel.Segment id="editor-right" defaultSize={320} minSize={140} collapsible>
        <MacroEditorInspectorPanel />
      </SplitPanel.Segment>
    </SplitPanel.Panel>
  );
}

interface MacroListItemProps {
  macro: Macro;
  index: number;
  isActive: boolean;
  onSelect: (id: Macro['id']) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function MacroListItem(props: MacroListItemProps) {
  return (
    <ContextMenu.Root>
      <MacroListItemBody {...props} />
    </ContextMenu.Root>
  );
}

function MacroListItemBody({ macro, index, isActive, onSelect, onDuplicate, onDelete }: MacroListItemProps) {
  const activeRef = useScrollAreaActiveItem<HTMLDivElement>(isActive);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger();
  const cueCountLabel = `${macro.cues.length} ${macro.cues.length === 1 ? 'cue' : 'cues'}`;

  return (
    <>
      <Thumbnail.Tile
        {...triggerHandlers}
        ref={(node) => {
          activeRef.current = node;
          triggerRef(node);
        }}
        onClick={() => onSelect(macro.id)}
        selected={isActive}
      >
        <Thumbnail.Body>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-tertiary text-secondary">
            <Workflow className="size-6" strokeWidth={1.5} />
            <span className="text-xs text-tertiary">{cueCountLabel}</span>
          </div>
        </Thumbnail.Body>
        <Thumbnail.Caption>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-sm font-semibold tabular-nums text-secondary">{index + 1}</span>
            <span className="min-w-0 truncate text-sm text-tertiary">{macro.name}</span>
          </div>
        </Thumbnail.Caption>
      </Thumbnail.Tile>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item onSelect={onDuplicate}>Duplicate</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={onDelete}>Delete</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}

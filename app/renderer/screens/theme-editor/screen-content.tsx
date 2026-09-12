import { Plus } from 'lucide-react';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { Dropdown } from '../../components/form/dropdown';
import { StagePanel } from '../../features/canvas/stage-panel';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { Label } from '@renderer/components/display/text';
import { ScrollArea } from '@renderer/components/layout/scroll-area';
import { ThemeEditorInspectorPanel } from './inspector-panel';
import { ThemeEditorLayersPanel } from './layers-panel';
import { useThemeEditorScreen } from './screen-context';
import { ThemeFamilySection } from './theme-family-section';
import { THEME_SECTIONS, singular } from './theme-sections';

export function ThemeEditorScreenContent() {
  const { actions, state } = useThemeEditorScreen();
  const allEmpty = THEME_SECTIONS.every(({ type }) => state.themesByType[type].length === 0);

  return (
    <SplitPanel.Panel splitId="editor-main" orientation="horizontal" className="h-full" data-ui-region="editor-layout">
      <SplitPanel.Segment id="editor-left" defaultSize={280} minSize={140} collapsible>
        <LumaCastPanel.Root className="h-full border-r border-secondary">
          <SplitPanel.Panel splitId="theme-list-panel" orientation="vertical" className="h-full">
            <SplitPanel.Segment id="theme-list" defaultSize={440} minSize={180}>
              <LumaCastPanel.Group className="h-full min-h-0">
                <LumaCastPanel.GroupTitle>
                  <Label.sm className="mr-auto">Themes</Label.sm>
                  <Dropdown>
                    <Dropdown.Trigger
                      aria-label="Add"
                      className="cursor-pointer rounded-sm bg-tertiary p-1 text-primary transition-colors hover:text-primary [&>svg]:size-4"
                    >
                      <Plus />
                    </Dropdown.Trigger>
                    <Dropdown.Panel placement="bottom-end">
                      {THEME_SECTIONS.map(({ type, label }) => (
                        <Dropdown.Item key={type} onClick={() => actions.createTheme(type)}>
                          New {singular(label)} theme
                        </Dropdown.Item>
                      ))}
                    </Dropdown.Panel>
                  </Dropdown>
                </LumaCastPanel.GroupTitle>
                <LumaCastPanel.Content>
                  <ScrollArea.Root scrollPadding={8}>
                    <ScrollArea.Viewport className="p-2">
                      <div className="flex flex-col gap-4">
                        {allEmpty ? (
                          <p className="px-1 text-xs text-tertiary">No themes yet.</p>
                        ) : null}
                        {THEME_SECTIONS.map(({ type, label }) => (
                          <ThemeFamilySection key={type} themeType={type} label={label} />
                        ))}
                      </div>
                    </ScrollArea.Viewport>
                    <ScrollArea.Scrollbar>
                      <ScrollArea.Thumb />
                    </ScrollArea.Scrollbar>
                  </ScrollArea.Root>
                </LumaCastPanel.Content>
              </LumaCastPanel.Group>
            </SplitPanel.Segment>
            <SplitPanel.Segment id="theme-objects" defaultSize={220} minSize={160}>
              <LumaCastPanel.Group className="h-full min-h-0">
                <LumaCastPanel.GroupTitle className="border-t">
                  <Label.xs className="mr-auto">Layers</Label.xs>
                </LumaCastPanel.GroupTitle>
                <LumaCastPanel.Content className="overflow-y-auto p-2">
                  <ThemeEditorLayersPanel />
                </LumaCastPanel.Content>
              </LumaCastPanel.Group>
            </SplitPanel.Segment>
          </SplitPanel.Panel>
        </LumaCastPanel.Root>
      </SplitPanel.Segment>
      <SplitPanel.Segment id="editor-center" defaultSize={840} minSize={360}>
        <StagePanel />
      </SplitPanel.Segment>
      <SplitPanel.Segment id="editor-right" defaultSize={320} minSize={140} collapsible>
        <ThemeEditorInspectorPanel />
      </SplitPanel.Segment>
    </SplitPanel.Panel>
  );
}

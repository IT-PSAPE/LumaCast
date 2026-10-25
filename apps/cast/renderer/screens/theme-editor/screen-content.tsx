import { Plus } from 'lucide-react';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { StagePanel } from '../../features/canvas/stage-panel';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { DropdownMenu, Panel } from '@lumacast/ui';
import { ScrollArea } from '@renderer/components/layout/scroll-area';
import { ThemeEditorInspectorPanel } from './inspector-panel';
import { ThemeEditorLayersPanel } from './layers-panel';
import { useThemeEditorScreen } from './screen-context';
import { ThemeFamilySection } from './theme-family-section';

export function ThemeEditorScreenContent() {
  const { actions, state } = useThemeEditorScreen();
  const allEmpty = state.themesByType.presentation.length === 0 && state.themesByType.lyric.length === 0;

  return (
    <SplitPanel.Panel splitId="editor-main" orientation="horizontal" className="h-full" data-ui-region="editor-layout">
      <SplitPanel.Segment id="editor-left" defaultSize={280} minSize={140} collapsible>
        <LumaCastPanel.Root className="h-full border-r border-secondary">
          <SplitPanel.Panel splitId="theme-list-panel" orientation="vertical" className="h-full">
            <SplitPanel.Segment id="theme-list" defaultSize={440} minSize={180}>
              <Panel className="min-h-0">
                <Panel.Header>
                  <Panel.HeaderTitle>Themes</Panel.HeaderTitle>
                  <Panel.HeaderActions>
                    <DropdownMenu
                      align="end"
                      trigger={(
                        <button type="button" aria-label="Add" className="cursor-pointer rounded-sm bg-tertiary p-1 text-primary transition-colors hover:text-primary [&>svg]:size-4">
                          <Plus />
                        </button>
                      )}
                      entries={[
                        { id: 'new-lyric-theme', label: 'New lyric theme', onSelect: () => actions.createTheme('lyric') },
                        { id: 'new-presentation-theme', label: 'New presentation theme', onSelect: () => actions.createTheme('presentation') },
                      ]}
                    />
                  </Panel.HeaderActions>
                </Panel.Header>
                <Panel.Body className="flex flex-col items-start scrollbar-hidden">
                  <ScrollArea.Root scrollPadding={8}>
                    <ScrollArea.Viewport className="p-2">
                      <div className="flex flex-col gap-4">
                        {allEmpty ? (
                          <p className="px-1 text-xs text-tertiary">No themes yet.</p>
                        ) : null}
                        <ThemeFamilySection themeType="lyric" />
                        <ThemeFamilySection themeType="presentation" />
                      </div>
                    </ScrollArea.Viewport>
                    <ScrollArea.Scrollbar>
                      <ScrollArea.Thumb />
                    </ScrollArea.Scrollbar>
                  </ScrollArea.Root>
                </Panel.Body>
              </Panel>
            </SplitPanel.Segment>
            <SplitPanel.Segment id="theme-objects" defaultSize={220} minSize={160}>
              <Panel className="min-h-0">
                <Panel.Header className="border-t">
                  <Panel.HeaderTitle>Layers</Panel.HeaderTitle>
                </Panel.Header>
                <Panel.Body padded className="scrollbar-hidden">
                  <ThemeEditorLayersPanel />
                </Panel.Body>
              </Panel>
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

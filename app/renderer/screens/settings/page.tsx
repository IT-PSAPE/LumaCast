import { LumaCastPanel } from '@renderer/components/layout/panel';
import { SelectableRow } from '../../components/display/selectable-row';
import { AppearanceSettingsPanel } from './appearance-settings-panel';
import { MediaLibrarySettingsPanel } from './media-library-settings-panel';
import { AgentSettingsPanel } from './agent-settings-panel';
import { ObservabilityPanel } from '../../features/observability/observability-panel';
import { OutputSettingsPanel } from '../../features/playback/output-settings-panel';
import { OverlaySettingsPanel } from '../../features/assets/overlays/overlay-settings-panel';
import { ImportExportPanel } from '../../features/items/import-export-panel';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { useWorkbench } from '@renderer/contexts/workbench-context';

export function SettingsScreen() {
  const { state: { settingsTab }, actions: { setSettingsTab } } = useWorkbench();

  return (
    <section data-ui-region="settings-layout" className="h-full min-h-0 overflow-hidden">
      <SplitPanel.Panel splitId="settings-main" orientation="horizontal" className="h-full">
        <SplitPanel.Segment id="settings-left" defaultSize={240} minSize={180}>
          <LumaCastPanel.Root className="h-full border-r border-secondary bg-primary/35">
            <LumaCastPanel.Content className="p-3">
              <div className="flex w-full flex-col gap-1">
                <SelectableRow.Root selected={settingsTab === 'appearance'} onClick={() => setSettingsTab('appearance')}>
                  <SelectableRow.Label>Appearance</SelectableRow.Label>
                </SelectableRow.Root>
                <SelectableRow.Root selected={settingsTab === 'output'} onClick={() => setSettingsTab('output')}>
                  <SelectableRow.Label>Output</SelectableRow.Label>
                </SelectableRow.Root>
                <SelectableRow.Root selected={settingsTab === 'overlays'} onClick={() => setSettingsTab('overlays')}>
                  <SelectableRow.Label>Overlays</SelectableRow.Label>
                </SelectableRow.Root>
                <SelectableRow.Root selected={settingsTab === 'media'} onClick={() => setSettingsTab('media')}>
                  <SelectableRow.Label>Media</SelectableRow.Label>
                </SelectableRow.Root>
                <SelectableRow.Root selected={settingsTab === 'assistant'} onClick={() => setSettingsTab('assistant')}>
                  <SelectableRow.Label>Assistant</SelectableRow.Label>
                </SelectableRow.Root>
                <SelectableRow.Root selected={settingsTab === 'observability'} onClick={() => setSettingsTab('observability')}>
                  <SelectableRow.Label>Observability</SelectableRow.Label>
                </SelectableRow.Root>
                <SelectableRow.Root selected={settingsTab === 'transfer'} onClick={() => setSettingsTab('transfer')}>
                  <SelectableRow.Label>Import &amp; Export</SelectableRow.Label>
                </SelectableRow.Root>
              </div>
            </LumaCastPanel.Content>
          </LumaCastPanel.Root>
        </SplitPanel.Segment>

        <SplitPanel.Segment id="settings-right" defaultSize={960} minSize={320}>
          <main className="h-full min-h-0 overflow-auto px-6 py-5">
            <div className="mx-auto flex max-w-5xl flex-col gap-6">
              <header className="border-b border-primary pb-4">
                <h1 className="text-lg font-semibold text-primary">Settings</h1>
              </header>
              {settingsTab === 'appearance' && <AppearanceSettingsPanel />}
              {settingsTab === 'output' && <OutputSettingsPanel />}
              {settingsTab === 'overlays' && <OverlaySettingsPanel />}
              {settingsTab === 'media' && <MediaLibrarySettingsPanel />}
              {settingsTab === 'assistant' && <AgentSettingsPanel />}
              {settingsTab === 'observability' && <ObservabilityPanel />}
              {settingsTab === 'transfer' && <ImportExportPanel />}
            </div>
          </main>
        </SplitPanel.Segment>
      </SplitPanel.Panel>
    </section>
  );
}

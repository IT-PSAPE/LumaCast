// The right-hand inspector panel: a `Cue`/`Theme` tab switch over the two
// editors. Kept to routing + the tab switch itself; each tab's fields live
// in its own file (`cue-tab.tsx`/`theme-tab.tsx`).
import { Tabs } from '@lumacast/ui';
import { useChordStore } from '../../store';
import { CueTab } from './cue-tab';
import { ThemeTab } from './theme-tab';

export function Inspector() {
  const inspectorTab = useChordStore((s) => s.inspectorTab);
  const setInspectorTab = useChordStore((s) => s.setInspectorTab);

  return (
    <Tabs
      value={inspectorTab}
      onValueChange={(value) => setInspectorTab(value as 'cue' | 'theme')}
      variant="underline"
      className="h-full bg-secondary"
    >
      <Tabs.List className="shrink-0 px-2">
        <Tabs.Tab value="cue" className="flex-1">Cue</Tabs.Tab>
        <Tabs.Tab value="theme" className="flex-1">Theme</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="cue" className="flex flex-col">
        <CueTab />
      </Tabs.Panel>
      <Tabs.Panel value="theme" className="flex flex-col">
        <ThemeTab />
      </Tabs.Panel>
    </Tabs>
  );
}

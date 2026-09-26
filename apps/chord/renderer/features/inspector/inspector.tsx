// The right-hand inspector panel: a `Cue`/`Theme` tab switch over the two
// editors. Kept to routing + the tab switch itself; each tab's fields live
// in its own file (`cue-tab.tsx`/`theme-tab.tsx`).
import { SegmentedControl } from '@lumacast/ui';
import { useChordStore } from '../../store';
import { CueTab } from './cue-tab';
import { ThemeTab } from './theme-tab';

export function Inspector() {
  const inspectorTab = useChordStore((s) => s.inspectorTab);
  const setInspectorTab = useChordStore((s) => s.setInspectorTab);

  return (
    <div className="flex h-full flex-col bg-secondary">
      <div className="border-b border-primary p-2">
        <SegmentedControl
          aria-label="Inspector tab"
          fill
          value={inspectorTab}
          onValueChange={(value) => setInspectorTab(value as 'cue' | 'theme')}
        >
          <SegmentedControl.Label fill value="cue">Cue</SegmentedControl.Label>
          <SegmentedControl.Label fill value="theme">Theme</SegmentedControl.Label>
        </SegmentedControl>
      </div>
      {inspectorTab === 'cue' ? <CueTab /> : <ThemeTab />}
    </div>
  );
}

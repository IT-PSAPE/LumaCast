import { Grid2x2, List } from 'lucide-react';
import { InspectorSlider } from '../form/inspector-slider';
import { Dropdown } from '../form/dropdown';
import { useBinControls } from './bin-controls-context';

export function BinControlsViewOptions() {
  const { state, actions } = useBinControls();
  const grid = state.viewMode === 'grid' ? state.grid : null;

  // No leading separator: the host decides whether one is needed, since this
  // fragment is the whole menu in the program panel and an appended section in
  // the resource drawer.
  return (
    <>
      <Dropdown.Item onClick={() => actions.onViewModeChange('grid')}>
        <Grid2x2 size={14} strokeWidth={1.5} /> Grid
      </Dropdown.Item>
      <Dropdown.Item onClick={() => actions.onViewModeChange('list')}>
        <List size={14} strokeWidth={1.5} /> List
      </Dropdown.Item>
      {grid && (
        <>
          <Dropdown.Separator />
          <div className="px-1 py-1.5">
            <InspectorSlider
              value={grid.value}
              min={grid.min}
              max={grid.max}
              step={grid.step}
              onChange={grid.onChange}
              label="Size"
              ariaLabel="Grid size"
            />
          </div>
        </>
      )}
    </>
  );
}

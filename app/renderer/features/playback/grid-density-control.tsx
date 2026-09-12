import { useWorkbench } from '../../contexts/workbench-context';
import { InspectorSlider } from '../../components/form/inspector-slider';

// Grid density control shown in the program header when in all-views mode.
// The slider value IS the column count (1 = stacked, 2 = two columns).
export function GridDensityControl() {
  const {
    state: { programGridDensity },
    actions: { setProgramGridDensity },
  } = useWorkbench();

  function handleDensityChange(next: number) {
    if (next !== 1 && next !== 2) return;
    setProgramGridDensity(next);
  }

  return (
    <span className="ml-auto w-32 shrink-0">
      <InspectorSlider
        value={programGridDensity}
        min={1}
        max={2}
        onChange={handleDensityChange}
        label="Columns"
        ariaLabel="Grid columns"
      />
    </span>
  );
}

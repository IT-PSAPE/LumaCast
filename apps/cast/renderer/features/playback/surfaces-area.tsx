import { useWorkbench } from '../../contexts/workbench-context';
import { ThumbnailGrid } from '../../components/layout/thumbnail-grid';
import { SURFACE_LABELS, SURFACE_ORDER } from './surface-constants';
import { Surface } from './surface';

export function SurfacesArea() {
  const {
    state: { programMode, programSingleSurface, programGridDensity },
  } = useWorkbench();

  if (programMode === 'single') {
    // Single mode names the surface in the header dropdown, so the cell
    // composes no label badge.
    return (
      <div className="flex w-full justify-center">
        <Surface kind={programSingleSurface} />
      </div>
    );
  }

  // All-mode grid: slider value IS the column count. 1 = stacked vertically,
  // 2 = two columns. Each cell is a 16:9 frame so rows auto-size to identical
  // heights regardless of which surface (Program/Monitor/Stage) lands in them.
  const columnCount = programGridDensity;
  return (
    <ThumbnailGrid columns={columnCount} className="w-full gap-1">
      {SURFACE_ORDER.map((kind) => (
        <Surface key={kind} kind={kind} label={SURFACE_LABELS[kind]} />
      ))}
    </ThumbnailGrid>
  );
}

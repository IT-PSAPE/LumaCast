// The bottom status strip. Start: whether the app is idle, exporting, or
// tap-marking. Center: the export outcome (announced). End: the project's
// size at a glance (cue count, selection, timeline length). The title, dirty
// dot, composition and playhead already live in the top bar and transport,
// so they are deliberately not repeated here.
import { StatusBar, StatusDot } from '@lumacast/ui';
import { formatClock, timelineEndMs } from '../playback';
import { useChordStore } from '../../store';

export function ShellStatusBar() {
  const exportJob = useChordStore((s) => s.exportJob);
  const tapIndex = useChordStore((s) => s.tapIndex);
  const project = useChordStore((s) => s.document.project);
  const selectionCount = useChordStore((s) => s.selection.length);

  const exporting = exportJob.status === 'preparing' || exportJob.status === 'rendering' || exportJob.status === 'finalizing';
  const hasContent = project.cues.length > 0 || project.audio !== null;

  return (
    <StatusBar label="LumaChord status">
      <StatusBar.Start>
        {exporting ? (
          <StatusBar.Item busy tone="warning">
            {exportJob.status === 'finalizing' ? 'Finalizing export…' : `Exporting ${Math.round(exportJob.percent)}%`}
          </StatusBar.Item>
        ) : (
          <StatusBar.Item icon={<StatusDot tone="success" />}>Ready</StatusBar.Item>
        )}
        {tapIndex !== null && <StatusBar.Item tone="brand">Tap to mark: cue {tapIndex + 1}</StatusBar.Item>}
      </StatusBar.Start>
      <StatusBar.Center>
        {exportJob.status === 'failed' && (
          <StatusBar.Item live tone="error" className="truncate">{exportJob.error ?? 'Export failed'}</StatusBar.Item>
        )}
        {exportJob.status === 'done' && (
          <StatusBar.Item live tone="success">Export complete</StatusBar.Item>
        )}
      </StatusBar.Center>
      <StatusBar.End>
        {hasContent && (
          <>
            {selectionCount > 0 && (
              <>
                <StatusBar.Item>{selectionCount} selected</StatusBar.Item>
                <StatusBar.Divider />
              </>
            )}
            <StatusBar.Item>Length {formatClock(timelineEndMs(project))}</StatusBar.Item>
          </>
        )}
      </StatusBar.End>
    </StatusBar>
  );
}

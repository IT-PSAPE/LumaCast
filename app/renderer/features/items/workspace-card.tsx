import { pluralize } from './import-export-shared';
import { ReacstButton } from '@renderer/components/controls/button';

export function WorkspaceCard({
  itemCount,
  playlistCount,
  onExport,
  disabled,
  inFlight,
}: {
  itemCount: number;
  playlistCount: number;
  onExport: () => void;
  disabled: boolean;
  inFlight: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded border border-primary bg-tertiary/25 p-3">
      <div className="flex flex-col gap-0.5">
        <div className="text-sm font-medium text-primary">Export entire workspace</div>
        <div className="text-xs text-tertiary">
          {pluralize(itemCount, 'item', 'items')}
          {playlistCount > 0 && <> · {pluralize(playlistCount, 'playlist', 'playlists')}</>}
          {' · includes themes, overlays, page layouts, and referenced media.'}
        </div>
      </div>
      <ReacstButton onClick={onExport} disabled={disabled}>
        {inFlight ? 'Exporting…' : 'Export workspace'}
      </ReacstButton>
    </div>
  );
}

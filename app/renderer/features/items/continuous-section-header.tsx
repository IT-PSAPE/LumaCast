import { Label } from '@renderer/components/display/text';
import type { PlaylistDeckSequenceItem } from './use-playlist-deck-sequence';

export function ContinuousSectionHeader({ item, isCurrent, isLive = false }: { item: PlaylistDeckSequenceItem; isCurrent: boolean; isLive?: boolean }) {
  return (
    <div className="sticky top-0 z-10 flex h-9 w-full items-center gap-2 bg-tertiary px-2 py-1">
      <div className="flex min-w-0 items-center gap-2">
        <Label.xs className="mr-auto truncate font-medium text-primary">{item.item.title}</Label.xs>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {isCurrent ? <span className="rounded-sm bg-brand_solid/20 px-1.5 py-0.5 text-[10px] font-medium uppercase text-brand_solid">Current</span> : null}
          {isLive ? <span className="rounded-sm bg-error_primary/20 px-1.5 py-0.5 text-[10px] font-medium uppercase text-error">Live</span> : null}
        </div>
      </div>
    </div>
  );
}

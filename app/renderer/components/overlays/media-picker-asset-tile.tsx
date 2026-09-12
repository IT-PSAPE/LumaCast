import type { Id } from '@lumacast/kernel';
import type { MediaAsset } from '@lumacast/composition';
import { Toggle } from '@base-ui/react/toggle';
import { cn } from '@renderer/utils/cn';
import { MediaAssetIcon } from '../display/entity-icon';
import { MediaThumbnail } from './media-thumbnail';

export function MediaPickerAssetTile({
  asset,
  isSelected,
  onToggle,
}: {
  asset: MediaAsset;
  isSelected: boolean;
  onToggle: (id: Id) => void;
}) {
  // A Toggle rather than a plain button: selecting a tile is a two-state
  // choice, and Base UI reports it as `aria-pressed` for screen readers.
  return (
    <Toggle
      pressed={isSelected}
      onPressedChange={() => onToggle(asset.id)}
      className={cn(
        'group cursor-pointer rounded border bg-primary p-0 text-left transition-colors',
        'border-primary data-[pressed]:border-brand data-[pressed]:ring-1 data-[pressed]:ring-brand',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
      )}
    >
      <div
        className="grid place-items-center overflow-hidden rounded-t bg-primary"
        style={{ aspectRatio: String(asset.type === 'audio' ? 1 : (asset.width && asset.height ? asset.width / asset.height : 1)) }}
      >
        <MediaThumbnail asset={asset} />
      </div>
      <p className="m-0 flex items-center gap-1.5 truncate px-1.5 py-1 text-sm text-secondary group-hover:text-primary">
        <MediaAssetIcon asset={asset} size={12} strokeWidth={1.75} className="shrink-0 text-tertiary" />
        <span className="truncate">{asset.name}</span>
      </p>
    </Toggle>
  );
}

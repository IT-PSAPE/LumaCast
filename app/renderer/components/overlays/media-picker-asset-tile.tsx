import type { Id } from '@lumacast/kernel';
import type { MediaAsset } from '@lumacast/composition';
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
  function handleClick() {
    onToggle(asset.id);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'group cursor-pointer rounded border bg-primary p-0 text-left transition-colors',
        isSelected ? 'border-brand ring-1 ring-brand-400' : 'border-primary',
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
    </button>
  );
}

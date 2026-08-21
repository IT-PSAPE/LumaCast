import { useEffect, useMemo, useState } from 'react';
import type { Id } from '@lumacast/kernel';
import type { MediaAsset } from '@lumacast/composition';
import { ScrollArea } from '@renderer/components/layout/scroll-area';
import { ReacstButton } from '@renderer/components/controls/button';
import { Dialog } from './dialog';
import { type MediaPickerAssetKind } from './media-picker-types';
import { MediaPickerAssetTile } from './media-picker-asset-tile';
import { UploadMediaDialog } from './upload-media-dialog';

export type { MediaPickerAssetKind } from './media-picker-types';

interface MediaPickerDialogProps {
  assets: MediaAsset[];
  kind: MediaPickerAssetKind;
  onConfirm: (selected: MediaAsset[]) => void;
  onClose: () => void;
  onImportAssets: (files: FileList) => Promise<void>;
}

const EMPTY_LABELS: Record<MediaPickerAssetKind, string> = {
  image: 'No images in the project yet. Upload or import images to add an image element.',
  video: 'No videos in the project yet. Upload or import videos to add a video element.',
};

function isAssetAllowed(kind: MediaPickerAssetKind, asset: MediaAsset): boolean {
  if (kind === 'image') return asset.type === 'image';
  return asset.type === 'video';
}

export function MediaPickerDialog({ assets, kind, onConfirm, onClose, onImportAssets }: MediaPickerDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<Id>>(new Set());
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [preUploadAssetIds, setPreUploadAssetIds] = useState<Set<Id> | null>(null);

  const filteredAssets = useMemo(
    () => assets.filter((asset) => isAssetAllowed(kind, asset)),
    [assets, kind],
  );

  useEffect(() => {
    setSelectedIds(new Set());
  }, [kind]);

  useEffect(() => {
    if (!preUploadAssetIds) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const asset of filteredAssets) {
        if (preUploadAssetIds.has(asset.id)) continue;
        next.add(asset.id);
      }
      return next;
    });
    setPreUploadAssetIds(null);
  }, [filteredAssets, preUploadAssetIds]);

  function toggleAsset(id: Id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleConfirm() {
    const selected = filteredAssets.filter((asset) => selectedIds.has(asset.id));
    if (selected.length > 0) onConfirm(selected);
  }

  // Newly uploaded assets are identified by *id*, not by source string (issue
  // #159): a media source that reaches the renderer is an opaque managed media
  // id minted by main, so it can no longer be predicted here from the selected
  // file's path. Record what the bin held before the upload; whatever is new
  // once the import resolves is what the upload produced.
  async function handleImport(files: FileList) {
    const knownAssetIds = new Set(filteredAssets.map((asset) => asset.id));
    await onImportAssets(files);
    setPreUploadAssetIds(knownAssetIds);
    setShowUploadDialog(false);
  }

  return (
    <>
      <Dialog.Root open onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content data-ui-region="media-picker-dialog" className="max-h-[min(560px,calc(100vh-6rem))] max-w-[560px] overflow-hidden">
              <Dialog.Header>
                <Dialog.Title>{kind === 'image' ? 'Add Image Element' : 'Add Video Element'}</Dialog.Title>
                <Dialog.CloseButton />
              </Dialog.Header>
              {/* A single grid track gives the scroll area a definite height; a flex/block body
                  sized by the dialog's max-height leaves `size-full` nothing to resolve against. */}
              <Dialog.Body className="grid grid-rows-[minmax(0,1fr)] overflow-hidden">
                <ScrollArea.Root scrollPadding={16}>
                  <ScrollArea.Viewport className="p-4">
                    {filteredAssets.length === 0 ? (
                      <p className="m-0 text-center text-sm text-tertiary">
                        {EMPTY_LABELS[kind]}
                      </p>
                    ) : (
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(108px,1fr))] gap-3">
                        {filteredAssets.map((asset) => (
                          <MediaPickerAssetTile
                            key={asset.id}
                            asset={asset}
                            isSelected={selectedIds.has(asset.id)}
                            onToggle={toggleAsset}
                          />
                        ))}
                      </div>
                    )}
                  </ScrollArea.Viewport>
                  <ScrollArea.Scrollbar>
                    <ScrollArea.Thumb />
                  </ScrollArea.Scrollbar>
                </ScrollArea.Root>
              </Dialog.Body>
              <Dialog.Footer>
                <span className="text-sm text-tertiary">
                  {selectedIds.size > 0 ? `${selectedIds.size} selected` : `Select ${kind === 'image' ? 'images' : 'videos'} to add`}
                </span>
                <div className="flex gap-2">
                  <ReacstButton variant="ghost" onClick={() => setShowUploadDialog(true)}>
                    Upload
                  </ReacstButton>
                  <ReacstButton variant="ghost" onClick={onClose}>Cancel</ReacstButton>
                  <ReacstButton onClick={handleConfirm} disabled={selectedIds.size === 0}>
                    Add{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                  </ReacstButton>
                </div>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Dialog.Portal>
      </Dialog.Root>
      {showUploadDialog ? (
        <UploadMediaDialog
          kind={kind}
          onClose={() => setShowUploadDialog(false)}
          onImport={handleImport}
        />
      ) : null}
    </>
  );
}

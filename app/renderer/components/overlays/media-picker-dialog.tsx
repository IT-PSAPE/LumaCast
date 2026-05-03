import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import type { Id, MediaAsset } from '@core/types';
import { Film, Image as ImageIcon, Upload } from 'lucide-react';
import { cn } from '@renderer/utils/cn';
import { ReacstButton } from '@renderer/components/controls/button';
import { FileTrigger } from '../form/file-trigger';
import { castMediaSrc, typeFromFile } from '../../utils/slides';
import { Dialog } from './dialog';
import { MediaAssetIcon } from '../display/entity-icon';

export type MediaPickerAssetKind = 'image' | 'video';

interface MediaPickerDialogProps {
  assets: MediaAsset[];
  kind: MediaPickerAssetKind;
  onConfirm: (selected: MediaAsset[]) => void;
  onClose: () => void;
  onImportAssets: (files: FileList) => Promise<void>;
}

const ACCEPT_BY_KIND: Record<MediaPickerAssetKind, string> = {
  image: 'image/*',
  video: 'video/*',
};

const EMPTY_LABELS: Record<MediaPickerAssetKind, string> = {
  image: 'No images in the project yet. Upload or import images to add an image element.',
  video: 'No videos in the project yet. Upload or import videos to add a video element.',
};

function isAssetAllowed(kind: MediaPickerAssetKind, asset: MediaAsset): boolean {
  if (kind === 'image') return asset.type === 'image';
  return asset.type === 'video';
}

function buildAcceptedFileList(files: Iterable<File>, kind: MediaPickerAssetKind): FileList | null {
  const accepted = Array.from(files).filter((file) => {
    const type = typeFromFile(file);
    return kind === 'image' ? type === 'image' : type === 'video';
  });
  if (accepted.length === 0 || typeof DataTransfer === 'undefined') return null;
  const transfer = new DataTransfer();
  for (const file of accepted) {
    transfer.items.add(file);
  }
  return transfer.files;
}

function expectedAssetSources(files: Iterable<File>, kind: MediaPickerAssetKind): Set<string> {
  const sources = new Set<string>();
  for (const file of files) {
    const type = typeFromFile(file);
    if (kind === 'image' && type !== 'image') continue;
    if (kind === 'video' && type !== 'video') continue;
    const filePath = window.castApi.getPathForFile(file);
    if (!filePath) continue;
    sources.add(castMediaSrc(filePath));
  }
  return sources;
}

function MediaThumbnail({ asset }: { asset: MediaAsset }) {
  if (asset.type === 'image') {
    return <img src={asset.src} alt={asset.name} loading="lazy" draggable={false} className="block h-full w-full object-cover" />;
  }
  if (asset.type === 'video') {
    return <video src={asset.src} muted playsInline preload="metadata" className="block h-full w-full object-cover" />;
  }
  return <span className="text-sm font-bold uppercase tracking-wider text-tertiary">{asset.type}</span>;
}

export function MediaPickerDialog({ assets, kind, onConfirm, onClose, onImportAssets }: MediaPickerDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<Id>>(new Set());
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [pendingUploadedSources, setPendingUploadedSources] = useState<Set<string> | null>(null);

  const filteredAssets = useMemo(
    () => assets.filter((asset) => isAssetAllowed(kind, asset)),
    [assets, kind],
  );

  useEffect(() => {
    setSelectedIds(new Set());
  }, [kind]);

  useEffect(() => {
    if (!pendingUploadedSources || pendingUploadedSources.size === 0) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const asset of filteredAssets) {
        if (!pendingUploadedSources.has(asset.src)) continue;
        next.add(asset.id);
      }
      return next;
    });
    setPendingUploadedSources(null);
  }, [filteredAssets, pendingUploadedSources]);

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

  async function handleImport(files: FileList) {
    const expectedSources = expectedAssetSources(Array.from(files), kind);
    await onImportAssets(files);
    setPendingUploadedSources(expectedSources);
    setShowUploadDialog(false);
  }

  return (
    <>
      <Dialog.Root open onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content data-ui-region="media-picker-dialog" className="max-w-[560px] overflow-hidden">
              <Dialog.Header>
                <Dialog.Title>{kind === 'image' ? 'Add Image Element' : 'Add Video Element'}</Dialog.Title>
                <Dialog.CloseButton />
              </Dialog.Header>
              <Dialog.Body className="overflow-hidden">
                <div className="min-h-0 overflow-auto p-4">
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
                </div>
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

function MediaPickerAssetTile({
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
      <div className="grid aspect-square place-items-center overflow-hidden rounded-t">
        <MediaThumbnail asset={asset} />
      </div>
      <p className="m-0 flex items-center gap-1.5 truncate px-1.5 py-1 text-sm text-secondary group-hover:text-primary">
        <MediaAssetIcon asset={asset} size={12} strokeWidth={1.75} className="shrink-0 text-tertiary" />
        <span className="truncate">{asset.name}</span>
      </p>
    </button>
  );
}

function UploadMediaDialog({
  kind,
  onClose,
  onImport,
}: {
  kind: MediaPickerAssetKind;
  onClose: () => void;
  onImport: (files: FileList) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  async function importAcceptedFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    try {
      await onImport(files);
    } finally {
      setIsUploading(false);
    }
  }

  function handleFileSelect(files: FileList, event: ChangeEvent<HTMLInputElement>) {
    void importAcceptedFiles(buildAcceptedFileList(Array.from(files), kind));
    event.target.value = '';
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsDragOver(false);
    void importAcceptedFiles(buildAcceptedFileList(Array.from(event.dataTransfer.files), kind));
  }

  function handleDragOver(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }

  function handleDragLeave(event: DragEvent<HTMLButtonElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setIsDragOver(false);
  }

  const noun = kind === 'image' ? 'images' : 'videos';
  const Icon = kind === 'image' ? ImageIcon : Film;

  return (
    <Dialog.Root open onOpenChange={(isOpen) => { if (!isOpen && !isUploading) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content className="max-w-[520px]">
            <Dialog.Header>
              <Dialog.Title>Upload {kind === 'image' ? 'Images' : 'Videos'}</Dialog.Title>
              <Dialog.CloseButton disabled={isUploading} />
            </Dialog.Header>
            <Dialog.Body className="p-4">
              <FileTrigger.Root
                hidden
                inputRef={inputRef}
                accept={ACCEPT_BY_KIND[kind]}
                multiple
                onSelect={handleFileSelect}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                disabled={isUploading}
                className={cn(
                  'flex h-64 w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 text-center transition-colors',
                  isDragOver ? 'border-brand bg-brand/10' : 'border-secondary bg-secondary/30 hover:bg-secondary/50',
                  isUploading ? 'cursor-progress opacity-70' : 'cursor-pointer',
                )}
              >
                <div className="rounded-full bg-tertiary/80 p-3 text-tertiary">
                  {isUploading ? <Upload className="size-5 animate-pulse" /> : <Icon className="size-5" />}
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium text-primary">
                    {isUploading ? `Importing ${noun}…` : `Drop ${noun} here or click to browse`}
                  </div>
                  <div className="text-xs text-tertiary">
                    {kind === 'image' ? 'PNG, JPG, GIF, WEBP and other image formats' : 'MP4, MOV, WEBM, M4V and other video formats'}
                  </div>
                </div>
              </button>
            </Dialog.Body>
            <Dialog.Footer>
              <span className="text-sm text-tertiary">
                Imported assets will appear in this picker automatically.
              </span>
              <div className="flex gap-2">
                <ReacstButton variant="ghost" onClick={onClose} disabled={isUploading}>
                  Close
                </ReacstButton>
              </div>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

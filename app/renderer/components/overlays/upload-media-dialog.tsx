import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { Film, Image as ImageIcon, Upload } from 'lucide-react';
import { cn } from '@renderer/utils/cn';
import { ReacstButton } from '@renderer/components/controls/button';
import { FileTrigger } from '../form/file-trigger';
import { typeFromFile } from '../../utils/slides';
import { Dialog } from './dialog';
import { type MediaPickerAssetKind } from './media-picker-types';

const ACCEPT_BY_KIND: Record<MediaPickerAssetKind, string> = {
  image: 'image/*',
  video: 'video/*',
};

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

export function UploadMediaDialog({
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

import { useState } from 'react';
import type { Id, MediaAsset } from '@core/types';
import { cn } from '@renderer/utils/cn';
import { AlertTriangle } from 'lucide-react';
import { ContextMenu, useContextMenuTrigger } from '../../../components/overlays/context-menu';
import { useConfirm } from '../../../components/overlays/confirm-dialog';
import { MediaAssetIcon } from '../../../components/display/entity-icon';
import { SelectableRow } from '../../../components/display/selectable-row';
import { Thumbnail } from '../../../components/display/thumbnail';
import { Paragraph } from '@renderer/components/display/text';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { useElements } from '../../../contexts/canvas/canvas-context';
import { useCast } from '../../../contexts/app-context';
import { usePresentationMediaLayer, useVideo } from '../../../contexts/playback/playback-context';
import { useWorkbench } from '../../../contexts/workbench-context';
import { useGridSize } from '../../../hooks/use-grid-size';
import { BinShell } from '../../workbench/bin-shell';
import type { BinCollectionsApi } from '../../workbench/use-bin-collections';
import { useMediaTypeBin, type MediaBinKind } from './use-media-type-bin';

interface MediaBinPanelProps {
  binKind: MediaBinKind;
}

export function MediaBinPanel({ binKind }: MediaBinPanelProps) {
  const { mediaAssets, collections, searchValue, setSearchValue, viewMode, setViewMode, moveAssetToCollection } =
    useMediaTypeBin(binKind);
  const { mediaLayerAssetId, videoLayerAssetId, setMediaLayerAsset } = usePresentationMediaLayer();
  const { armVideo } = useVideo();
  const gridStorageKey = `lumacast.grid-size.${binKind}-bin`;
  const { gridSize, setGridSize, min, max, step } = useGridSize(gridStorageKey, 3, 2, 4);

  return (
    <BinShell
      collections={collections}
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      searchPlaceholder={`Search ${binKind}…`}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      gridSize={gridSize}
      gridSizeMin={min}
      gridSizeMax={max}
      gridSizeStep={step}
      onGridSizeChange={setGridSize}
    >
      <BinPanelLayout gridItemSize={gridSize} mode={viewMode}>
        {mediaAssets.map((asset) => (
          <MediaBinItem
            key={asset.id}
            asset={asset}
            isActive={mediaLayerAssetId === asset.id || videoLayerAssetId === asset.id}
            mode={viewMode}
            onAssignLayer={setMediaLayerAsset}
            onArmVideo={armVideo}
            collectionsApi={collections}
            onMoveToCollection={moveAssetToCollection}
          />
        ))}
      </BinPanelLayout>
    </BinShell>
  );
}

interface MediaItemProps {
  asset: MediaAsset;
  isActive: boolean;
  onAssignLayer: (id: Id) => void;
  onArmVideo: (id: Id) => void;
  collectionsApi: BinCollectionsApi;
  onMoveToCollection: (assetId: Id, collectionId: Id) => Promise<void>;
}

function MediaBinItem({ mode, ...props }: MediaItemProps & { mode: 'grid' | 'list' }) {
  if (mode === 'list') return <MediaRow {...props} />;
  return <MediaTile {...props} />;
}

function useMediaContextActions(asset: MediaAsset) {
  const { deleteMedia } = useElements();
  const { mutatePatch, setStatusText } = useCast();
  const confirm = useConfirm();

  async function handleReplaceSource() {
    const filePath = await window.castApi.chooseImportReplacementMediaPath();
    if (!filePath) return;
    const nextSrc = `cast-media://${encodeURIComponent(filePath)}`;
    await mutatePatch(() => window.castApi.updateMediaAssetSrc(asset.id, nextSrc));
    setStatusText(`Replaced source for ${asset.name}`);
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${asset.name}"?`,
      description: 'Slides and elements that reference this media will lose their source.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await deleteMedia(asset.id);
    setStatusText(`Deleted ${asset.name}`);
  }

  return { handleReplaceSource, handleDelete };
}

function MediaContextMenuItems({
  asset,
  collectionsApi,
  onMoveToCollection,
}: {
  asset: MediaAsset;
  collectionsApi: BinCollectionsApi;
  onMoveToCollection: (assetId: Id, collectionId: Id) => Promise<void>;
}) {
  const { handleReplaceSource, handleDelete } = useMediaContextActions(asset);
  const otherCollections = collectionsApi.collections.filter((c) => c.id !== asset.collectionId);
  return (
    <ContextMenu.Portal>
      <ContextMenu.Menu>
        <ContextMenu.Item onSelect={() => { void handleReplaceSource(); }}>Replace source…</ContextMenu.Item>
        <ContextMenu.Separator />
        {otherCollections.length > 0 ? (
          <ContextMenu.Submenu label="Move to collection">
            {otherCollections.map((collection) => (
              <ContextMenu.Item
                key={collection.id}
                onSelect={() => { void onMoveToCollection(asset.id, collection.id); }}
              >
                {collection.name}
              </ContextMenu.Item>
            ))}
          </ContextMenu.Submenu>
        ) : null}
        <ContextMenu.Separator />
        <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete(); }}>Delete</ContextMenu.Item>
      </ContextMenu.Menu>
    </ContextMenu.Portal>
  );
}

function MediaRow(props: MediaItemProps) {
  return (
    <ContextMenu.Root>
      <MediaRowBody {...props} />
    </ContextMenu.Root>
  );
}

function MediaRowBody({ asset, isActive, onAssignLayer, onArmVideo, collectionsApi, onMoveToCollection }: MediaItemProps) {
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger();
  const {
    state: { programMode, programSingleSurface },
    actions: { setProgramSingleSurface },
  } = useWorkbench();

  function handleAssignLayer() {
    if ((asset.type === 'video') && programMode === 'single' && programSingleSurface !== 'program') {
      setProgramSingleSurface('program');
    }
    if (asset.type === 'video') {
      onArmVideo(asset.id);
      return;
    }
    onAssignLayer(asset.id);
  }

  return (
    <>
      <SelectableRow.Root
        {...triggerHandlers}
        ref={triggerRef}
        selected={isActive}
        onClick={handleAssignLayer}
        className="h-12"
      >
        <SelectableRow.Leading>
          <div className="relative h-10 w-10 overflow-hidden rounded bg-tertiary/40">
            <MediaThumbnail asset={asset} />
          </div>
        </SelectableRow.Leading>
        <div className="flex min-w-0 flex-1 flex-col text-left">
          <span className="truncate text-sm font-medium">{asset.name}</span>
          <span className="truncate text-xs uppercase tracking-wide text-tertiary">{asset.type}</span>
        </div>
      </SelectableRow.Root>
      <MediaContextMenuItems asset={asset} collectionsApi={collectionsApi} onMoveToCollection={onMoveToCollection} />
    </>
  );
}

function MediaTile(props: MediaItemProps) {
  return (
    <ContextMenu.Root>
      <MediaTileBody {...props} />
    </ContextMenu.Root>
  );
}

function MediaTileBody({ asset, isActive, onAssignLayer, onArmVideo, collectionsApi, onMoveToCollection }: MediaItemProps) {
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger();
  const {
    state: { programMode, programSingleSurface },
    actions: { setProgramSingleSurface },
  } = useWorkbench();

  function handleAssignLayer() {
    if ((asset.type === 'video') && programMode === 'single' && programSingleSurface !== 'program') {
      setProgramSingleSurface('program');
    }
    if (asset.type === 'video') {
      onArmVideo(asset.id);
      return;
    }
    onAssignLayer(asset.id);
  }

  return (
    <>
      <div {...triggerHandlers} ref={triggerRef}>
        <Thumbnail.Tile
          onClick={handleAssignLayer}
          selected={isActive}
          className={cn(isActive ? 'ring-1 ring-brand-400/35' : '')}
        >
          <Thumbnail.Body>
            <div className="pointer-events-none absolute inset-0 bg-[repeating-conic-gradient(var(--color-background-tertiary)_0%_25%,var(--color-background-quaternary)_0%_50%)] bg-[length:16px_16px]" />
            <MediaThumbnail asset={asset} />
          </Thumbnail.Body>
          <Thumbnail.Caption>
            <div className="flex min-w-0 items-center gap-1 text-sm text-secondary">
              <MediaAssetIcon asset={asset} size={12} strokeWidth={1.75} className="shrink-0 text-tertiary" />
              <Paragraph.xs className="truncate">{asset.name}</Paragraph.xs>
            </div>
          </Thumbnail.Caption>
        </Thumbnail.Tile>
      </div>
      <MediaContextMenuItems asset={asset} collectionsApi={collectionsApi} onMoveToCollection={onMoveToCollection} />
    </>
  );
}

function MediaThumbnail({ asset }: { asset: MediaAsset }) {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const isBroken = brokenSrc === asset.src;

  if (brokenSrc !== null && brokenSrc !== asset.src) {
    setBrokenSrc(null);
  }

  if (isBroken) {
    return (
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-tertiary/80 text-tertiary">
        <AlertTriangle size={16} strokeWidth={1.75} />
        <span className="px-2 text-center text-xs uppercase tracking-wider">Missing source</span>
      </div>
    );
  }

  if (asset.type === 'image') {
    return (
      <img
        src={asset.src}
        alt={asset.name}
        loading="lazy"
        draggable={false}
        onError={() => setBrokenSrc(asset.src)}
        className="absolute inset-0 h-full w-full object-cover"
      />
    );
  }
  if (asset.type === 'video') {
    return (
      <video
        src={asset.src}
        muted
        playsInline
        preload="metadata"
        onError={() => setBrokenSrc(asset.src)}
        className="absolute inset-0 h-full w-full object-cover"
      />
    );
  }
  return <span className="text-tertiary text-sm font-bold tracking-wider uppercase">{asset.type}</span>;
}

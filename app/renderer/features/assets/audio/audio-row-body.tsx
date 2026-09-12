import { useCallback, useEffect, useRef, useState } from 'react';
import { useBinScrollRoot } from '@renderer/components/layout/bin-shell';
import { useMediaDerivative } from '../../../hooks/use-media-derivative';
import { useElements } from '../../../contexts/canvas/canvas-context';
import { useContextMenuTrigger, ContextMenu } from '../../../components/overlays/context-menu';
import { useConfirm } from '../../../components/overlays/confirm-dialog';
import { MediaAssetIcon } from '../../../components/display/entity-icon';
import { SelectableRow } from '../../../components/display/selectable-row';
import type { AudioRowProps } from './audio-bin-types';

export function AudioRowBody({ asset, isActive, onArm }: AudioRowProps) {
  const [visible, setVisible] = useState(false);
  const rowRef = useRef<HTMLElement | null>(null);
  const scrollRootRef = useBinScrollRoot();
  const { asset: resolvedAsset, displaySrc, status } = useMediaDerivative(asset, visible);
  const { deleteMedia } = useElements();
  const confirm = useConfirm();
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ onDelete: () => { void handleDelete().catch(() => undefined); } });

  const setRowHostRef = useCallback((node: HTMLElement | null) => {
    rowRef.current = node;
    triggerRef(node);
  }, [triggerRef]);

  useEffect(() => {
    const host = rowRef.current;
    if (!host) return;

    const mountObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { root: scrollRootRef?.current ?? null, rootMargin: '240px' },
    );
    const releaseObserver = new IntersectionObserver(
      (entries) => {
        if (entries.every((entry) => !entry.isIntersecting)) setVisible(false);
      },
      { root: scrollRootRef?.current ?? null, rootMargin: '1200px' },
    );

    mountObserver.observe(host);
    releaseObserver.observe(host);

    return () => {
      mountObserver.disconnect();
      releaseObserver.disconnect();
    };
  }, [scrollRootRef]);

  function handleArm() {
    onArm(asset.id);
  }

  // deleteMedia → deleteMediaAsset rejects when the asset no longer exists
  // (#214); mutatePatch has already reported the failure (#221), so the
  // rethrow is absorbed at the call sites below.
  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${asset.name}"?`,
      description: 'This audio will be permanently removed.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await deleteMedia(asset.id);
  }

  return (
    <>
      <SelectableRow.Root
        {...triggerHandlers}
        ref={setRowHostRef}
        selected={isActive}
        onClick={handleArm}
        className="h-9 focus-visible:ring-2 focus-visible:ring-brand"
      >
        <SelectableRow.Leading>
          {displaySrc ? (
            <img src={displaySrc} alt="" className="h-6 w-6 rounded object-cover" />
          ) : (
            <MediaAssetIcon
              asset={resolvedAsset}
              size={14}
              strokeWidth={1.75}
              className={status === 'generating' || status === 'uploading' ? 'shrink-0 animate-pulse text-tertiary' : 'shrink-0 text-tertiary'}
            />
          )}
        </SelectableRow.Leading>
        <SelectableRow.Label>{asset.name}</SelectableRow.Label>
      </SelectableRow.Root>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete().catch(() => undefined); }}>Delete</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}

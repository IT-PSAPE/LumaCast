import { useCallback, useEffect, useRef, useState } from 'react';
import { useBinScrollRoot } from '@renderer/components/layout/bin-shell';
import { useMediaDerivative } from '../../../hooks/use-media-derivative';
import { useElements } from '../../../contexts/canvas/canvas-context';
import { useContextMenuTrigger, ContextMenu, useConfirm } from '@lumacast/ui';
import { MediaAssetIcon } from '../../../components/display/entity-icon';
import { SelectableRow } from '../../../components/display/selectable-row';
import type { AudioRowProps } from './audio-bin-types';

export function AudioRowBody(props: AudioRowProps) {
  const { asset, isActive, onArm } = props;
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

  async function handleDelete() {
    if (props.onDeleteResource) {
      await props.onDeleteResource(asset.id);
      return;
    }
    const ok = await confirm({
      title: `Delete "${asset.name}"?`,
      description: 'This audio will be permanently removed.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (ok) await deleteMedia(asset.id);
  }

  function handleArm(event: React.MouseEvent<HTMLButtonElement>) {
    const modifiers = { shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey };
    const selectionOnly = props.onSelectionClick?.(asset.id, modifiers) ?? false;
    if (selectionOnly) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onArm(asset.id);
  }

  return (
    <>
      <SelectableRow.Root
        {...triggerHandlers}
        onContextMenuCapture={() => props.onContextMenuTarget?.(asset.id)}
        onKeyDownCapture={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) props.onContextMenuTarget?.(asset.id);
        }}
        onTouchStartCapture={() => props.onContextMenuTarget?.(asset.id)}
        ref={setRowHostRef}
        selected={isActive || Boolean(props.isResourceSelected)}
        onClick={handleArm}
        className="h-9 focus-visible:ring-2 focus-visible:ring-brand"
      >
        <SelectableRow.Leading>
          {displaySrc ? (
            <img src={displaySrc} alt="" className="h-6 w-6 rounded-control object-cover" />
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

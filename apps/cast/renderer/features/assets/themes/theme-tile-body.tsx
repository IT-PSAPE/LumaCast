import { useMemo, useRef } from 'react';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { SceneFrame } from '../../../components/display/scene-frame';
import { Thumbnail } from '../../../components/display/thumbnail';
import { RenameField, type RenameFieldHandle } from '../../../components/form/rename-field';
import { useContextMenuTrigger } from '@lumacast/ui';
import { useThemeEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { buildRenderScene } from '../../canvas/build-render-scene';
import type { ThemeItemProps } from './theme-bin-types';
import { ThemeContextMenuItems } from './theme-context-menu-items';
import { useDeleteTheme } from './use-delete-theme';
import { useMediaProxyMap } from '../../../hooks/use-media-proxy-map';

export function ThemeTileBody(props: ThemeItemProps) {
  const { theme, themeType, onApply, isResourceSelected, onSelectionClick, onContextMenuTarget, onDeleteResource, onDuplicateResource } = props;
  const { renameTheme, duplicateTheme } = useThemeEditor();
  const mediaProxyBySource = useMediaProxyMap();
  const scene = useMemo(
    () => buildRenderScene(
      { width: theme.width, height: theme.height, background: theme.background ?? null },
      theme.elements,
      { proxyMediaBySource: mediaProxyBySource },
    ),
    [mediaProxyBySource, theme.background, theme.elements, theme.height, theme.width],
  );
  const renameRef = useRef<RenameFieldHandle>(null);
  const deleteTheme = useDeleteTheme(theme);
  const handleDelete = () => onDeleteResource ? Promise.resolve(onDeleteResource(theme)) : deleteTheme();
  const handleDuplicate = () => onDuplicateResource ? Promise.resolve(onDuplicateResource(theme)) : Promise.resolve(duplicateTheme(theme.id));
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ onDelete: () => { void handleDelete().catch(() => undefined); } });

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    const modifiers = { shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey };
    if (onSelectionClick?.(theme.id, modifiers)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onApply(theme);
  }

  function handleRename(next: string) {
    renameTheme(theme.id, next);
  }

  return (
    <>
      <div
        {...triggerHandlers}
        ref={triggerRef}
        onContextMenuCapture={() => onContextMenuTarget?.(theme.id)}
        onKeyDownCapture={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) onContextMenuTarget?.(theme.id);
        }}
        onTouchStartCapture={() => onContextMenuTarget?.(theme.id)}
        className="rounded-container focus-visible:ring-2 focus-visible:ring-brand"
      >
        <Thumbnail.Tile onClick={handleClick} selected={Boolean(isResourceSelected)}>
          <Thumbnail.Body>
            <SceneFrame width={scene.width} height={scene.height} className="bg-tertiary" stageClassName="absolute inset-0" checkerboard>
              <LazySceneStage scene={scene} surface="list" className="absolute inset-0" />
            </SceneFrame>
          </Thumbnail.Body>
          <Thumbnail.Caption>
            <RenameField ref={renameRef} value={theme.name} onValueChange={handleRename} className="label-xs" />
          </Thumbnail.Caption>
        </Thumbnail.Tile>
      </div>
      <ThemeContextMenuItems
        theme={theme}
        themeType={themeType}
        renameRef={renameRef}
        onDelete={() => { void handleDelete().catch(() => undefined); }}
        onDuplicate={() => { void handleDuplicate().catch(() => undefined); }}
      />
    </>
  );
}

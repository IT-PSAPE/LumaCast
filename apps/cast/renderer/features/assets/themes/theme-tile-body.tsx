import { useMemo, useRef } from 'react';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { SceneFrame } from '../../../components/display/scene-frame';
import { Thumbnail } from '../../../components/display/thumbnail';
import { RenameField, type RenameFieldHandle } from '../../../components/form/rename-field';
import { useContextMenuTrigger } from '../../../components/overlays/context-menu';
import { useThemeEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { buildRenderScene } from '../../canvas/build-render-scene';
import type { ThemeItemProps } from './theme-bin-types';
import { ThemeContextMenuItems } from './theme-context-menu-items';
import { useDeleteTheme } from './use-delete-theme';
import { useMediaProxyMap } from '../../../hooks/use-media-proxy-map';

export function ThemeTileBody({ theme, index, themeType, onApply }: ThemeItemProps) {
  const { renameTheme } = useThemeEditor();
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
  const handleDelete = useDeleteTheme(theme);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ onDelete: () => { void handleDelete(); } });

  function handleClick() {
    onApply(theme);
  }

  function handleRename(next: string) {
    renameTheme(theme.id, next);
  }

  return (
    <>
      <div {...triggerHandlers} ref={triggerRef} className="rounded-xs focus-visible:ring-2 focus-visible:ring-brand">
        <Thumbnail.Tile onClick={handleClick}>
          <Thumbnail.Body>
            <SceneFrame width={scene.width} height={scene.height} className="bg-tertiary" stageClassName="absolute inset-0" checkerboard>
              <LazySceneStage scene={scene} surface="list" className="absolute inset-0" />
            </SceneFrame>
          </Thumbnail.Body>
          <Thumbnail.Caption>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-sm font-semibold tabular-nums text-secondary">{index + 1}</span>
              <RenameField ref={renameRef} value={theme.name} onValueChange={handleRename} className="label-xs" />
            </div>
          </Thumbnail.Caption>
        </Thumbnail.Tile>
      </div>
      <ThemeContextMenuItems theme={theme} themeType={themeType} renameRef={renameRef} onDelete={() => { void handleDelete(); }} />
    </>
  );
}

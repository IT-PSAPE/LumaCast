import { memo, useMemo, useRef } from 'react';
import type { DeckItem, Overlay, Theme } from '@core/types';
import { isThemeCompatibleWithDeckItem } from '@core/themes';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { ContextMenu, useContextMenuTrigger } from '../../../components/overlays/context-menu';
import { useConfirm } from '../../../components/overlays/confirm-dialog';
import { RenameField, type RenameFieldHandle } from '../../../components/form/rename-field';
import { SelectableRow } from '../../../components/display/selectable-row';
import { Thumbnail } from '../../../components/display/thumbnail';
import { SceneFrame } from '../../../components/display/scene-frame';
import { useThemeEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { useProjectContent } from '../../../contexts/use-project-content';
import { buildRenderScene } from '../../canvas/build-render-scene';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { useGridSize } from '../../../hooks/use-grid-size';
import type { ResourceDrawerViewMode } from '../../../types/ui';
import { BinShell } from '../../workbench/bin-shell';
import type { BinCollectionsApi } from '../../workbench/use-bin-collections';
import { useThemeBin } from './use-theme-bin';

export function ThemeBinPanel() {
  const {
    filteredThemes,
    handleApplyTheme,
    collections,
    searchValue,
    setSearchValue,
    viewMode,
    setViewMode,
  } = useThemeBin();
  const { gridSize, setGridSize, min, max, step } = useGridSize('lumacast.grid-size.theme-bin', 6, 4, 8);

  return (
    <BinShell
      collections={collections}
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      searchPlaceholder="Search themes…"
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      gridSize={gridSize}
      gridSizeMin={min}
      gridSizeMax={max}
      gridSizeStep={step}
      onGridSizeChange={setGridSize}
    >
      <BinPanelLayout gridItemSize={gridSize} mode={viewMode}>
        {filteredThemes.map((theme, index) => (
          <ThemeBinItem
            key={theme.id}
            theme={theme}
            index={index}
            mode={viewMode}
            onApply={handleApplyTheme}
            collectionsApi={collections}
          />
        ))}
      </BinPanelLayout>
    </BinShell>
  );
}

interface ThemeItemProps {
  theme: Theme;
  index: number;
  onApply: (theme: Theme) => void;
  collectionsApi: BinCollectionsApi;
}

function ThemeBinItem({ mode, ...props }: ThemeItemProps & { mode: ResourceDrawerViewMode }) {
  if (mode === 'list') return <ThemeRow {...props} />;
  return <ThemeTile {...props} />;
}

function ThemeRowImpl(props: ThemeItemProps) {
  return (
    <ContextMenu.Root>
      <ThemeRowBody {...props} />
    </ContextMenu.Root>
  );
}

function ThemeRowBody({ theme, index, onApply, collectionsApi }: ThemeItemProps) {
  const { renameTheme } = useThemeEditor();
  const renameRef = useRef<RenameFieldHandle>(null);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger();

  function handleClick() {
    onApply(theme);
  }

  function handleRename(next: string) {
    renameTheme(theme.id, next);
  }

  return (
    <>
      <SelectableRow.Root
        {...triggerHandlers}
        ref={triggerRef}
        selected={false}
        onClick={handleClick}
        className="h-9"
      >
        <SelectableRow.Leading>
          <span className="text-xs font-semibold tabular-nums text-tertiary">{index + 1}</span>
        </SelectableRow.Leading>
        <SelectableRow.Label>
          <RenameField ref={renameRef} value={theme.name} onValueChange={handleRename} className="label-xs" />
        </SelectableRow.Label>
        <SelectableRow.Trailing>
          <span className="text-xs uppercase tracking-wide text-tertiary">{theme.kind}</span>
        </SelectableRow.Trailing>
      </SelectableRow.Root>
      <ThemeContextMenuItems theme={theme} renameRef={renameRef} collectionsApi={collectionsApi} />
    </>
  );
}

function ThemeTileImpl(props: ThemeItemProps) {
  return (
    <ContextMenu.Root>
      <ThemeTileBody {...props} />
    </ContextMenu.Root>
  );
}

function ThemeTileBody({ theme, index, onApply, collectionsApi }: ThemeItemProps) {
  const { renameTheme } = useThemeEditor();
  const scene = useMemo(() => buildRenderScene(null, theme.elements), [theme.elements]);
  const renameRef = useRef<RenameFieldHandle>(null);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger();

  function handleClick() {
    onApply(theme);
  }

  function handleRename(next: string) {
    renameTheme(theme.id, next);
  }

  return (
    <>
      <div {...triggerHandlers} ref={triggerRef}>
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
      <ThemeContextMenuItems theme={theme} renameRef={renameRef} collectionsApi={collectionsApi} />
    </>
  );
}

function ThemeContextMenuItems({
  theme,
  renameRef,
  collectionsApi,
}: {
  theme: Theme;
  renameRef: React.RefObject<RenameFieldHandle | null>;
  collectionsApi: BinCollectionsApi;
}) {
  const { applyThemeToTarget, deleteTheme } = useThemeEditor();
  const { presentations, lyrics, overlays } = useProjectContent();
  const confirm = useConfirm();

  const compatibleDeckItems = useMemo<DeckItem[]>(() => {
    if (theme.kind === 'overlays') return [];
    return [...presentations, ...lyrics].filter((item) =>
      isThemeCompatibleWithDeckItem(theme, item.type),
    );
  }, [lyrics, presentations, theme]);

  const compatibleOverlays = useMemo<Overlay[]>(() => {
    if (theme.kind !== 'overlays') return [];
    return overlays;
  }, [overlays, theme.kind]);

  const hasTargets = compatibleDeckItems.length > 0 || compatibleOverlays.length > 0;
  const targetLabel = theme.kind === 'overlays' ? 'overlays' : theme.kind === 'lyrics' ? 'lyrics' : 'presentations';

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${theme.name}"?`,
      description: 'Slides linked to this theme will be detached.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) deleteTheme(theme.id);
  }

  return (
    <ContextMenu.Portal>
      <ContextMenu.Menu>
        <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
        <ContextMenu.Submenu label="Apply to" disabled={!hasTargets}>
          {!hasTargets ? (
            <ContextMenu.Item disabled>No compatible {targetLabel}</ContextMenu.Item>
          ) : (
            <>
              {compatibleDeckItems.map((item) => (
                <ContextMenu.Item
                  key={item.id}
                  onSelect={() => { void applyThemeToTarget(theme.id, { type: 'deck-item', itemId: item.id }); }}
                >
                  {item.title}
                </ContextMenu.Item>
              ))}
              {compatibleOverlays.map((overlay) => (
                <ContextMenu.Item
                  key={overlay.id}
                  onSelect={() => { void applyThemeToTarget(theme.id, { type: 'overlay', overlayId: overlay.id }); }}
                >
                  {overlay.name}
                </ContextMenu.Item>
              ))}
            </>
          )}
        </ContextMenu.Submenu>
        {collectionsApi.collections.filter((c) => c.id !== theme.collectionId).length > 0 ? (
          <ContextMenu.Submenu label="Move to collection">
            {collectionsApi.collections.filter((c) => c.id !== theme.collectionId).map((collection) => (
              <ContextMenu.Item
                key={collection.id}
                onSelect={() => { void collectionsApi.assignItem('theme', theme.id, collection.id); }}
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

const ThemeRow = memo(ThemeRowImpl);
const ThemeTile = memo(ThemeTileImpl);

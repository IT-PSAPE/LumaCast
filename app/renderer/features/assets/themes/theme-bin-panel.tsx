import { memo, useMemo, useRef } from 'react';
import type { ItemType, Lyric, Overlay, Presentation, Talk, ThemeOwnerType } from '@lumacast/composition';
import type { EditorThemeSource } from '@lumacast/canvas';
import { Plus } from 'lucide-react';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { ContextMenu, useContextMenuTrigger } from '../../../components/overlays/context-menu';
import { useConfirm } from '../../../components/overlays/confirm-dialog';
import { RenameField, type RenameFieldHandle } from '../../../components/form/rename-field';
import { SelectableRow } from '../../../components/display/selectable-row';
import { Thumbnail } from '../../../components/display/thumbnail';
import { SceneFrame } from '../../../components/display/scene-frame';
import { Label } from '../../../components/display/text';
import { useThemeEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { useCast } from '../../../contexts/app-context';
import { useProjectContent } from '../../../contexts/use-project-content';
import { useWorkbench } from '../../../contexts/workbench-context';
import { buildRenderScene } from '../../canvas/build-render-scene';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { BinShell } from '@renderer/components/layout/bin-shell';
import { useBinControls } from '@renderer/components/controls/bin-controls';
import { useThemeBin, type ThemeBinSection } from './use-theme-bin';
import type { ResourceDrawerViewMode } from '../../../types/ui';

export function ThemeBinPanel() {
  const { sections, handleApplyTheme } = useThemeBin();
  const { createTheme } = useThemeEditor();
  const { actions: { setWorkbenchMode } } = useWorkbench();
  const { state: { viewMode, grid } } = useBinControls();
  const gridSize = grid?.value ?? 6;

  function handleCreateTheme(themeType: ThemeOwnerType) {
    createTheme(themeType);
    setWorkbenchMode('theme-editor');
  }

  return (
    <BinShell>
      <BinShell.Content>
        <div className="flex flex-col gap-3">
          {sections.map((section) => (
            <ThemeBinSectionBody
              key={section.type}
              section={section}
              gridSize={gridSize}
              viewMode={viewMode}
              onCreate={() => handleCreateTheme(section.type)}
              onApply={handleApplyTheme}
            />
          ))}
        </div>
      </BinShell.Content>
    </BinShell>
  );
}

interface ThemeBinSectionBodyProps {
  section: ThemeBinSection;
  gridSize: number;
  viewMode: ResourceDrawerViewMode;
  onCreate: () => void;
  onApply: (theme: EditorThemeSource) => void;
}

function ThemeBinSectionBody({ section, gridSize, viewMode, onCreate, onApply }: ThemeBinSectionBodyProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label.xs className="px-1 text-tertiary">{section.label}</Label.xs>
      {section.themes.length === 0 ? (
        <CreateThemeDropZone themeType={section.type} onActivate={onCreate} />
      ) : (
        <BinPanelLayout gridItemSize={gridSize} mode={viewMode}>
          {section.themes.map((theme, index) => (
            <ThemeBinItem
              key={theme.id}
              theme={theme}
              index={index}
              mode={viewMode}
              themeType={section.type}
              onApply={onApply}
            />
          ))}
        </BinPanelLayout>
      )}
    </div>
  );
}

function CreateThemeDropZone({ themeType, onActivate }: { themeType: ThemeOwnerType; onActivate: () => void }) {
  const label = `Create ${themeType} theme`;
  return (
    <button
      type="button"
      onClick={onActivate}
      aria-label={label}
      className="flex w-full items-center justify-center gap-1.5 rounded-xs border border-dashed border-tertiary/70 px-2 py-2.5 text-tertiary transition-colors hover:border-secondary hover:text-secondary focus-visible:ring-2 focus-visible:ring-brand"
    >
      <Plus size={14} strokeWidth={1.75} />
      <span className="text-xs">{label}</span>
    </button>
  );
}

interface ThemeItemProps {
  theme: EditorThemeSource;
  index: number;
  themeType: ThemeOwnerType;
  onApply: (theme: EditorThemeSource) => void;
}

function ThemeBinItem({ mode, ...props }: ThemeItemProps & { mode: 'grid' | 'list' }) {
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

function ThemeRowBody({ theme, index, themeType, onApply }: ThemeItemProps) {
  const { renameTheme } = useThemeEditor();
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
      <SelectableRow.Root
        {...triggerHandlers}
        ref={triggerRef}
        selected={false}
        onClick={handleClick}
        className="h-9 focus-visible:ring-2 focus-visible:ring-brand"
      >
        <SelectableRow.Leading>
          <span className="text-xs font-semibold tabular-nums text-tertiary">{index + 1}</span>
        </SelectableRow.Leading>
        <SelectableRow.Label>
          <RenameField ref={renameRef} value={theme.name} onValueChange={handleRename} className="label-xs" />
        </SelectableRow.Label>
      </SelectableRow.Root>
      <ThemeContextMenuItems theme={theme} themeType={themeType} renameRef={renameRef} onDelete={() => { void handleDelete(); }} />
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

function ThemeTileBody({ theme, index, themeType, onApply }: ThemeItemProps) {
  const { renameTheme } = useThemeEditor();
  const scene = useMemo(() => buildRenderScene({ width: theme.width, height: theme.height, background: theme.background ?? null }, theme.elements), [theme.background, theme.elements, theme.height, theme.width]);
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

function useDeleteTheme(theme: EditorThemeSource) {
  const { deleteTheme } = useThemeEditor();
  const confirm = useConfirm();

  return async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${theme.name}"?`,
      description: 'Slides linked to this theme will be detached.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) deleteTheme(theme.id);
  };
}

// A theme family's items are always its exclusive apply targets — structural
// gating (#219 D2) means there is no cross-family compatibility to filter,
// unlike the old single-table Theme.kind matrix this replaces.
type ApplyTargets =
  | { kind: 'item'; itemType: ItemType; items: (Presentation | Lyric | Talk)[]; label: string }
  | { kind: 'overlay'; items: Overlay[]; label: string };

function ThemeContextMenuItems({
  theme,
  themeType,
  renameRef,
  onDelete,
}: {
  theme: EditorThemeSource;
  themeType: ThemeOwnerType;
  renameRef: React.RefObject<RenameFieldHandle | null>;
  onDelete: () => void;
}) {
  const { applyThemeToTarget } = useThemeEditor();
  const { setStatusText } = useCast();
  const { presentations, lyrics, talks, overlays } = useProjectContent();

  const targets = useMemo<ApplyTargets>(() => {
    if (themeType === 'presentation') return { kind: 'item', itemType: 'presentation', items: presentations, label: 'presentations' };
    if (themeType === 'lyric') return { kind: 'item', itemType: 'lyric', items: lyrics, label: 'lyrics' };
    if (themeType === 'talk') return { kind: 'item', itemType: 'talk', items: talks, label: 'talks' };
    return { kind: 'overlay', items: overlays, label: 'overlays' };
  }, [themeType, presentations, lyrics, talks, overlays]);

  async function handleApplyToItem(itemId: string, itemType: ItemType) {
    try {
      await applyThemeToTarget(theme.id, { type: 'item', itemRef: { type: itemType, id: itemId } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(`Failed to apply theme: ${message}`);
    }
  }

  async function handleApplyToOverlay(overlayId: string) {
    try {
      await applyThemeToTarget(theme.id, { type: 'overlay', overlayId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(`Failed to apply theme: ${message}`);
    }
  }

  const hasTargets = targets.items.length > 0;

  return (
    <ContextMenu.Portal>
      <ContextMenu.Menu>
        <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
        <ContextMenu.Submenu label="Apply to" disabled={!hasTargets}>
          {!hasTargets ? (
            <ContextMenu.Item disabled onSelect={() => {}}>No compatible {targets.label}</ContextMenu.Item>
          ) : targets.kind === 'overlay' ? (
            targets.items.map((overlay) => (
              <ContextMenu.Item key={overlay.id} onSelect={() => { void handleApplyToOverlay(overlay.id); }}>
                {overlay.name}
              </ContextMenu.Item>
            ))
          ) : (
            targets.items.map((item) => (
              <ContextMenu.Item key={item.id} onSelect={() => { void handleApplyToItem(item.id, targets.itemType); }}>
                {item.title}
              </ContextMenu.Item>
            ))
          )}
        </ContextMenu.Submenu>
        <ContextMenu.Separator />
        <ContextMenu.Item variant="destructive" onSelect={onDelete}>Delete</ContextMenu.Item>
      </ContextMenu.Menu>
    </ContextMenu.Portal>
  );
}

const ThemeRow = memo(ThemeRowImpl);
const ThemeTile = memo(ThemeTileImpl);

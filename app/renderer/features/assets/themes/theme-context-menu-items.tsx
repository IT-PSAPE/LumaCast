import { useMemo } from 'react';
import type { ItemType, Lyric, Overlay, Presentation, Talk, ThemeOwnerType } from '@lumacast/composition';
import type { EditorThemeSource } from '@lumacast/canvas';
import { ContextMenu } from '../../../components/overlays/context-menu';
import { type RenameFieldHandle } from '../../../components/form/rename-field';
import { useThemeEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { useCast } from '../../../contexts/app-context';
import { useProjectContent } from '../../../contexts/use-project-content';

// A theme family's items are always its exclusive apply targets — structural
// gating (#219 D2) means there is no cross-family compatibility to filter,
// unlike the old single-table Theme.kind matrix this replaces.
type ApplyTargets =
  | { kind: 'item'; itemType: ItemType; items: (Presentation | Lyric | Talk)[]; label: string }
  | { kind: 'overlay'; items: Overlay[]; label: string };

export function ThemeContextMenuItems({
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

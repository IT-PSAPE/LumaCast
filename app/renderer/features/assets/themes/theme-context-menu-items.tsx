import { useMemo } from 'react';
import type { ItemType, Lyric, Presentation, ThemeOwnerType } from '@lumacast/composition';
import type { EditorThemeSource } from '@lumacast/canvas';
import { ContextMenu } from '../../../components/overlays/context-menu';
import { type RenameFieldHandle } from '../../../components/form/rename-field';
import { useThemeEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { useCast } from '../../../contexts/app-context';
import { useProjectContent } from '../../../contexts/use-project-content';

// A theme family's items are always its exclusive apply targets — structural
// gating (#219 D2) means there is no cross-family compatibility to filter,
// unlike the old single-table Theme.kind matrix this replaces.
// Overlay themes are removed from the UI; overlay single-slide and duplicate
// overlay serve reuse. Only item families remain as apply targets.
type ApplyTargets = { kind: 'item'; itemType: ItemType; items: (Presentation | Lyric)[]; label: string };

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
  const { presentations, lyrics } = useProjectContent();

  const targets = useMemo<ApplyTargets | null>(() => {
    if (themeType === 'presentation') return { kind: 'item', itemType: 'presentation', items: presentations, label: 'presentations' };
    if (themeType === 'lyric') return { kind: 'item', itemType: 'lyric', items: lyrics, label: 'lyrics' };
    return null;
  }, [themeType, presentations, lyrics]);

  async function handleApplyToItem(itemId: string, itemType: ItemType) {
    try {
      await applyThemeToTarget(theme.id, { type: 'item', itemRef: { type: itemType, id: itemId } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(`Failed to apply theme: ${message}`);
    }
  }

  if (!targets) return null;
  const hasTargets = targets.items.length > 0;

  return (
    <ContextMenu.Portal>
      <ContextMenu.Menu>
        <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
        <ContextMenu.Submenu label="Apply to" disabled={!hasTargets}>
          {!hasTargets ? (
            <ContextMenu.Item disabled onSelect={() => {}}>No compatible {targets.label}</ContextMenu.Item>
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

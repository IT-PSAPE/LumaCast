import { useEffect, useMemo, useState } from 'react';
import { Unlink } from 'lucide-react';
import { isThemeCompatibleWithOwnerKind } from '@core/theme-capabilities';
import { ReacstButton } from '@renderer/components/controls/button';
import { FieldInput, FieldSelect } from '../../components/form/field';
import { getDeckItemLabel } from '@core/deck-items';
import { useConfirm } from '../../components/overlays/confirm-dialog';
import { useCast } from '../../contexts/app-context';
import { useNavigation } from '../../contexts/navigation-context';
import { useProjectContent } from '../../contexts/use-project-content';
import { useThemeEditor } from '../../contexts/asset-editor/asset-editor-context';
import { Section } from './inspector-section';
import { Label } from '@renderer/components/display/text';

const NO_TEMPLATE_VALUE = '';

export function DeckItemInspector() {
  const { currentDeckItem, renameDeckItem } = useNavigation();
  const { themes, themesById } = useProjectContent();
  const { applyThemeToTarget, detachThemeFromDeckItem } = useThemeEditor();
  const { setStatusText } = useCast();
  const confirm = useConfirm();
  const [titleDraft, setTitleDraft] = useState('');

  const assignedTheme = currentDeckItem?.themeId
    ? themesById.get(currentDeckItem.themeId) ?? null
    : null;

  const compatibleThemes = useMemo(() => {
    if (!currentDeckItem) return [];
    return themes.filter((theme) => isThemeCompatibleWithOwnerKind(theme, currentDeckItem.type));
  }, [currentDeckItem, themes]);

  const themeOptions = useMemo(() => [
    { value: NO_TEMPLATE_VALUE, label: 'Select a theme…' },
    ...compatibleThemes.map((theme) => ({ value: theme.id, label: theme.name })),
  ], [compatibleThemes]);

  useEffect(() => {
    if (!currentDeckItem) {
      setTitleDraft('');
      return;
    }
    setTitleDraft(currentDeckItem.title);
  }, [currentDeckItem]);

  function handleTitleChange(value: string) {
    setTitleDraft(value);
  }

  function handleTitleBlur() {
    if (!currentDeckItem) return;
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === currentDeckItem.title) return;
    // renameDeckItem → renamePresentation/Lyric/Talk rejects when the item no
    // longer exists (#214), which this blur commit can race with a concurrent
    // delete. mutatePatch has already reported the failure, so absorb the
    // rethrow here.
    void renameDeckItem(currentDeckItem.id, trimmed).catch(() => undefined);
  }

  async function handleResetToTheme() {
    if (!currentDeckItem?.themeId) return;
    const ok = await confirm({
      title: `Reset "${currentDeckItem.title}" to theme?`,
      description: 'This replaces every slide’s content with the theme’s elements. Elements you added yourself will be removed.',
      confirmLabel: 'Reset',
      destructive: true,
    });
    if (!ok) return;
    try {
      await applyThemeToTarget(currentDeckItem.themeId, { type: 'deck-item', itemId: currentDeckItem.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(`Failed to reset to theme: ${message}`);
    }
  }

  async function handleApplyTheme(themeId: string) {
    if (!currentDeckItem || themeId === NO_TEMPLATE_VALUE) return;
    try {
      await applyThemeToTarget(themeId, { type: 'deck-item', itemId: currentDeckItem.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(`Failed to apply theme: ${message}`);
    }
  }

  async function handleDetachTheme() {
    if (!currentDeckItem) return;
    try {
      await detachThemeFromDeckItem(currentDeckItem.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(`Failed to detach theme: ${message}`);
    }
  }

  if (!currentDeckItem) {
    return <div className="text-sm text-tertiary">No item selected.</div>;
  }

  const itemLabel = getDeckItemLabel(currentDeckItem);
  const hasThemeId = Boolean(currentDeckItem.themeId);

  return (
    <>
      <Section.Root>
        <Section.Header>
          <Label.xs>{itemLabel}</Label.xs>
        </Section.Header>
        <Section.Body>
          <FieldInput type="text" value={titleDraft} onChange={handleTitleChange} onBlur={handleTitleBlur} />
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header>
          <Label.xs>Theme</Label.xs>
        </Section.Header>
        <Section.Body>
          {assignedTheme ? (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-tertiary uppercase tracking-wider">Assigned Theme</span>
                <p className="m-0 text-sm text-secondary">{assignedTheme.name}</p>
              </div>
              <div className="flex gap-2">
                <ReacstButton onClick={() => { void handleResetToTheme(); }} className="flex-1">Reset To Theme</ReacstButton>
                <ReacstButton.Icon label="Remove theme" onClick={handleDetachTheme}>
                  <Unlink size={14} />
                </ReacstButton.Icon>
              </div>
            </>
          ) : hasThemeId ? (
            <>
              <p className="m-0 text-sm text-tertiary">Assigned theme unavailable.</p>
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <FieldSelect value={NO_TEMPLATE_VALUE} onChange={handleApplyTheme} options={themeOptions} />
                </div>
                <ReacstButton.Icon label="Remove theme" onClick={handleDetachTheme}>
                  <Unlink size={14} />
                </ReacstButton.Icon>
              </div>
            </>
          ) : compatibleThemes.length === 0 ? (
            <p className="m-0 text-sm text-tertiary">No compatible themes available.</p>
          ) : (
            <FieldSelect value={NO_TEMPLATE_VALUE} onChange={handleApplyTheme} options={themeOptions} />
          )}
        </Section.Body>
      </Section.Root>
    </>
  );
}

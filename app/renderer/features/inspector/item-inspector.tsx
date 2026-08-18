import { useEffect, useMemo, useState } from 'react';
import { Unlink } from 'lucide-react';
import { getItemTypeLabel } from '@lumacast/composition';
import { ReacstButton } from '@renderer/components/controls/button';
import { FieldInput, FieldSelect } from '../../components/form/field';
import { useConfirm } from '../../components/overlays/confirm-dialog';
import { useCast } from '../../contexts/app-context';
import { useNavigation } from '../../contexts/navigation-context';
import { useProjectContent } from '../../contexts/use-project-content';
import { useThemeEditor } from '../../contexts/asset-editor/asset-editor-context';
import { Section } from './inspector-section';
import { Label } from '@renderer/components/display/text';

const NO_TEMPLATE_VALUE = '';

export function ItemInspector() {
  const { currentItemRef, currentItem, renameItem } = useNavigation();
  const {
    presentationThemes, lyricThemes, talkThemes,
    presentationThemesById, lyricThemesById, talkThemesById,
  } = useProjectContent();
  const { applyThemeToTarget, detachThemeFromItem } = useThemeEditor();
  const { setStatusText } = useCast();
  const confirm = useConfirm();
  const [titleDraft, setTitleDraft] = useState('');

  // The three item types each theme against their own table (D2: no
  // capability matrix left to check — which table an id lives in already
  // says what it can theme), so the inspector just picks the one array/map
  // matching the current item's type.
  const compatibleThemes = useMemo(() => {
    if (!currentItemRef) return [];
    if (currentItemRef.type === 'presentation') return presentationThemes;
    if (currentItemRef.type === 'lyric') return lyricThemes;
    return talkThemes;
  }, [currentItemRef, lyricThemes, presentationThemes, talkThemes]);

  const assignedTheme = useMemo(() => {
    if (!currentItem?.themeId || !currentItemRef) return null;
    const byId = currentItemRef.type === 'presentation'
      ? presentationThemesById
      : currentItemRef.type === 'lyric'
        ? lyricThemesById
        : talkThemesById;
    return byId.get(currentItem.themeId) ?? null;
  }, [currentItem, currentItemRef, lyricThemesById, presentationThemesById, talkThemesById]);

  const themeOptions = useMemo(() => [
    { value: NO_TEMPLATE_VALUE, label: 'Select a theme…' },
    ...compatibleThemes.map((theme) => ({ value: theme.id, label: theme.name })),
  ], [compatibleThemes]);

  useEffect(() => {
    if (!currentItem) {
      setTitleDraft('');
      return;
    }
    setTitleDraft(currentItem.title);
  }, [currentItem]);

  function handleTitleChange(value: string) {
    setTitleDraft(value);
  }

  function handleTitleBlur() {
    if (!currentItemRef || !currentItem) return;
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === currentItem.title) return;
    // renameItem → renamePresentation/Lyric/Talk rejects when the item no
    // longer exists (#214), which this blur commit can race with a concurrent
    // delete. mutatePatch has already reported the failure, so absorb the
    // rethrow here.
    void renameItem(currentItemRef, trimmed).catch(() => undefined);
  }

  async function handleResetToTheme() {
    if (!currentItem?.themeId || !currentItemRef) return;
    const ok = await confirm({
      title: `Reset "${currentItem.title}" to theme?`,
      description: 'This replaces every slide’s content with the theme’s elements. Elements you added yourself will be removed.',
      confirmLabel: 'Reset',
      destructive: true,
    });
    if (!ok) return;
    try {
      await applyThemeToTarget(currentItem.themeId, { type: 'item', itemRef: currentItemRef });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(`Failed to reset to theme: ${message}`);
    }
  }

  async function handleApplyTheme(themeId: string) {
    if (!currentItemRef || themeId === NO_TEMPLATE_VALUE) return;
    try {
      await applyThemeToTarget(themeId, { type: 'item', itemRef: currentItemRef });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(`Failed to apply theme: ${message}`);
    }
  }

  async function handleDetachTheme() {
    if (!currentItemRef) return;
    try {
      await detachThemeFromItem(currentItemRef);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(`Failed to detach theme: ${message}`);
    }
  }

  if (!currentItemRef || !currentItem) {
    return <div className="text-sm text-tertiary">No item selected.</div>;
  }

  const itemLabel = getItemTypeLabel(currentItemRef.type);
  const hasThemeId = Boolean(currentItem.themeId);

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

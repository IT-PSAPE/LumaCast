import { useEffect, useRef, useState } from 'react';
import { FieldInput } from '../../components/form/field';
import { useCast } from '../../contexts/app-context';
import { useThemeEditor } from '../../contexts/asset-editor/asset-editor-context';
import { EntityBackgroundInspector } from './entity-background-inspector';
import { Section } from './inspector-section';

export function ThemeInspector() {
  const { setStatusText } = useCast();
  const { currentTheme, renameTheme, updateThemeDraft, nameFocusRequest } = useThemeEditor();
  const [nameDraft, setNameDraft] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!currentTheme) {
      setNameDraft('');
      return;
    }
    setNameDraft(currentTheme.name);
  }, [currentTheme]);

  useEffect(() => {
    if (!nameFocusRequest || !nameInputRef.current) return;
    nameInputRef.current.focus();
    nameInputRef.current.select();
  }, [nameFocusRequest]);

  function handleNameChange(value: string) {
    setNameDraft(value);
  }

  function handleNameBlur() {
    if (!currentTheme) return;
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === currentTheme.name) return;
    renameTheme(currentTheme.id, trimmed);
    setStatusText('Theme renamed');
  }

  function handleBackgroundChange(background: import('@core/types').SlideBackground | null) {
    if (!currentTheme) return;
    updateThemeDraft({ id: currentTheme.id, background });
  }

  if (!currentTheme) {
    return <div className="text-sm text-tertiary">No theme selected.</div>;
  }

  return (
    <>
      <Section.Root>
        <Section.Body>
          <FieldInput
            type="text"
            value={nameDraft}
            onChange={handleNameChange}
            onBlur={handleNameBlur}
            label="Name"
            wide
            inputRef={nameInputRef}
          />
        </Section.Body>
      </Section.Root>
      <EntityBackgroundInspector ownerId={currentTheme.id} background={currentTheme.background ?? null} onChange={handleBackgroundChange} />
    </>
  );
}

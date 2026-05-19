import { useEffect, useRef, useState } from 'react';
import { FieldInput } from '../../components/form/field';
import { useCast } from '../../contexts/app-context';
import { useStageEditor } from '../../contexts/asset-editor/asset-editor-context';
import { useProjectContent } from '../../contexts/use-project-content';
import { EntityBackgroundInspector } from './entity-background-inspector';
import { Section } from './inspector-section';

export function StageInspector() {
  const { setStatusText } = useCast();
  const { currentStage, updateStageDraft, nameFocusRequest } = useStageEditor();
  const { stagesById } = useProjectContent();
  const [nameDraft, setNameDraft] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!currentStage) {
      setNameDraft('');
      return;
    }
    setNameDraft(currentStage.name);
  }, [currentStage]);

  useEffect(() => {
    if (!nameFocusRequest || !nameInputRef.current) return;
    nameInputRef.current.focus();
    nameInputRef.current.select();
  }, [nameFocusRequest]);

  function handleNameChange(value: string) {
    setNameDraft(value);
  }

  function handleNameBlur() {
    if (!currentStage) return;
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === currentStage.name) return;
    updateStageDraft({ id: currentStage.id, name: trimmed });
    setStatusText('Stage renamed');
  }

  if (!currentStage) {
    return <div className="text-sm text-tertiary">No stage selected.</div>;
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
            // label="Name"
            wide
            inputRef={nameInputRef}
          />
        </Section.Body>
      </Section.Root>
      <EntityBackgroundInspector ownerId={currentStage.id} background={stagesById.get(currentStage.id)?.background ?? null} />
    </>
  );
}

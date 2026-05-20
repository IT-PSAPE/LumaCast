import { useEffect, useRef, useState } from 'react';
import { FieldInput, FieldSelect } from '../../components/form/field';
import { useCast } from '../../contexts/app-context';
import { useOverlayEditor } from '../../contexts/asset-editor/asset-editor-context';
import { useWorkbench } from '../../contexts/workbench-context';
import { Section } from './inspector-section';

const TRANSITION_OPTIONS = [
  { value: 'none', label: 'Cut' },
  { value: 'dissolve', label: 'Dissolve' },
];

export function SlideInspector() {
  const { setStatusText } = useCast();
  const { currentOverlay, updateOverlayDraft, nameFocusRequest } = useOverlayEditor();
  const { state: { workbenchMode } } = useWorkbench();
  const isOverlayEdit = workbenchMode === 'overlay-editor';
  const [overlayNameDraft, setOverlayNameDraft] = useState('');
  const [transitionKindDraft, setTransitionKindDraft] = useState('none');
  const [transitionDurationDraft, setTransitionDurationDraft] = useState('0');
  const [autoClearDurationDraft, setAutoClearDurationDraft] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!nameFocusRequest || !nameInputRef.current) return;
    nameInputRef.current.focus();
    nameInputRef.current.select();
  }, [nameFocusRequest]);

  useEffect(() => {
    if (!currentOverlay) {
      setOverlayNameDraft('');
      setTransitionKindDraft('none');
      setTransitionDurationDraft('0');
      setAutoClearDurationDraft('');
      return;
    }

    setOverlayNameDraft(currentOverlay.name);
    setTransitionKindDraft(currentOverlay.animation.kind === 'dissolve' ? 'dissolve' : 'none');
    setTransitionDurationDraft(String(currentOverlay.animation.durationMs));
    setAutoClearDurationDraft(
      currentOverlay.animation.autoClearDurationMs == null
        ? ''
        : String(currentOverlay.animation.autoClearDurationMs),
    );
  }, [currentOverlay]);

  function handleOverlayNameChange(value: string) {
    setOverlayNameDraft(value);
  }

  function handleTransitionKindChange(value: string) {
    setTransitionKindDraft(value);
  }

  function handleTransitionDurationChange(value: string) {
    setTransitionDurationDraft(value);
  }

  function handleAutoClearDurationChange(value: string) {
    setAutoClearDurationDraft(value);
  }

  function handleOverlaySettingsBlur() {
    if (!currentOverlay) return;

    const nextName = overlayNameDraft.trim() || currentOverlay.name;
    const nextTransitionKind = transitionKindDraft === 'dissolve' ? 'dissolve' : 'none';
    const nextDurationMs = Math.max(0, Number.parseInt(transitionDurationDraft || '0', 10) || 0);
    const nextAutoClearDurationMs = autoClearDurationDraft.trim() === ''
      ? null
      : Math.max(0, Number.parseInt(autoClearDurationDraft, 10) || 0);

    const hasNameChanged = nextName !== currentOverlay.name;
    const hasTransitionChanged = nextTransitionKind !== currentOverlay.animation.kind
      || nextDurationMs !== currentOverlay.animation.durationMs
      || nextAutoClearDurationMs !== (currentOverlay.animation.autoClearDurationMs ?? null);

    if (!hasNameChanged && !hasTransitionChanged) return;

    updateOverlayDraft({
      id: currentOverlay.id,
      name: nextName,
      animation: {
        kind: nextTransitionKind,
        durationMs: nextDurationMs,
        autoClearDurationMs: nextAutoClearDurationMs,
      },
    });
    setStatusText('Overlay settings updated');
  }

  if (isOverlayEdit && !currentOverlay) {
    return <div className="text-sm text-tertiary">No overlay selected.</div>;
  }

  return (
    isOverlayEdit && currentOverlay ? (
      <>
        <Section.Root>
          <Section.Body>
            <FieldInput
              type="text"
              value={overlayNameDraft}
              onChange={handleOverlayNameChange}
              onBlur={handleOverlaySettingsBlur}
              label="Overlay Name"
              wide
              inputRef={nameInputRef}
            />
          </Section.Body>
        </Section.Root>

        <Section.Root>
          <Section.Header>
            <span>Transition</span>
          </Section.Header>
          <Section.Body>
            <Section.Row>
              <FieldSelect
                value={transitionKindDraft}
                onChange={handleTransitionKindChange}
                onBlur={handleOverlaySettingsBlur}
                options={TRANSITION_OPTIONS}
                label="Transition"
              />
              <FieldInput
                type="number"
                value={transitionDurationDraft}
                onChange={handleTransitionDurationChange}
                onBlur={handleOverlaySettingsBlur}
                min={0}
                step={50}
                label="Duration (ms)"
              />
            </Section.Row>
            <FieldInput
              type="number"
              value={autoClearDurationDraft}
              onChange={handleAutoClearDurationChange}
              onBlur={handleOverlaySettingsBlur}
              min={0}
              step={50}
              label="Auto Clear (ms)"
              wide
            />
            <p className="m-0 text-sm text-tertiary">
              Leave empty to keep the overlay on output until you clear it manually.
            </p>
          </Section.Body>
        </Section.Root>
      </>
    ) : null
  );
}

import { useEffect, useState } from 'react';
import type { OverlayAnimation } from '@lumacast/composition';
import { FieldInput, FieldSelect } from '../../../components/form/field';
import { useWorkbench } from '../../../contexts/workbench-context';

export function OverlaySettingsPanel() {
  const { state: { overlayDefaults }, actions: { updateOverlayDefaults } } = useWorkbench();
  const [durationDraft, setDurationDraft] = useState(String(overlayDefaults.durationMs));
  const [autoClearDraft, setAutoClearDraft] = useState(
    overlayDefaults.autoClearDurationMs == null ? '' : String(overlayDefaults.autoClearDurationMs),
  );

  useEffect(() => {
    setDurationDraft(String(overlayDefaults.durationMs));
    setAutoClearDraft(overlayDefaults.autoClearDurationMs == null ? '' : String(overlayDefaults.autoClearDurationMs));
  }, [overlayDefaults.autoClearDurationMs, overlayDefaults.durationMs]);

  function handleAnimationKindChange(value: string) {
    if (value === 'none' || value === 'dissolve' || value === 'fade' || value === 'pulse') {
      updateOverlayDefaults({ animationKind: value });
    }
  }

  function handleDurationBlur() {
    const parsed = Number(durationDraft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDurationDraft(String(overlayDefaults.durationMs));
      return;
    }
    updateOverlayDefaults({ durationMs: Math.round(parsed) });
  }

  function handleAutoClearBlur() {
    if (autoClearDraft.trim().length === 0) {
      updateOverlayDefaults({ autoClearDurationMs: null });
      return;
    }
    const parsed = Number(autoClearDraft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setAutoClearDraft(overlayDefaults.autoClearDurationMs == null ? '' : String(overlayDefaults.autoClearDurationMs));
      return;
    }
    updateOverlayDefaults({ autoClearDurationMs: Math.round(parsed) });
  }

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-primary">Overlay defaults</h2>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <FieldSelect label="Animation" value={overlayDefaults.animationKind} onChange={handleAnimationKindChange}>
          <FieldSelect.Option value={'none' satisfies OverlayAnimation['kind']}>None</FieldSelect.Option>
          <FieldSelect.Option value={'dissolve' satisfies OverlayAnimation['kind']}>Dissolve</FieldSelect.Option>
          <FieldSelect.Option value={'fade' satisfies OverlayAnimation['kind']}>Fade</FieldSelect.Option>
          <FieldSelect.Option value={'pulse' satisfies OverlayAnimation['kind']}>Pulse</FieldSelect.Option>
        </FieldSelect>
        <FieldInput type="number" label="Transition duration (ms)" value={durationDraft} onChange={setDurationDraft} onBlur={handleDurationBlur} />
        <FieldInput type="number" label="Auto-clear after (ms)" value={autoClearDraft} onChange={setAutoClearDraft} onBlur={handleAutoClearBlur} wide />
      </div>
    </section>
  );
}

import type { ClockFormat, TextBinding, TextBindingKind, TextElementPayload } from '@lumacast/composition';
import { Label } from '@renderer/components/display/text';
import { EmptyState } from '@renderer/components/display/empty-state';
import { ReacstButton } from '@renderer/components/controls/button';
import { FieldSelect } from '@renderer/components/form/field';
import { useElements } from '@renderer/contexts/canvas/canvas-context';
import { useTimers } from '@renderer/contexts/timers/timers-context';
import { Section } from './inspector-section';

export function BindingInspector() {
  const { selectedElement, elementPayloadDraft, setElementPayloadDraft } = useElements();
  const { timers, readings, createTimer } = useTimers();

  if (!selectedElement || !elementPayloadDraft || selectedElement.type !== 'text') {
    return (
      <EmptyState.Root>
        <EmptyState.Title>Select a text element to bind it to a live source.</EmptyState.Title>
      </EmptyState.Root>
    );
  }

  const textPayload = elementPayloadDraft as TextElementPayload;
  const binding = textPayload.binding;
  const selectedKind: TextBindingKind | 'none' = binding?.kind ?? 'none';

  function updateBinding(next: TextBinding | undefined) {
    setElementPayloadDraft({ ...textPayload, binding: next });
  }

  function handleKindChange(value: string) {
    if (value === 'none') return updateBinding(undefined);
    const kind = value as TextBindingKind;
    if (kind === 'timer') {
      updateBinding({ kind, timerId: binding?.kind === 'timer' ? binding.timerId : null });
      return;
    }
    if (kind === 'clock') {
      updateBinding({ kind, clockFormat: binding?.kind === 'clock' ? (binding.clockFormat ?? '12h') : '12h' });
      return;
    }
    updateBinding({ kind });
  }

  function handleTimerChange(value: string) {
    if (binding?.kind !== 'timer') return;
    updateBinding({ ...binding, timerId: value === '' ? null : value });
  }

  async function handleNewTimer() {
    if (binding?.kind !== 'timer') return;
    const created = await createTimer();
    if (created) updateBinding({ ...binding, timerId: created.id });
  }

  function handleClockFormatChange(value: string) {
    if (binding?.kind !== 'clock') return;
    updateBinding({ ...binding, clockFormat: value as ClockFormat });
  }

  const hasLinkedTimer = binding?.kind === 'timer' && Boolean(binding.timerId);
  const linkedReading = binding?.kind === 'timer' && binding.timerId ? readings[binding.timerId] : undefined;

  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <Section.Root>
        <Section.Header>
          <Label.xs>Link to</Label.xs>
        </Section.Header>
        <Section.Body>
          <FieldSelect value={selectedKind} onChange={handleKindChange}>
            <FieldSelect.Option value={'none' satisfies TextBindingKind | 'none'}>None (static text)</FieldSelect.Option>
            <FieldSelect.Option value={'timer' satisfies TextBindingKind}>Timer</FieldSelect.Option>
            <FieldSelect.Option value={'clock' satisfies TextBindingKind}>Clock (system time)</FieldSelect.Option>
            <FieldSelect.Option value={'current-slide-text' satisfies TextBindingKind}>Current slide text</FieldSelect.Option>
            <FieldSelect.Option value={'next-slide-text' satisfies TextBindingKind}>Next slide text</FieldSelect.Option>
            <FieldSelect.Option value={'slide-notes' satisfies TextBindingKind}>Slide notes</FieldSelect.Option>
          </FieldSelect>
        </Section.Body>
      </Section.Root>

      {binding?.kind === 'timer' && (
        <Section.Root>
          <Section.Header>
            <Label.xs>Timer</Label.xs>
          </Section.Header>
          <Section.Body>
            <FieldSelect value={binding.timerId ?? ''} onChange={handleTimerChange}>
              <FieldSelect.Option value="">Choose a timer</FieldSelect.Option>
              {timers.map((timer) => (
                <FieldSelect.Option key={timer.id} value={timer.id}>{timer.name}</FieldSelect.Option>
              ))}
            </FieldSelect>
            <Section.Row>
              {hasLinkedTimer && (
                <span className="min-w-0 flex-1 truncate font-mono text-sm tabular-nums text-secondary">
                  {linkedReading?.text ?? '--:--'}
                </span>
              )}
              <ReacstButton variant="ghost" onClick={() => { void handleNewTimer(); }} className={hasLinkedTimer ? 'shrink-0' : 'w-full'}>
                New timer
              </ReacstButton>
            </Section.Row>
          </Section.Body>
        </Section.Root>
      )}

      {binding?.kind === 'clock' && (
        <Section.Root>
          <Section.Header>
            <Label.xs>Clock format</Label.xs>
          </Section.Header>
          <Section.Body>
            <FieldSelect value={binding.clockFormat ?? '12h'} onChange={handleClockFormatChange}>
              <FieldSelect.Option value={'12h' satisfies ClockFormat}>12-hour (1:23 PM)</FieldSelect.Option>
              <FieldSelect.Option value={'12h-seconds' satisfies ClockFormat}>12-hour with seconds (1:23:45 PM)</FieldSelect.Option>
              <FieldSelect.Option value={'24h' satisfies ClockFormat}>24-hour (13:23)</FieldSelect.Option>
              <FieldSelect.Option value={'24h-seconds' satisfies ClockFormat}>24-hour with seconds (13:23:45)</FieldSelect.Option>
            </FieldSelect>
          </Section.Body>
        </Section.Root>
      )}

      {(binding?.kind === 'current-slide-text' || binding?.kind === 'next-slide-text' || binding?.kind === 'slide-notes') && (
        <Section.Root>
          <Section.Body>
            <p className="text-xs text-tertiary">
              This element will display the live value when the output is connected to a presentation. In the editor, a placeholder is shown.
            </p>
          </Section.Body>
        </Section.Root>
      )}
    </fieldset>
  );
}

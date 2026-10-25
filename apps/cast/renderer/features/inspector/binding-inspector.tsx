import type { ClockFormat, TextBinding, TextBindingKind, TextElementPayload } from '@lumacast/composition';
import { Label, EmptyState, ReacstButton, Select } from '@lumacast/ui';
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
          <Select value={selectedKind} onValueChange={handleKindChange} options={[{ value: 'none' satisfies TextBindingKind | 'none', label: 'None (static text)' }, { value: 'timer' satisfies TextBindingKind, label: 'Timer' }, { value: 'clock' satisfies TextBindingKind, label: 'Clock (system time)' }, { value: 'current-slide-text' satisfies TextBindingKind, label: 'Current slide text' }, { value: 'next-slide-text' satisfies TextBindingKind, label: 'Next slide text' }, { value: 'slide-notes' satisfies TextBindingKind, label: 'Slide notes' }]} className="w-full" />
        </Section.Body>
      </Section.Root>

      {binding?.kind === 'timer' && (
        <Section.Root>
          <Section.Header>
            <Label.xs>Timer</Label.xs>
          </Section.Header>
          <Section.Body>
            <Select value={binding.timerId ?? ''} onValueChange={handleTimerChange} options={[{ value: "", label: 'Choose a timer' }, ...timers.map((timer) => ({ value: timer.id, label: timer.name }))]} className="w-full" />
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
            <Select value={binding.clockFormat ?? '12h'} onValueChange={handleClockFormatChange} options={[{ value: '12h' satisfies ClockFormat, label: '12-hour (1:23 PM)' }, { value: '12h-seconds' satisfies ClockFormat, label: '12-hour with seconds (1:23:45 PM)' }, { value: '24h' satisfies ClockFormat, label: '24-hour (13:23)' }, { value: '24h-seconds' satisfies ClockFormat, label: '24-hour with seconds (13:23:45)' }]} className="w-full" />
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

import type { ClockFormat, TextBinding, TextBindingKind, TextElementPayload, TimerFormat } from '@core/types';
import { Label } from '@renderer/components/display/text';
import { EmptyState } from '@renderer/components/display/empty-state';
import { FieldInput, FieldSelect } from '@renderer/components/form/field';
import { useElements } from '@renderer/contexts/canvas/canvas-context';
import { parseNumber } from '@renderer/utils/slides';
import { Section } from './inspector-section';

const BINDING_OPTIONS: Array<{ value: TextBindingKind | 'none'; label: string }> = [
  { value: 'none', label: 'None (static text)' },
  { value: 'timer', label: 'Timer (countdown)' },
  { value: 'clock', label: 'Clock (system time)' },
  { value: 'current-slide-text', label: 'Current slide text' },
  { value: 'next-slide-text', label: 'Next slide text' },
  { value: 'slide-notes', label: 'Slide notes' },
];

const CLOCK_FORMAT_OPTIONS: Array<{ value: ClockFormat; label: string }> = [
  { value: '12h', label: '12-hour (1:23 PM)' },
  { value: '12h-seconds', label: '12-hour with seconds (1:23:45 PM)' },
  { value: '24h', label: '24-hour (13:23)' },
  { value: '24h-seconds', label: '24-hour with seconds (13:23:45)' },
];

const TIMER_FORMAT_OPTIONS: Array<{ value: TimerFormat; label: string }> = [
  { value: 'mm:ss', label: 'MM:SS' },
  { value: 'hh:mm:ss', label: 'HH:MM:SS' },
];

function clampSeconds(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function formatDurationParts(totalSeconds: number): { minutes: string; seconds: string } {
  const safe = clampSeconds(totalSeconds);
  return { minutes: String(Math.floor(safe / 60)), seconds: String(safe % 60) };
}

export function BindingInspector() {
  const { selectedElement, elementPayloadDraft, setElementPayloadDraft } = useElements();

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
      updateBinding({
        kind,
        timerDurationSeconds: binding?.timerDurationSeconds ?? 300,
        timerFormat: binding?.timerFormat ?? 'mm:ss',
      });
      return;
    }
    if (kind === 'clock') {
      updateBinding({ kind, clockFormat: binding?.clockFormat ?? '12h' });
      return;
    }
    updateBinding({ kind });
  }

  const duration = formatDurationParts(binding?.timerDurationSeconds ?? 0);

  function handleMinutesChange(value: string) {
    if (binding?.kind !== 'timer') return;
    const mins = clampSeconds(parseNumber(value, 0));
    const secs = clampSeconds(parseNumber(duration.seconds, 0));
    updateBinding({ ...binding, timerDurationSeconds: mins * 60 + secs });
  }

  function handleSecondsChange(value: string) {
    if (binding?.kind !== 'timer') return;
    const mins = clampSeconds(parseNumber(duration.minutes, 0));
    const rawSecs = clampSeconds(parseNumber(value, 0));
    const totalSecs = mins * 60 + rawSecs;
    updateBinding({ ...binding, timerDurationSeconds: totalSecs });
  }

  function handleTimerFormatChange(value: string) {
    if (binding?.kind !== 'timer') return;
    updateBinding({ ...binding, timerFormat: value as TimerFormat });
  }

  function handleClockFormatChange(value: string) {
    if (binding?.kind !== 'clock') return;
    updateBinding({ ...binding, clockFormat: value as ClockFormat });
  }

  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <Section.Root>
        <Section.Header>
          <Label.xs>Bind to</Label.xs>
        </Section.Header>
        <Section.Body>
          <FieldSelect value={selectedKind} onChange={handleKindChange} options={BINDING_OPTIONS} />
        </Section.Body>
      </Section.Root>

      {binding?.kind === 'timer' && (
        <Section.Root>
          <Section.Header>
            <Label.xs>Duration</Label.xs>
          </Section.Header>
          <Section.Body>
            <Section.Row>
              <FieldInput type="number" value={duration.minutes} onChange={handleMinutesChange} label="Minutes" min={0} />
              <FieldInput type="number" value={duration.seconds} onChange={handleSecondsChange} label="Seconds" min={0} max={59} />
            </Section.Row>
            <FieldSelect value={binding.timerFormat ?? 'mm:ss'} onChange={handleTimerFormatChange} options={TIMER_FORMAT_OPTIONS} />
          </Section.Body>
        </Section.Root>
      )}

      {binding?.kind === 'clock' && (
        <Section.Root>
          <Section.Header>
            <Label.xs>Clock format</Label.xs>
          </Section.Header>
          <Section.Body>
            <FieldSelect value={binding.clockFormat ?? '12h'} onChange={handleClockFormatChange} options={CLOCK_FORMAT_OPTIONS} />
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

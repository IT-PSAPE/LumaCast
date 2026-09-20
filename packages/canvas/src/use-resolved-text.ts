import { useEffect, useState } from 'react';
import { formatTimerSeconds, type ClockFormat, type TextBinding, type TextElementPayload, type TimerFormat } from '@lumacast/composition';
import { useBinding, type BindingOverride, type BindingValue } from './binding-context';

const PLACEHOLDER_CURRENT_SLIDE_TEXT = '[Current Slide]';
const PLACEHOLDER_NEXT_SLIDE_TEXT = '[Next Slide]';
const PLACEHOLDER_SLIDE_NOTES = '[Slide Notes]';

function pad(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/** @deprecated Delegates to `@lumacast/composition`'s `formatTimerSeconds`; kept so existing imports keep working. */
export function formatTimer(seconds: number, format: TimerFormat = 'mm:ss'): string {
  return formatTimerSeconds(Math.max(0, seconds), format);
}

export function formatClock(date: Date, format: ClockFormat = '12h'): string {
  const hours24 = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const showSeconds = format === '12h-seconds' || format === '24h-seconds';
  const use24h = format === '24h' || format === '24h-seconds';

  if (use24h) {
    const time = `${pad(hours24)}:${pad(minutes)}`;
    return showSeconds ? `${time}:${pad(seconds)}` : time;
  }

  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const time = `${hours12}:${pad(minutes)}`;
  return showSeconds ? `${time}:${pad(seconds)} ${period}` : `${time} ${period}`;
}

/** `useResolvedText`'s result: the text to draw, plus an optional colour override a threshold-active timer applies. */
export interface ResolvedText {
  text: string;
  /** Non-null only for a linked, threshold-active timer binding — the caller applies it in place of the element's own fill. */
  fill: string | null;
}

function resolveBindingValue(binding: TextBinding, fallback: string, runtime: BindingValue, now: Date): ResolvedText {
  if (binding.kind === 'clock') {
    return { text: formatClock(now, binding.clockFormat ?? '12h'), fill: null };
  }
  if (binding.kind === 'timer') {
    const reading = binding.timerId ? runtime.timerReadings[binding.timerId] : undefined;
    if (reading) return { text: reading.text, fill: reading.color };
    // Unlinked: legacy pre-timer-entity bindings still render their static
    // duration (migration v36 converts persisted rows, but an in-memory/import
    // path may still carry one); otherwise there is nothing to show.
    if (binding.timerDurationSeconds !== undefined) {
      return { text: formatTimerSeconds(binding.timerDurationSeconds, binding.timerFormat ?? 'mm:ss'), fill: null };
    }
    return { text: '--:--', fill: null };
  }
  if (binding.kind === 'current-slide-text') {
    if (runtime.currentSlideText !== null) return { text: runtime.currentSlideText, fill: null };
    return { text: fallback || PLACEHOLDER_CURRENT_SLIDE_TEXT, fill: null };
  }
  if (binding.kind === 'next-slide-text') {
    if (runtime.nextSlideText !== null) return { text: runtime.nextSlideText, fill: null };
    return { text: fallback || PLACEHOLDER_NEXT_SLIDE_TEXT, fill: null };
  }
  if (binding.kind === 'slide-notes') {
    if (runtime.slideNotes !== null) return { text: runtime.slideNotes, fill: null };
    return { text: fallback || PLACEHOLDER_SLIDE_NOTES, fill: null };
  }
  return { text: fallback, fill: null };
}

export function useResolvedText(
  payload: Pick<TextElementPayload, 'text' | 'binding'>,
  bindingOverride?: BindingOverride,
): ResolvedText {
  const baseRuntime = useBinding();
  const runtime: BindingValue = {
    ...baseRuntime,
    ...bindingOverride,
  };
  const binding = payload.binding;
  // Timer readings tick externally (the renderer's timers context recomputes
  // and passes down `timerReadings`); only the clock binding needs its own tick.
  const needsTick = binding?.kind === 'clock';
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    if (!needsTick) return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [needsTick]);

  if (!binding) return { text: payload.text ?? '', fill: null };
  return resolveBindingValue(binding, payload.text ?? '', runtime, now);
}

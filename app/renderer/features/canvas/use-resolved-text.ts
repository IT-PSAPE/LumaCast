import { useEffect, useState } from 'react';
import type { ClockFormat, TextBinding, TextElementPayload, TimerFormat } from '@core/types';
import { useBinding, type BindingOverride, type BindingValue } from './binding-context';

const PLACEHOLDER_CURRENT_SLIDE_TEXT = '[Current Slide]';
const PLACEHOLDER_NEXT_SLIDE_TEXT = '[Next Slide]';
const PLACEHOLDER_SLIDE_NOTES = '[Slide Notes]';

function pad(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

export function formatTimer(seconds: number, format: TimerFormat = 'mm:ss'): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  if (format === 'hh:mm:ss') return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  const totalMinutes = Math.floor(safe / 60);
  return `${pad(totalMinutes)}:${pad(secs)}`;
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

function resolveBindingText(binding: TextBinding, fallback: string, runtime: BindingValue, now: Date): string {
  if (binding.kind === 'clock') {
    return formatClock(now, binding.clockFormat ?? '12h');
  }
  if (binding.kind === 'timer') {
    const duration = binding.timerDurationSeconds ?? 0;
    const remaining = runtime.armedAtMs === null
      ? duration
      : Math.max(0, duration - Math.floor((now.getTime() - runtime.armedAtMs) / 1000));
    return formatTimer(remaining, binding.timerFormat ?? 'mm:ss');
  }
  if (binding.kind === 'current-slide-text') {
    if (runtime.currentSlideText !== null) return runtime.currentSlideText;
    return fallback || PLACEHOLDER_CURRENT_SLIDE_TEXT;
  }
  if (binding.kind === 'next-slide-text') {
    if (runtime.nextSlideText !== null) return runtime.nextSlideText;
    return fallback || PLACEHOLDER_NEXT_SLIDE_TEXT;
  }
  if (binding.kind === 'slide-notes') {
    if (runtime.slideNotes !== null) return runtime.slideNotes;
    return fallback || PLACEHOLDER_SLIDE_NOTES;
  }
  return fallback;
}

export function useResolvedText(
  payload: Pick<TextElementPayload, 'text' | 'binding'>,
  bindingOverride?: BindingOverride,
): string {
  const baseRuntime = useBinding();
  const runtime: BindingValue = {
    ...baseRuntime,
    ...bindingOverride,
  };
  const binding = payload.binding;
  const needsTick = binding?.kind === 'clock' || (binding?.kind === 'timer' && runtime.armedAtMs !== null);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    if (!needsTick) return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [needsTick]);

  if (!binding) return payload.text ?? '';
  return resolveBindingText(binding, payload.text ?? '', runtime, now);
}

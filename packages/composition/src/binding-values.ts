import type { Id } from '@lumacast/kernel';
import type { TimerReading } from './domain/timers';

export interface BindingValue {
  currentSlideText: string | null;
  nextSlideText: string | null;
  slideNotes: string | null;
  /** Live reading per linked `Timer` id, keyed by `Timer.id`. Computed by the renderer's timers context. */
  timerReadings: Readonly<Record<Id, TimerReading>>;
}

export type BindingOverride = Partial<BindingValue>;

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BindingValue, TextBinding } from '@lumacast/composition';
import { BindingProvider } from '../../../../packages/canvas/src/binding-context';
import { useResolvedText } from '../../../../packages/canvas/src/use-resolved-text';

const EMPTY_RUNTIME: BindingValue = {
  currentSlideText: null,
  nextSlideText: null,
  slideNotes: null,
  timerReadings: {},
};

function renderResolvedText(binding: TextBinding, runtime: BindingValue = EMPTY_RUNTIME, text = 'fallback') {
  return renderHook(() => useResolvedText({ text, binding }), {
    wrapper: ({ children }) => <BindingProvider value={runtime}>{children}</BindingProvider>,
  });
}

describe('useResolvedText — timer binding', () => {
  it('resolves the linked timer reading text', () => {
    const runtime: BindingValue = {
      ...EMPTY_RUNTIME,
      timerReadings: { 'timer-1': { seconds: 42, text: '00:42', phase: 'running', color: null } },
    };
    const { result } = renderResolvedText({ kind: 'timer', timerId: 'timer-1' }, runtime);

    expect(result.current).toEqual({ text: '00:42', fill: null });
  });

  it('surfaces the active threshold colour as a fill override', () => {
    const runtime: BindingValue = {
      ...EMPTY_RUNTIME,
      timerReadings: { 'timer-1': { seconds: 5, text: '00:05', phase: 'overrun', color: '#ff0000' } },
    };
    const { result } = renderResolvedText({ kind: 'timer', timerId: 'timer-1' }, runtime);

    expect(result.current).toEqual({ text: '00:05', fill: '#ff0000' });
  });

  it('renders "--:--" when linked to no timer and no reading is available', () => {
    const { result } = renderResolvedText({ kind: 'timer', timerId: 'timer-missing' });
    expect(result.current).toEqual({ text: '--:--', fill: null });
  });

  it('renders "--:--" when the binding carries no timerId at all', () => {
    const { result } = renderResolvedText({ kind: 'timer' });
    expect(result.current).toEqual({ text: '--:--', fill: null });
  });

  it('falls back to a static render of the legacy duration/format fields when unresolved', () => {
    const { result } = renderResolvedText({
      kind: 'timer',
      timerId: 'timer-missing',
      timerDurationSeconds: 125,
      timerFormat: 'mm:ss',
    });

    expect(result.current).toEqual({ text: '02:05', fill: null });
  });

  it('formats the legacy fallback with hh:mm:ss when specified', () => {
    const { result } = renderResolvedText({
      kind: 'timer',
      timerId: 'timer-missing',
      timerDurationSeconds: 3661,
      timerFormat: 'hh:mm:ss',
    });

    expect(result.current).toEqual({ text: '01:01:01', fill: null });
  });

  it('prefers the live reading over a legacy fallback once linked', () => {
    const runtime: BindingValue = {
      ...EMPTY_RUNTIME,
      timerReadings: { 'timer-1': { seconds: 9, text: '00:09', phase: 'running', color: null } },
    };
    const { result } = renderResolvedText({
      kind: 'timer',
      timerId: 'timer-1',
      timerDurationSeconds: 300,
      timerFormat: 'mm:ss',
    }, runtime);

    expect(result.current).toEqual({ text: '00:09', fill: null });
  });
});

describe('useResolvedText — non-timer bindings keep the fill null', () => {
  it('resolves a plain unbound element', () => {
    const { result } = renderHook(() => useResolvedText({ text: 'Hello', binding: undefined }), {
      wrapper: ({ children }) => <BindingProvider value={EMPTY_RUNTIME}>{children}</BindingProvider>,
    });
    expect(result.current).toEqual({ text: 'Hello', fill: null });
  });

  it('resolves current-slide-text with no fill override', () => {
    const runtime: BindingValue = { ...EMPTY_RUNTIME, currentSlideText: 'Live slide text' };
    const { result } = renderResolvedText({ kind: 'current-slide-text' }, runtime);
    expect(result.current).toEqual({ text: 'Live slide text', fill: null });
  });
});

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SlideElement, TextElementPayload, Timer } from '@lumacast/composition';

const mocks = vi.hoisted(() => ({
  elements: {
    selectedElement: null as SlideElement | null,
    elementPayloadDraft: null as unknown,
    setElementPayloadDraft: vi.fn(),
  },
  timers: [] as Timer[],
  readings: {} as Record<string, { seconds: number; text: string; phase: string; color: string | null }>,
  createTimer: vi.fn(),
}));

vi.mock('@renderer/contexts/canvas/canvas-context', () => ({
  useElements: () => mocks.elements,
}));

vi.mock('@renderer/contexts/timers/timers-context', () => ({
  useTimers: () => ({
    timers: mocks.timers,
    timersById: new Map(mocks.timers.map((timer) => [timer.id, timer])),
    runStates: {},
    readings: mocks.readings,
    createTimer: mocks.createTimer,
    updateTimer: vi.fn(),
    deleteTimer: vi.fn(),
    duplicateTimer: vi.fn(),
    start: vi.fn(),
    pause: vi.fn(),
    toggle: vi.fn(),
    reset: vi.fn(),
    startAll: vi.fn(),
    pauseAll: vi.fn(),
    resetAll: vi.fn(),
  }),
}));

// FieldSelect's real popup needs the workbench overlay stack (see
// shape-element-inspector.test.tsx / text-element-inspector.test.tsx for the
// same substitution): stub it to a native <select> for plain fireEvent.change.
vi.mock('@renderer/components/form/field', async () => {
  const actual = await vi.importActual<typeof import('@renderer/components/form/field')>('@renderer/components/form/field');
  function FieldSelectStub({ value, onChange, children }: { value: string; onChange: (value: string) => void; children?: ReactNode }) {
    return (
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    );
  }
  function FieldSelectOptionStub({ value, children }: { value: string; children?: ReactNode }) {
    return <option value={value}>{children}</option>;
  }
  return { ...actual, FieldSelect: Object.assign(FieldSelectStub, { Option: FieldSelectOptionStub }) };
});

import { BindingInspector } from '@renderer/features/inspector/binding-inspector';

function textPayload(overrides: Partial<TextElementPayload> = {}): TextElementPayload {
  return { text: 'Hello', fontFamily: 'Inter', fontSize: 32, color: '#ffffff', alignment: 'left', lineHeight: 1.25, ...overrides };
}

function selectText(payload: TextElementPayload) {
  mocks.elements.selectedElement = { id: 'el-1', slideId: 'slide-1', type: 'text' } as SlideElement;
  mocks.elements.elementPayloadDraft = payload;
}

function makeTimer(overrides: Partial<Timer> = {}): Timer {
  return {
    id: 'timer-1',
    name: 'Countdown',
    kind: 'countdown',
    durationSeconds: 300,
    targetTime: null,
    elapsedStartSeconds: 0,
    elapsedEndSeconds: null,
    allowOverrun: false,
    format: 'mm:ss',
    thresholds: [],
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.elements.selectedElement = null;
  mocks.elements.elementPayloadDraft = null;
  mocks.timers = [];
  mocks.readings = {};
});

afterEach(() => {
  cleanup();
});

describe('BindingInspector', () => {
  it('shows an empty state when no text element is selected', () => {
    render(<BindingInspector />);
    expect(screen.getByText('Select a text element to bind it to a live source.')).not.toBeNull();
  });

  it('labels the kind picker "Link to"', () => {
    selectText(textPayload());
    render(<BindingInspector />);
    expect(screen.getByText('Link to')).not.toBeNull();
  });

  it('selecting "timer" links no timer yet', () => {
    selectText(textPayload());
    render(<BindingInspector />);

    const [kindSelect] = screen.getAllByRole('combobox');
    fireEvent.change(kindSelect, { target: { value: 'timer' } });

    expect(mocks.elements.setElementPayloadDraft).toHaveBeenCalledWith(
      expect.objectContaining({ binding: { kind: 'timer', timerId: null } }),
    );
  });

  it('lists timers by name and links the chosen one', () => {
    mocks.timers = [makeTimer({ id: 't1', name: 'Countdown' }), makeTimer({ id: 't2', name: 'Service clock' })];
    selectText(textPayload({ binding: { kind: 'timer', timerId: null } }));
    render(<BindingInspector />);

    expect(screen.getByText('Countdown')).not.toBeNull();
    expect(screen.getByText('Service clock')).not.toBeNull();

    const [, timerSelect] = screen.getAllByRole('combobox');
    fireEvent.change(timerSelect, { target: { value: 't2' } });

    expect(mocks.elements.setElementPayloadDraft).toHaveBeenCalledWith(
      expect.objectContaining({ binding: { kind: 'timer', timerId: 't2' } }),
    );
  });

  it('shows the linked timer\'s live reading', () => {
    mocks.timers = [makeTimer({ id: 't1', name: 'Countdown' })];
    mocks.readings = { t1: { seconds: 45, text: '00:45', phase: 'running', color: null } };
    selectText(textPayload({ binding: { kind: 'timer', timerId: 't1' } }));
    render(<BindingInspector />);

    expect(screen.getByText('00:45')).not.toBeNull();
  });

  it('does not show a reading and gives "New timer" full width when no timer is linked yet', () => {
    selectText(textPayload({ binding: { kind: 'timer', timerId: null } }));
    render(<BindingInspector />);
    const newTimerButton = screen.getByRole('button', { name: 'New timer' });
    expect(newTimerButton.className).toContain('w-full');
  });

  it('"New timer" creates and links a timer', async () => {
    const created = makeTimer({ id: 't-new', name: 'Timer 2' });
    mocks.createTimer.mockResolvedValue(created);
    selectText(textPayload({ binding: { kind: 'timer', timerId: null } }));
    render(<BindingInspector />);

    fireEvent.click(screen.getByRole('button', { name: 'New timer' }));

    await waitFor(() => {
      expect(mocks.elements.setElementPayloadDraft).toHaveBeenCalledWith(
        expect.objectContaining({ binding: { kind: 'timer', timerId: 't-new' } }),
      );
    });
    expect(mocks.createTimer).toHaveBeenCalledTimes(1);
  });

  it('keeps the clock format picker for kind "clock"', () => {
    selectText(textPayload({ binding: { kind: 'clock', clockFormat: '24h' } }));
    render(<BindingInspector />);
    expect(screen.getByText('Clock format')).not.toBeNull();
  });
});

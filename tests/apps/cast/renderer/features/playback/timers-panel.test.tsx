import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Timer } from '@lumacast/composition';

const mocks = vi.hoisted(() => ({
  timers: [] as Timer[],
  runStates: {} as Record<string, { status: 'idle' | 'running' | 'paused'; startedAtMs: number | null; accumulatedMs: number }>,
  readings: {} as Record<string, { seconds: number; text: string; phase: string; color: string | null }>,
  createTimer: vi.fn(),
  updateTimer: vi.fn(),
  deleteTimer: vi.fn(),
  duplicateTimer: vi.fn(),
  toggle: vi.fn(),
  reset: vi.fn(),
  pauseAll: vi.fn(),
  resetAll: vi.fn(),
  confirmDelete: vi.fn(),
}));

vi.mock('@renderer/contexts/timers/timers-context', () => ({
  useTimers: () => ({
    timers: mocks.timers,
    timersById: new Map(mocks.timers.map((timer) => [timer.id, timer])),
    runStates: mocks.runStates,
    readings: mocks.readings,
    createTimer: mocks.createTimer,
    updateTimer: mocks.updateTimer,
    deleteTimer: mocks.deleteTimer,
    duplicateTimer: mocks.duplicateTimer,
    start: vi.fn(),
    pause: vi.fn(),
    toggle: mocks.toggle,
    reset: mocks.reset,
    startAll: vi.fn(),
    pauseAll: mocks.pauseAll,
    resetAll: mocks.resetAll,
  }),
}));

vi.mock('@renderer/components/controls/bin-controls', () => ({
  useBinControls: () => ({
    state: { searchValue: '', viewMode: 'list', grid: null },
    actions: { onSearchChange: vi.fn(), onViewModeChange: vi.fn() },
  }),
}));

vi.mock('@renderer/components/overlays/confirm-dialog', () => ({
  useConfirmDelete: () => mocks.confirmDelete,
}));

vi.mock('@renderer/contexts/workbench-context', () => ({
  useWorkbench: () => ({
    state: {},
    actions: {},
    overlayStack: { register: vi.fn(), unregister: vi.fn(), stack: [] as string[], baseZIndex: 100, rootElement: undefined },
  }),
}));

// Right-click/kebab row menu (Duplicate/Delete) isn't part of this panel's
// required behavior coverage — stubbed the same way sibling row tests do
// (see stage-list-item-body.test.tsx) so rendering a row doesn't need the
// real Base UI Menu/portal machinery.
vi.mock('@renderer/components/overlays/context-menu', () => ({
  useContextMenuTrigger: () => ({ ref: vi.fn(), onContextMenu: vi.fn() }),
  ContextMenu: {
    Root: ({ children }: { children: ReactNode }) => <>{children}</>,
    Portal: ({ children }: { children: ReactNode }) => <>{children}</>,
    Menu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Item: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
      <button type="button" onClick={onSelect}>{children}</button>
    ),
    Separator: () => <hr />,
  },
}));

// FieldSelect's real popup needs the workbench overlay stack and floating-ui
// positioning; stubbed to a native <select> so kind/format changes are plain
// fireEvent.change, matching text-element-inspector.test.tsx's approach.
vi.mock('@renderer/components/form/field', async () => {
  const actual = await vi.importActual<typeof import('@renderer/components/form/field')>('@renderer/components/form/field');
  function FieldSelectStub({ value, onChange, children, label }: { value: string; onChange: (value: string) => void; children?: ReactNode; label?: string }) {
    return (
      <label>
        {label}
        <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
          {children}
        </select>
      </label>
    );
  }
  function FieldSelectOptionStub({ value, children }: { value: string; children?: ReactNode }) {
    return <option value={value}>{children}</option>;
  }
  return { ...actual, FieldSelect: Object.assign(FieldSelectStub, { Option: FieldSelectOptionStub }) };
});

import { TimersPanel } from '@renderer/features/playback/timers-panel';

function makeTimer(overrides: Partial<Timer> = {}): Timer {
  return {
    id: 'timer-1',
    name: 'Timer A',
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
  mocks.timers = [];
  mocks.runStates = {};
  mocks.readings = {};
  mocks.confirmDelete.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
});

describe('TimersPanel empty state', () => {
  it('shows a single line and keeps the add button reachable', () => {
    render(<TimersPanel />);
    expect(screen.getByText('No timers yet.')).not.toBeNull();
    expect(screen.getByLabelText('Add timer')).not.toBeNull();
  });
});

describe('TimersPanel rows', () => {
  it('renders one row per timer with its name and readout', () => {
    mocks.timers = [makeTimer({ id: 't1', name: 'Countdown' }), makeTimer({ id: 't2', name: 'Stopwatch', kind: 'elapsed' })];
    mocks.readings = {
      t1: { seconds: 299, text: '04:59', phase: 'running', color: null },
      t2: { seconds: 12, text: '00:12', phase: 'running', color: null },
    };
    render(<TimersPanel />);

    // Each row's settings panel (including its own Kind select) stays mounted
    // even while collapsed, so a timer named after its own kind ("Countdown")
    // would otherwise match twice in the whole document. Scope the name
    // lookup to each row's always-visible summary strip, which excludes the
    // collapsible settings panel entirely.
    const rows = screen.getAllByRole('button', { name: 'Toggle timer settings' })
      .map((toggle) => toggle.closest('div') as HTMLElement);
    expect(within(rows[0]).getByDisplayValue('Countdown')).not.toBeNull();
    expect(within(rows[1]).getByDisplayValue('Stopwatch')).not.toBeNull();
    expect(screen.getByText('04:59')).not.toBeNull();
    expect(screen.getByText('00:12')).not.toBeNull();
  });

  it('falls back to a placeholder readout when no reading exists yet', () => {
    mocks.timers = [makeTimer()];
    render(<TimersPanel />);
    expect(screen.getByText('--:--')).not.toBeNull();
  });
});

describe('TimersPanel readout emphasis', () => {
  it('dims the readout when idle', () => {
    mocks.timers = [makeTimer()];
    mocks.readings = { 'timer-1': { seconds: 300, text: '05:00', phase: 'idle', color: null } };
    render(<TimersPanel />);
    expect(screen.getByText('05:00').className).toContain('text-tertiary');
  });

  it('gives overrun/finished a distinct emphasis', () => {
    mocks.timers = [makeTimer()];
    mocks.readings = { 'timer-1': { seconds: -5, text: '-00:05', phase: 'overrun', color: null } };
    render(<TimersPanel />);
    const readout = screen.getByText('-00:05');
    expect(readout.className).toContain('text-error');
    expect(readout.className).toContain('font-semibold');
  });

  it('applies the threshold colour and overrides phase-based emphasis', () => {
    mocks.timers = [makeTimer()];
    mocks.readings = { 'timer-1': { seconds: 5, text: '00:05', phase: 'running', color: '#ff9900' } };
    render(<TimersPanel />);
    const readout = screen.getByText('00:05');
    expect(readout.style.color).toBe('rgb(255, 153, 0)');
  });
});

describe('TimersPanel start/pause + reset', () => {
  it('shows Start when idle and calls toggle with the timer id', () => {
    mocks.timers = [makeTimer({ id: 't1' })];
    render(<TimersPanel />);
    fireEvent.click(screen.getByLabelText('Start'));
    expect(mocks.toggle).toHaveBeenCalledWith('t1');
  });

  it('shows Pause when running and calls toggle with the timer id', () => {
    mocks.timers = [makeTimer({ id: 't1' })];
    mocks.runStates = { t1: { status: 'running', startedAtMs: 0, accumulatedMs: 0 } };
    render(<TimersPanel />);
    fireEvent.click(screen.getByLabelText('Pause'));
    expect(mocks.toggle).toHaveBeenCalledWith('t1');
  });

  it('disables the toggle for a countdown-to-time timer', () => {
    mocks.timers = [makeTimer({ id: 't1', kind: 'countdown-to-time', targetTime: '18:00' })];
    render(<TimersPanel />);
    expect(screen.getByLabelText('Start')).toHaveProperty('disabled', true);
  });

  it('calls reset with the timer id', () => {
    mocks.timers = [makeTimer({ id: 't1' })];
    render(<TimersPanel />);
    fireEvent.click(screen.getByLabelText('Reset'));
    expect(mocks.reset).toHaveBeenCalledWith('t1');
  });
});

describe('TimersPanel header', () => {
  it('calls createTimer from the add button', () => {
    render(<TimersPanel />);
    fireEvent.click(screen.getByLabelText('Add timer'));
    expect(mocks.createTimer).toHaveBeenCalledTimes(1);
  });
});

describe('TimersPanel rename', () => {
  it('commits a new name through updateTimer on blur', () => {
    mocks.timers = [makeTimer({ id: 't1', name: 'Old name' })];
    render(<TimersPanel />);

    const input = screen.getByDisplayValue('Old name');
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: 'New name' } });
    fireEvent.blur(input);

    expect(mocks.updateTimer).toHaveBeenCalledWith('t1', { name: 'New name' });
  });
});

function openRowConfig(rowIndex = 0) {
  const toggles = screen.getAllByLabelText('Toggle timer settings');
  fireEvent.click(toggles[rowIndex]);
}

describe('TimersPanel thresholds', () => {
  it('adds a threshold', () => {
    mocks.timers = [makeTimer({ id: 't1', thresholds: [] })];
    render(<TimersPanel />);
    openRowConfig();

    fireEvent.click(screen.getByRole('button', { name: 'Add threshold' }));

    expect(mocks.updateTimer).toHaveBeenCalledWith('t1', {
      thresholds: [expect.objectContaining({ atSeconds: 30, color: '#facc15' })],
    });
  });

  it('removes a threshold', () => {
    mocks.timers = [makeTimer({
      id: 't1',
      thresholds: [
        { id: 'a', atSeconds: 10, color: '#111111' },
        { id: 'b', atSeconds: 20, color: '#222222' },
      ],
    })];
    render(<TimersPanel />);
    openRowConfig();

    const removeButtons = screen.getAllByLabelText('Remove threshold');
    fireEvent.click(removeButtons[0]);

    expect(mocks.updateTimer).toHaveBeenCalledWith('t1', {
      thresholds: [{ id: 'b', atSeconds: 20, color: '#222222' }],
    });
  });

  it('keeps thresholds sorted by atSeconds after an edit', () => {
    mocks.timers = [makeTimer({
      id: 't1',
      thresholds: [
        { id: 'a', atSeconds: 60, color: '#111111' },
        { id: 'b', atSeconds: 10, color: '#222222' },
      ],
    })];
    render(<TimersPanel />);
    openRowConfig();

    // "a" is the 1:00 row; editing it to 0:05 should move it before "b" (0:10).
    const input = screen.getByDisplayValue('1:00');
    fireEvent.change(input, { target: { value: '0:05' } });
    fireEvent.blur(input);

    expect(mocks.updateTimer).toHaveBeenCalledWith('t1', {
      thresholds: [
        { id: 'a', atSeconds: 5, color: '#111111' },
        { id: 'b', atSeconds: 10, color: '#222222' },
      ],
    });
  });
});

describe('TimersPanel duration field', () => {
  it('commits a parsed duration on blur, not on every keystroke', () => {
    mocks.timers = [makeTimer({ id: 't1', durationSeconds: 300 })];
    render(<TimersPanel />);
    openRowConfig();

    const input = screen.getByLabelText('Duration');
    fireEvent.change(input, { target: { value: '1:05:00' } });
    expect(mocks.updateTimer).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(mocks.updateTimer).toHaveBeenCalledWith('t1', { durationSeconds: 3900 });
  });

  it('reverts an unparsable draft instead of committing', () => {
    mocks.timers = [makeTimer({ id: 't1', durationSeconds: 300 })];
    render(<TimersPanel />);
    openRowConfig();

    const input = screen.getByLabelText('Duration');
    fireEvent.change(input, { target: { value: 'not a duration' } });
    fireEvent.blur(input);

    expect(mocks.updateTimer).not.toHaveBeenCalled();
    expect(input).toHaveValue('5:00');
  });
});

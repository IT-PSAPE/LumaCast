import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useWorkbenchPanelLayout } from '../../../../../../../apps/cast/renderer/components/layout/panel-split/use-workbench-panel-layout';
import type {
  SplitDefinition,
  SplitLayoutState,
} from '../../../../../../../apps/cast/renderer/components/layout/panel-split/workbench-panel-layout';

// The storage key and version are module-private; they are pinned here on purpose so a change is loud.
const STORAGE_KEY = 'lumacast.workbench-layout.v1';
const STORAGE_VERSION = 3;

const def: SplitDefinition = {
  id: 'main',
  orientation: 'horizontal',
  paneOrder: ['left', 'mid', 'right'],
  fillPaneId: 'mid',
  panes: {
    left: { id: 'left', defaultSize: 200, minSize: 100, maxSize: 300, collapsible: true, snap: true },
    mid: { id: 'mid', defaultSize: 400, minSize: 100, maxSize: 2000, collapsible: false, snap: false },
    right: { id: 'right', defaultSize: 200, minSize: 100, maxSize: 300, collapsible: true, snap: true },
  },
};
const p = (size: number, visible = true, lastVisibleSize = size) => ({ size, visible, lastVisibleSize });
const stored = (): { version: number; layouts: Record<string, SplitLayoutState> } | null => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
};
const seed = (payload: unknown) => window.localStorage.setItem(STORAGE_KEY, typeof payload === 'string' ? payload : JSON.stringify(payload));
const defaults = { left: p(200), mid: p(400), right: p(200) };

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('hydration', () => {
  it('hydrates a valid {version: 3, layouts} payload into liveLayouts and committedLayouts', () => {
    const layouts = { main: { panes: { left: p(0, false, 250), mid: p(500), right: p(150) } } };
    seed({ version: STORAGE_VERSION, layouts });
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    expect(result.current.liveLayouts).toEqual(layouts);
    expect(result.current.committedLayouts).toEqual(layouts);
    expect(result.current.getSplitLayout(def).panes).toEqual(layouts.main.panes);
    expect(result.current.isPanelVisible('main', 'left')).toBe(false);
    expect(result.current.isPanelVisible('main', 'right')).toBe(true);
  });

  it('hydration alone does not write to storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderHook(() => useWorkbenchPanelLayout());
    expect(setItem).not.toHaveBeenCalled();
  });

  it('coerces hydrated sizes into the definition bounds on read', () => {
    seed({ version: STORAGE_VERSION, layouts: { main: { panes: { left: p(9999), mid: p(5), right: p(200) } } } });
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    expect(result.current.getSplitLayout(def).panes).toEqual({ left: p(300), mid: p(100), right: p(200) });
  });

  it('an unknown split id resolves to the default layout', () => {
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    expect(result.current.getSplitLayout(def).panes).toEqual(defaults);
  });

  it('isPanelVisible is true for an unknown split or pane', () => {
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    expect(result.current.isPanelVisible('nope', 'nope')).toBe(true);
  });
});

describe('silent reset to defaults (no throw, no warning, stale payload left in storage)', () => {
  const cases: Array<[string, () => void]> = [
    ['absent key', () => undefined],
    ['version 2', () => seed({ version: 2, layouts: { main: { panes: defaults } } })],
    ['version 4 (newer)', () => seed({ version: 4, layouts: { main: { panes: defaults } } })],
    ['missing version', () => seed({ layouts: { main: { panes: defaults } } })],
    ['malformed JSON', () => seed('{not json')],
    ['empty string', () => seed('')],
    ['JSON null', () => seed('null')],
    ['layouts not an object', () => seed({ version: STORAGE_VERSION, layouts: 'x' })],
    ['layouts null', () => seed({ version: STORAGE_VERSION, layouts: null })],
    ['split without panes', () => seed({ version: STORAGE_VERSION, layouts: { main: {} } })],
    ['pane with string size', () => seed({ version: STORAGE_VERSION, layouts: { main: { panes: { left: { size: '1', visible: true, lastVisibleSize: 1 } } } } })],
    ['pane missing visible', () => seed({ version: STORAGE_VERSION, layouts: { main: { panes: { left: { size: 1, lastVisibleSize: 1 } } } } })],
    ['pane missing lastVisibleSize', () => seed({ version: STORAGE_VERSION, layouts: { main: { panes: { left: { size: 1, visible: true } } } } })],
    ['pane null', () => seed({ version: STORAGE_VERSION, layouts: { main: { panes: { left: null } } } })],
  ];

  it.each(cases)('%s -> empty layouts, defaults on resolve, never throws', (_name, arrange) => {
    arrange();
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    expect(result.current.liveLayouts).toEqual({});
    expect(result.current.committedLayouts).toEqual({});
    expect(result.current.getSplitLayout(def).panes).toEqual(defaults);
  });

  it('one invalid split discards ALL splits, including valid ones (all-or-nothing)', () => {
    seed({
      version: STORAGE_VERSION,
      layouts: {
        good: { panes: { left: p(250) } },
        bad: { panes: { left: { size: 'x', visible: true, lastVisibleSize: 1 } } },
      },
    });
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    expect(result.current.liveLayouts).toEqual({});
  });

  it('a version mismatch leaves the stale payload in storage until the next write replaces it', () => {
    const stale = { version: 2, layouts: { main: { panes: { left: p(0, false, 250), mid: p(500), right: p(150) } } } };
    seed(stale);
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    expect(stored()).toEqual(stale);

    act(() => result.current.registerSplit(def));
    act(() => result.current.togglePanel('main', 'left'));
    expect(stored()?.version).toBe(STORAGE_VERSION);
    expect(stored()?.layouts.main.panes.right).toEqual(defaults.right);
  });

  it('PINNED HAZARD: persisted user layout from version 2 is dropped with no migration', () => {
    seed({ version: 2, layouts: { main: { panes: { left: p(0, false, 250), mid: p(500), right: p(150) } } } });
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    expect(result.current.getSplitLayout(def).panes.left.visible).toBe(true);
    expect(result.current.getSplitLayout(def).panes.right.size).toBe(200);
  });

  it('an empty layouts object is valid and hydrates as {}', () => {
    seed({ version: STORAGE_VERSION, layouts: {} });
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    expect(result.current.liveLayouts).toEqual({});
  });

  it('a split with empty panes passes validation and then resolves to defaults per pane', () => {
    seed({ version: STORAGE_VERSION, layouts: { main: { panes: {} } } });
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    expect(result.current.liveLayouts).toEqual({ main: { panes: {} } });
    expect(result.current.getSplitLayout(def).panes).toEqual(defaults);
  });

  it('a throwing localStorage.getItem is swallowed', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    expect(result.current.liveLayouts).toEqual({});
  });
});

describe('persistence writes', () => {
  it('writes exactly {version: STORAGE_VERSION, layouts} under the key', () => {
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.registerSplit(def));
    act(() => result.current.togglePanel('main', 'left'));
    const payload = stored();
    expect(Object.keys(payload!).sort()).toEqual(['layouts', 'version']);
    expect(payload).toEqual({
      version: 3,
      layouts: { main: { panes: { left: { size: 0, visible: false, lastVisibleSize: 200 }, mid: p(400), right: p(200) } } },
    });
  });

  it('round-trips: what one hook instance persists, a fresh instance hydrates', () => {
    const first = renderHook(() => useWorkbenchPanelLayout());
    act(() => first.result.current.registerSplit(def));
    act(() => first.result.current.togglePanel('main', 'right'));
    const persisted = stored()!.layouts;
    first.unmount();

    const second = renderHook(() => useWorkbenchPanelLayout());
    expect(second.result.current.committedLayouts).toEqual(persisted);
    expect(second.result.current.isPanelVisible('main', 'right')).toBe(false);
  });

  it('a throwing localStorage.setItem propagates out of the action (no try/catch around writes)', () => {
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.registerSplit(def));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => act(() => result.current.togglePanel('main', 'left'))).toThrow('quota');
  });
});

describe('togglePanel', () => {
  it('flips visible, zeroes size, keeps lastVisibleSize, and persists; toggling back restores', () => {
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.registerSplit(def));

    act(() => result.current.togglePanel('main', 'left'));
    expect(result.current.committedLayouts.main.panes.left).toEqual({ size: 0, visible: false, lastVisibleSize: 200 });
    expect(result.current.liveLayouts.main.panes.left).toEqual({ size: 0, visible: false, lastVisibleSize: 200 });
    expect(result.current.isPanelVisible('main', 'left')).toBe(false);
    expect(stored()!.layouts.main.panes.left).toEqual({ size: 0, visible: false, lastVisibleSize: 200 });

    act(() => result.current.togglePanel('main', 'left'));
    expect(result.current.committedLayouts.main.panes.left).toEqual(p(200));
    expect(stored()!.layouts.main.panes.left).toEqual(p(200));
  });

  it('restores a customised lastVisibleSize rather than the default', () => {
    seed({ version: STORAGE_VERSION, layouts: { main: { panes: { left: p(0, false, 275), mid: p(400), right: p(200) } } } });
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.registerSplit(def));
    act(() => result.current.togglePanel('main', 'left'));
    expect(result.current.committedLayouts.main.panes.left).toEqual(p(275));
  });

  it('is a no-op (no write) for an unregistered split or unknown pane', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.togglePanel('main', 'left'));
    act(() => result.current.registerSplit(def));
    act(() => result.current.togglePanel('main', 'ghost'));
    expect(setItem).not.toHaveBeenCalled();
    expect(result.current.committedLayouts).toEqual({});
  });

  it('on a non-collapsible pane it changes nothing but still persists a write', () => {
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.registerSplit(def));
    act(() => result.current.togglePanel('main', 'mid'));
    expect(result.current.committedLayouts.main.panes).toEqual(defaults);
    expect(stored()!.layouts.main.panes).toEqual(defaults);
  });

  it('cancels an in-flight drag session', () => {
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.startDrag({ definition: def, handleIndex: 0, pointerPosition: 0, paneSizes: { left: 200, mid: 400, right: 200 } }));
    act(() => result.current.togglePanel('main', 'right'));
    act(() => result.current.updateDrag({ definition: def, pointerPosition: -50 }));
    expect(result.current.liveLayouts.main.panes.left.size).toBe(200);
  });
});

describe('drag lifecycle', () => {
  const measured = { left: 200, mid: 400, right: 200 };

  it('startDrag applies measured sizes to liveLayouts only, with nothing committed or persisted', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.startDrag({ definition: def, handleIndex: 0, pointerPosition: 100, paneSizes: { left: 220, mid: 380, right: 200 } }));
    expect(result.current.liveLayouts.main.panes.left).toEqual(p(220));
    expect(result.current.committedLayouts).toEqual({});
    expect(setItem).not.toHaveBeenCalled();
  });

  it('updateDrag resizes live from the pointer delta relative to the start; endDrag commits and persists', () => {
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.startDrag({ definition: def, handleIndex: 0, pointerPosition: 100, paneSizes: measured }));
    act(() => result.current.updateDrag({ definition: def, pointerPosition: 150 }));
    expect(result.current.liveLayouts.main.panes.left.size).toBe(250);
    expect(result.current.liveLayouts.main.panes.mid.size).toBe(350);
    expect(result.current.committedLayouts).toEqual({});
    expect(stored()).toBeNull();

    act(() => result.current.endDrag({ splitId: 'main' }));
    expect(result.current.committedLayouts.main.panes.left).toEqual(p(250));
    expect(stored()!.layouts.main.panes.left).toEqual(p(250));
  });

  it('updateDrag is always relative to the start layout, not cumulative', () => {
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.startDrag({ definition: def, handleIndex: 0, pointerPosition: 0, paneSizes: measured }));
    act(() => result.current.updateDrag({ definition: def, pointerPosition: 50 }));
    act(() => result.current.updateDrag({ definition: def, pointerPosition: 20 }));
    expect(result.current.liveLayouts.main.panes.left.size).toBe(220);
  });

  it('dragging below half of minSize collapses and commits size 0 with lastVisibleSize retained; dragging back re-expands', () => {
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.startDrag({ definition: def, handleIndex: 0, pointerPosition: 0, paneSizes: measured }));
    act(() => result.current.updateDrag({ definition: def, pointerPosition: -200 }));
    expect(result.current.liveLayouts.main.panes.left).toEqual({ size: 0, visible: false, lastVisibleSize: 200 });
    act(() => result.current.updateDrag({ definition: def, pointerPosition: -50 }));
    expect(result.current.liveLayouts.main.panes.left.visible).toBe(true);
    act(() => result.current.updateDrag({ definition: def, pointerPosition: -200 }));
    act(() => result.current.endDrag({ splitId: 'main' }));
    expect(stored()!.layouts.main.panes.left).toEqual({ size: 0, visible: false, lastVisibleSize: 200 });
    expect(result.current.isPanelVisible('main', 'left')).toBe(false);
  });

  it('updateDrag and endDrag are ignored without a session or for a different split', () => {
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.updateDrag({ definition: def, pointerPosition: 50 }));
    act(() => result.current.endDrag({ splitId: 'main' }));
    expect(result.current.liveLayouts).toEqual({});
    expect(stored()).toBeNull();

    act(() => result.current.startDrag({ definition: def, handleIndex: 0, pointerPosition: 0, paneSizes: measured }));
    act(() => result.current.updateDrag({ definition: { ...def, id: 'other' }, pointerPosition: 50 }));
    expect(result.current.liveLayouts.main.panes.left.size).toBe(200);
    act(() => result.current.endDrag({ splitId: 'other' }));
    expect(stored()).toBeNull();
  });

  it('endDrag ends the session: further updates are ignored', () => {
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.startDrag({ definition: def, handleIndex: 0, pointerPosition: 0, paneSizes: measured }));
    act(() => result.current.endDrag({ splitId: 'main' }));
    act(() => result.current.updateDrag({ definition: def, pointerPosition: 80 }));
    expect(result.current.liveLayouts.main.panes.left.size).toBe(200);
  });
});

describe('syncToContainer', () => {
  it('rewrites stored sizes so visible panes sum to the container, and persists the result', () => {
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.syncToContainer({ definition: def, size: 1000 }));
    const panes = result.current.committedLayouts.main.panes;
    expect(panes.left.size + panes.mid.size + panes.right.size).toBe(1000);
    expect(panes).toEqual({ left: p(200), mid: p(600), right: p(200) });
    expect(result.current.liveLayouts.main.panes).toEqual(panes);
    expect(stored()).toEqual({ version: 3, layouts: { main: { panes } } });
  });

  it('shrinks to a smaller container and persists', () => {
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.syncToContainer({ definition: def, size: 600 }));
    expect(stored()!.layouts.main.panes).toEqual({ left: p(200), mid: p(200), right: p(200) });
  });

  it('only counts visible panes', () => {
    seed({ version: STORAGE_VERSION, layouts: { main: { panes: { left: p(0, false, 250), mid: p(400), right: p(200) } } } });
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.syncToContainer({ definition: def, size: 900 }));
    expect(result.current.committedLayouts.main.panes).toEqual({ left: p(0, false, 250), mid: p(700), right: p(200) });
  });

  it('does not write when the layout already fits (no churn on resize observer ticks)', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.syncToContainer({ definition: def, size: 800 }));
    expect(setItem).not.toHaveBeenCalled();
    expect(result.current.committedLayouts).toEqual({});
  });

  it('ignores a zero or negative container size (e.g. an unmeasured jsdom container)', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.syncToContainer({ definition: def, size: 0 }));
    act(() => result.current.syncToContainer({ definition: def, size: -5 }));
    expect(setItem).not.toHaveBeenCalled();
  });

  it('registers the definition so a later togglePanel works', () => {
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.syncToContainer({ definition: def, size: 800 }));
    act(() => result.current.togglePanel('main', 'right'));
    expect(result.current.committedLayouts.main.panes.right.visible).toBe(false);
  });

  it('PINNED: syncToContainer on a persisted collapsed layout does not reopen it', () => {
    seed({ version: STORAGE_VERSION, layouts: { main: { panes: { left: p(0, false, 250), mid: p(400), right: p(200) } } } });
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.syncToContainer({ definition: def, size: 1200 }));
    expect(result.current.committedLayouts.main.panes.left).toEqual({ size: 0, visible: false, lastVisibleSize: 250 });
  });
});

// Kept from the removed split-resize characterization suite: behaviours the package Split tests do not cover.
describe('adapter coverage carried over from split-resize', () => {
  it('forces a non-collapsible pane visible even if persisted as hidden', () => {
    seed({ version: STORAGE_VERSION, layouts: { main: { panes: { left: p(200), mid: p(0, false, 400), right: p(200) } } } });
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    expect(result.current.getSplitLayout(def).panes.mid).toEqual(p(100, true, 400));
  });

  it('startDrag skips hidden panes and non-numeric measurements', () => {
    seed({ version: STORAGE_VERSION, layouts: { main: { panes: { left: p(0, false, 250), mid: p(400), right: p(200) } } } });
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.startDrag({ definition: def, handleIndex: 1, pointerPosition: 0, paneSizes: { left: 150, mid: Number.NaN, right: 180 } }));
    expect(result.current.liveLayouts.main.panes).toEqual({ left: p(0, false, 250), mid: p(400), right: p(180) });
  });

  it('hiding a pane persisted below minSize records lastVisibleSize of at least minSize', () => {
    seed({ version: STORAGE_VERSION, layouts: { main: { panes: { left: p(50), mid: p(400), right: p(200) } } } });
    const { result } = renderHook(() => useWorkbenchPanelLayout());
    act(() => result.current.registerSplit(def));
    act(() => result.current.togglePanel('main', 'left'));
    expect(result.current.committedLayouts.main.panes.left).toEqual({ size: 0, visible: false, lastVisibleSize: 100 });
  });
});

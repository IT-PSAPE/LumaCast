// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BOTTOM_PANEL_MIN_HEIGHT, clampBottomPanelHeight, DEFAULT_DOCK_WEIGHTS, DEFAULT_HIDDEN_DOCKS, DEFAULT_WORKBENCH_LAYOUT,
  DOCK_LABELS, DOCK_MIN_WIDTHS, DOCK_ORDER, dockColumnsMinWidth, dockColumnsTemplate, dockGridColumn, dockWeightsFromWidths, isDefaultWorkbenchLayout, MONITOR_MIN_HEIGHT,
  moveDock, parseWorkbenchLayout, reorderDockOnDrop, resetWorkbenchLayout, resizeDockWidths, serializeWorkbenchLayout, toggleDockVisibility,
  visibleDocks, workbenchRowsTemplate, type DockId, type WorkbenchLayout,
} from '../../../../apps/stream/renderer/workbench-layout';

const defaultLayout = (): WorkbenchLayout => resetWorkbenchLayout();
const minWidthsFor = (ids: readonly DockId[]): number[] => ids.map((id) => DOCK_MIN_WIDTHS[id]);

describe('dock registry', () => {
  it('has a label, minimum width, and default weight for every dock id', () => {
    for (const id of DOCK_ORDER) {
      expect(typeof DOCK_LABELS[id]).toBe('string');
      expect(DOCK_MIN_WIDTHS[id]).toBeGreaterThan(0);
      expect(DEFAULT_DOCK_WEIGHTS[id]).toBeGreaterThan(0);
    }
  });

  it('uses concise provider labels and keeps all six docks reachable in the lower strip', () => {
    const allDocks = { ...defaultLayout(), hiddenDocks: [] };
    expect(DOCK_LABELS.youtube).toBe('YouTube Live');
    expect(DOCK_LABELS.zoom).toBe('Zoom');
    expect(DOCK_MIN_WIDTHS.scenes).toBe(200);
    expect(dockColumnsMinWidth(allDocks)).toBe(1270);
    expect(dockColumnsMinWidth(defaultLayout())).toBe(790);
  });
});

describe('dock visibility', () => {
  it('defaults to hiding provider docks until configured', () => {
    expect(DEFAULT_HIDDEN_DOCKS).toEqual(['youtube', 'zoom']);
    expect(DEFAULT_WORKBENCH_LAYOUT).toEqual({ dockWeights: null, bottomPanelHeight: null, hiddenDocks: ['youtube', 'zoom'], dockOrder: [...DOCK_ORDER] });
  });

  it('lists visible docks in column order, excluding hidden ones', () => {
    expect(visibleDocks(defaultLayout())).toEqual(['scenes', 'sources', 'mixer', 'controls']);
    expect(visibleDocks({ ...defaultLayout(), hiddenDocks: ['mixer', 'scenes'] })).toEqual(['sources', 'youtube', 'controls', 'zoom']);
    expect(visibleDocks({ ...defaultLayout(), hiddenDocks: [] })).toEqual([...DOCK_ORDER]);
    expect(visibleDocks({ ...defaultLayout(), hiddenDocks: [...DOCK_ORDER] })).toEqual([]);
    expect(visibleDocks({ ...defaultLayout(), dockOrder: ['controls', 'mixer', 'sources', 'scenes', 'youtube'], hiddenDocks: ['youtube'] }))
      .toEqual(['controls', 'mixer', 'sources', 'scenes']);
  });

  it('toggles a dock hidden and back, keeping hiddenDocks in column order', () => {
    const hideControls = toggleDockVisibility(defaultLayout(), 'controls');
    expect(hideControls.hiddenDocks).toEqual(['youtube', 'controls', 'zoom']);

    const alsoHideScenes = toggleDockVisibility(hideControls, 'scenes');
    expect(alsoHideScenes.hiddenDocks).toEqual(['scenes', 'youtube', 'controls', 'zoom']);

    const showYoutube = toggleDockVisibility(alsoHideScenes, 'youtube');
    expect(showYoutube.hiddenDocks).toEqual(['scenes', 'controls', 'zoom']);
  });

  it('does not mutate the layout passed in', () => {
    const layout = defaultLayout();
    const original = [...layout.hiddenDocks];
    toggleDockVisibility(layout, 'scenes');
    expect(layout.hiddenDocks).toEqual(original);
  });

  it('resets to the default layout, independent of any prior layout object', () => {
    const custom: WorkbenchLayout = { dockWeights: { scenes: 2 }, bottomPanelHeight: 400, hiddenDocks: ['scenes'], dockOrder: ['controls', 'scenes', 'sources', 'mixer', 'youtube'] };
    const reset = resetWorkbenchLayout();
    expect(reset).toEqual(DEFAULT_WORKBENCH_LAYOUT);
    expect(reset).not.toBe(custom);
    expect(reset.hiddenDocks).not.toBe(DEFAULT_WORKBENCH_LAYOUT.hiddenDocks);
    expect(reset.dockOrder).not.toBe(DEFAULT_WORKBENCH_LAYOUT.dockOrder);
  });

  it('identifies the stock layout, independent of hiddenDocks element order', () => {
    expect(isDefaultWorkbenchLayout(defaultLayout())).toBe(true);
    expect(isDefaultWorkbenchLayout({ dockWeights: null, bottomPanelHeight: null, hiddenDocks: ['youtube', 'zoom'], dockOrder: [...DOCK_ORDER] })).toBe(true);
  });

  it('is not the stock layout once dockWeights, bottomPanelHeight, hiddenDocks, or dockOrder differ from default', () => {
    expect(isDefaultWorkbenchLayout({ ...defaultLayout(), dockWeights: { scenes: 1.5 } })).toBe(false);
    expect(isDefaultWorkbenchLayout({ ...defaultLayout(), bottomPanelHeight: 300 })).toBe(false);
    // Hiding an *additional* dock (not just the default YouTube one) must count as non-default
    // even though dockWeights/bottomPanelHeight are both still null — this is the case the
    // workbench-layout persistence effect in App.tsx previously dropped silently.
    expect(isDefaultWorkbenchLayout({ ...defaultLayout(), hiddenDocks: ['youtube', 'mixer'] })).toBe(false);
    expect(isDefaultWorkbenchLayout({ ...defaultLayout(), hiddenDocks: [] })).toBe(false);
    expect(isDefaultWorkbenchLayout({ ...defaultLayout(), dockOrder: ['sources', 'scenes', 'mixer', 'youtube', 'controls'] })).toBe(false);
  });

  it('numbers grid columns among only the visible docks', () => {
    const layout: WorkbenchLayout = { ...defaultLayout(), hiddenDocks: ['sources', 'youtube', 'zoom'] };
    expect(dockGridColumn(layout, 'scenes')).toBe(1);
    expect(dockGridColumn(layout, 'sources')).toBeNull();
    expect(dockGridColumn(layout, 'mixer')).toBe(2);
    expect(dockGridColumn(layout, 'youtube')).toBeNull();
    expect(dockGridColumn(layout, 'controls')).toBe(3);
  });
});

describe('dock order', () => {
  it('defaults the dock order to DOCK_ORDER', () => {
    expect(defaultLayout().dockOrder).toEqual([...DOCK_ORDER]);
  });

  describe('moveDock', () => {
    it('moves a dock to a new index within the full order', () => {
      const layout = defaultLayout();
      expect(moveDock(layout, 'controls', 0).dockOrder).toEqual(['controls', 'scenes', 'sources', 'mixer', 'youtube', 'zoom']);
      expect(moveDock(layout, 'scenes', 4).dockOrder).toEqual(['sources', 'mixer', 'youtube', 'controls', 'scenes', 'zoom']);
      expect(moveDock(layout, 'mixer', 1).dockOrder).toEqual(['scenes', 'mixer', 'sources', 'youtube', 'controls', 'zoom']);
    });

    it('clamps an out-of-range target index', () => {
      const layout = defaultLayout();
      expect(moveDock(layout, 'scenes', 99).dockOrder).toEqual(['sources', 'mixer', 'youtube', 'controls', 'zoom', 'scenes']);
      expect(moveDock(layout, 'controls', -5).dockOrder).toEqual(['controls', 'scenes', 'sources', 'mixer', 'youtube', 'zoom']);
    });

    it('is a no-op when the target index matches the current position', () => {
      const layout = defaultLayout();
      expect(moveDock(layout, 'mixer', 2).dockOrder).toEqual(layout.dockOrder);
    });

    it('is a no-op for an unknown dock id, without mutating the layout', () => {
      const layout = defaultLayout();
      const result = moveDock(layout, 'bogus' as DockId, 0);
      expect(result.dockOrder).toEqual(layout.dockOrder);
      expect(layout.dockOrder).toEqual([...DOCK_ORDER]);
    });
  });

  describe('reorderDockOnDrop', () => {
    it('drops a dock before another, independent of drag direction', () => {
      const layout = defaultLayout();
      expect(reorderDockOnDrop(layout, 'controls', 'scenes').dockOrder).toEqual(['controls', 'scenes', 'sources', 'mixer', 'youtube', 'zoom']);
      expect(reorderDockOnDrop(layout, 'scenes', 'controls').dockOrder).toEqual(['sources', 'mixer', 'youtube', 'scenes', 'controls', 'zoom']);
    });

    it('drops at the end when beforeId is null', () => {
      const layout = defaultLayout();
      expect(reorderDockOnDrop(layout, 'scenes', null).dockOrder).toEqual(['sources', 'mixer', 'youtube', 'controls', 'zoom', 'scenes']);
    });

    it('keeps a hidden dock in its relative position when a visible dock is reordered around it', () => {
      // youtube sits between sources and mixer; dragging mixer to right before controls (already
      // its neighbor) is a no-op, but dragging scenes there shifts past youtube without moving it.
      const layout: WorkbenchLayout = { ...defaultLayout(), dockOrder: ['scenes', 'sources', 'youtube', 'mixer', 'controls'], hiddenDocks: ['youtube'] };
      expect(reorderDockOnDrop(layout, 'mixer', 'controls').dockOrder).toEqual(['scenes', 'sources', 'youtube', 'mixer', 'controls']);
      expect(reorderDockOnDrop(layout, 'scenes', 'controls').dockOrder).toEqual(['sources', 'youtube', 'mixer', 'scenes', 'controls']);
    });

    it('drops a dock at the end without disturbing an interspersed hidden dock', () => {
      const layout: WorkbenchLayout = { ...defaultLayout(), dockOrder: ['scenes', 'youtube', 'sources', 'mixer', 'controls'], hiddenDocks: ['youtube'] };
      const result = reorderDockOnDrop(layout, 'mixer', null);
      expect(result.dockOrder).toEqual(['scenes', 'youtube', 'sources', 'controls', 'mixer']);
      expect(visibleDocks(result)).toEqual(['scenes', 'sources', 'controls', 'mixer']);
    });

    it('is a no-op when dropped back into its own gap', () => {
      const layout = defaultLayout();
      expect(reorderDockOnDrop(layout, 'sources', 'mixer').dockOrder).toEqual(layout.dockOrder);
      expect(reorderDockOnDrop(layout, 'sources', 'sources').dockOrder).toEqual(layout.dockOrder);
    });

    it('is a no-op for an unknown dragged or target id', () => {
      const layout = defaultLayout();
      expect(reorderDockOnDrop(layout, 'bogus' as DockId, 'scenes').dockOrder).toEqual(layout.dockOrder);
      expect(reorderDockOnDrop(layout, 'scenes', 'bogus' as DockId).dockOrder).toEqual(layout.dockOrder);
    });
  });

  it('dockGridColumn and dockColumnsTemplate follow a custom dock order', () => {
    const layout: WorkbenchLayout = { dockWeights: null, bottomPanelHeight: null, hiddenDocks: ['youtube', 'zoom'], dockOrder: ['controls', 'mixer', 'sources', 'scenes', 'youtube', 'zoom'] };
    expect(visibleDocks(layout)).toEqual(['controls', 'mixer', 'sources', 'scenes']);
    expect(dockGridColumn(layout, 'controls')).toBe(1);
    expect(dockGridColumn(layout, 'scenes')).toBe(4);
    expect(dockColumnsTemplate(layout)).toBe('minmax(180px, 0.95fr) minmax(225px, 1.2fr) minmax(185px, 1fr) minmax(200px, 0.9fr)');
  });
});

describe('dock column templates', () => {
  it('returns null for the default four visible docks with no custom weights', () => {
    expect(dockColumnsTemplate(defaultLayout())).toBeNull();
  });

  it('renders an explicit template for a non-default 3-dock visible set', () => {
    const layout: WorkbenchLayout = { dockWeights: null, bottomPanelHeight: null, hiddenDocks: ['mixer', 'youtube', 'zoom'], dockOrder: [...DOCK_ORDER] };
    expect(visibleDocks(layout)).toEqual(['scenes', 'sources', 'controls']);
    expect(dockColumnsTemplate(layout)).toBe('minmax(200px, 0.9fr) minmax(185px, 1fr) minmax(180px, 0.95fr)');
  });

  it('renders an explicit template for all 6 docks visible', () => {
    const layout: WorkbenchLayout = { dockWeights: null, bottomPanelHeight: null, hiddenDocks: [], dockOrder: [...DOCK_ORDER] };
    expect(visibleDocks(layout)).toEqual([...DOCK_ORDER]);
    expect(dockColumnsTemplate(layout)).toBe(
      'minmax(200px, 0.9fr) minmax(185px, 1fr) minmax(225px, 1.2fr) minmax(240px, 1fr) minmax(180px, 0.95fr) minmax(240px, 1fr)',
    );
  });

  it('renders an empty template when no docks are visible', () => {
    const layout: WorkbenchLayout = { dockWeights: null, bottomPanelHeight: null, hiddenDocks: [...DOCK_ORDER], dockOrder: [...DOCK_ORDER] };
    expect(dockColumnsTemplate(layout)).toBe('');
  });

  it('renders custom weights for the default visible set instead of null', () => {
    const layout: WorkbenchLayout = { dockWeights: { scenes: 0.8, sources: 0.8, mixer: 1.6, controls: 0.8 }, bottomPanelHeight: null, hiddenDocks: ['youtube', 'zoom'], dockOrder: [...DOCK_ORDER] };
    expect(dockColumnsTemplate(layout)).toBe('minmax(200px, 0.8fr) minmax(185px, 0.8fr) minmax(225px, 1.6fr) minmax(180px, 0.8fr)');
  });

  it('falls back to the default weight for a visible dock missing from a custom record', () => {
    const layout: WorkbenchLayout = { dockWeights: { mixer: 1.5 }, bottomPanelHeight: null, hiddenDocks: ['youtube', 'zoom'], dockOrder: [...DOCK_ORDER] };
    expect(dockColumnsTemplate(layout)).toBe('minmax(200px, 0.9fr) minmax(185px, 1fr) minmax(225px, 1.5fr) minmax(180px, 0.95fr)');
  });
});

describe('workbench row template', () => {
  it('returns null only when the panel height is unset and the default dock count is visible', () => {
    expect(workbenchRowsTemplate(null, 4)).toBeNull();
  });

  it('renders an explicit fallback row when the panel height is unset but the visible count is non-default', () => {
    expect(workbenchRowsTemplate(null, 3)).toBe(`minmax(${MONITOR_MIN_HEIGHT}px, 1fr) 210px`);
    expect(workbenchRowsTemplate(null, 5)).toBe(`minmax(${MONITOR_MIN_HEIGHT}px, 1fr) 210px`);
  });

  it('collapses the bottom row to 0px when no docks are visible, regardless of height', () => {
    expect(workbenchRowsTemplate(null, 0)).toBe(`minmax(${MONITOR_MIN_HEIGHT}px, 1fr) 0px`);
    expect(workbenchRowsTemplate(260, 0)).toBe(`minmax(${MONITOR_MIN_HEIGHT}px, 1fr) 0px`);
  });

  it('renders the explicit height whenever one is set', () => {
    expect(workbenchRowsTemplate(260, 4)).toBe(`minmax(${MONITOR_MIN_HEIGHT}px, 1fr) 260px`);
    expect(workbenchRowsTemplate(260, 3)).toBe(`minmax(${MONITOR_MIN_HEIGHT}px, 1fr) 260px`);
  });
});

describe('workbench dock resizing', () => {
  const fourVisible: readonly DockId[] = ['scenes', 'sources', 'mixer', 'controls'];
  const fourMinWidths = minWidthsFor(fourVisible);
  const widths = [300, 320, 400, 300];

  it('moves width between the two docks that share a boundary', () => {
    expect(resizeDockWidths(widths, 1, 50, fourMinWidths)).toEqual([300, 370, 350, 300]);
    expect(resizeDockWidths(widths, 1, -50, fourMinWidths)).toEqual([300, 270, 450, 300]);
  });

  it('stops at each dock minimum width', () => {
    expect(resizeDockWidths(widths, 0, -500, fourMinWidths)).toEqual([fourMinWidths[0], 320 + 300 - fourMinWidths[0]!, 400, 300]);
    expect(resizeDockWidths(widths, 2, 500, fourMinWidths)).toEqual([300, 320, 400 + 300 - fourMinWidths[3]!, fourMinWidths[3]]);
  });

  it('ignores invalid boundaries and deltas', () => {
    expect(resizeDockWidths(widths, 3, 20, fourMinWidths)).toEqual(widths);
    expect(resizeDockWidths(widths, -1, 20, fourMinWidths)).toEqual(widths);
    expect(resizeDockWidths(widths, 1, Number.NaN, fourMinWidths)).toEqual(widths);
  });

  it('resizes over a non-default 3-dock visible list', () => {
    const threeVisible: readonly DockId[] = ['scenes', 'sources', 'controls'];
    const threeMinWidths = minWidthsFor(threeVisible);
    expect(threeMinWidths).toEqual([200, 185, 180]);

    const threeWidths = [200, 220, 200];
    expect(resizeDockWidths(threeWidths, 0, 30, threeMinWidths)).toEqual([230, 190, 200]);
    expect(resizeDockWidths(threeWidths, 1, -50, threeMinWidths)).toEqual([200, 185, 235]);
    // Last boundary (index 2) doesn't exist for a 3-wide list (length - 1 === 2).
    expect(resizeDockWidths(threeWidths, 2, 20, threeMinWidths)).toEqual(threeWidths);
  });
});

describe('dockWeightsFromWidths', () => {
  it('normalizes pixel widths into weights that sum to the visible dock count', () => {
    const ids: readonly DockId[] = ['scenes', 'sources', 'mixer', 'controls'];
    expect(dockWeightsFromWidths(ids, [200, 200, 400, 200], null)).toEqual({ scenes: 0.8, sources: 0.8, mixer: 1.6, controls: 0.8 });
  });

  it('falls back to default weights for a zero-total width list', () => {
    const ids: readonly DockId[] = ['scenes', 'sources'];
    expect(dockWeightsFromWidths(ids, [0, 0], null)).toEqual({ scenes: DEFAULT_DOCK_WEIGHTS.scenes, sources: DEFAULT_DOCK_WEIGHTS.sources });
  });

  it('preserves the stored weight of currently hidden docks', () => {
    const ids: readonly DockId[] = ['scenes', 'sources', 'mixer'];
    const current = { youtube: 1.35, controls: 0.5 };
    expect(dockWeightsFromWidths(ids, [200, 200, 400], current)).toEqual({
      youtube: 1.35,
      controls: 0.5,
      scenes: 0.75,
      sources: 0.75,
      mixer: 1.5,
    });
  });

  it('overwrites a visible dock already present in current with its freshly computed weight', () => {
    const ids: readonly DockId[] = ['scenes'];
    expect(dockWeightsFromWidths(ids, [100], { scenes: 9.9, mixer: 1.1 })).toEqual({ scenes: 1, mixer: 1.1 });
  });
});

describe('workbench bottom panel height', () => {
  it('keeps the panel between its minimum and the monitor minimum', () => {
    expect(clampBottomPanelHeight(100, 900)).toBe(BOTTOM_PANEL_MIN_HEIGHT);
    expect(clampBottomPanelHeight(300, 900)).toBe(300);
    expect(clampBottomPanelHeight(800, 900)).toBe(900 - MONITOR_MIN_HEIGHT);
  });

  it('never inverts when the window is shorter than both minimums', () => {
    expect(clampBottomPanelHeight(500, 300)).toBe(BOTTOM_PANEL_MIN_HEIGHT);
  });
});

describe('workbench layout persistence', () => {
  it('round-trips a custom layout', () => {
    const layout: WorkbenchLayout = {
      dockWeights: { scenes: 0.8, sources: 0.8, mixer: 1.6, controls: 0.8 },
      bottomPanelHeight: 260,
      hiddenDocks: ['youtube', 'zoom'],
      dockOrder: ['mixer', 'scenes', 'controls', 'sources', 'youtube', 'zoom'],
    };
    expect(parseWorkbenchLayout(serializeWorkbenchLayout(layout))).toEqual(layout);
  });

  it('maps the legacy 4-element dockWeights array onto scenes/sources/mixer/controls', () => {
    const legacy = '{"dockWeights":[0.8,0.8,1.6,0.8],"bottomPanelHeight":260}';
    expect(parseWorkbenchLayout(legacy)).toEqual({
      dockWeights: { scenes: 0.8, sources: 0.8, mixer: 1.6, controls: 0.8 },
      bottomPanelHeight: 260,
      hiddenDocks: ['youtube', 'zoom'],
      dockOrder: [...DOCK_ORDER],
    });
  });

  it('parses the current per-dock record shape, dropping unknown keys and invalid numbers', () => {
    const raw = '{"dockWeights":{"scenes":1.1,"youtube":1,"bogus":5,"sources":"NaN","mixer":0},"bottomPanelHeight":300,"hiddenDocks":["mixer","nope"]}';
    expect(parseWorkbenchLayout(raw)).toEqual({
      dockWeights: { scenes: 1.1, youtube: 1 },
      bottomPanelHeight: 300,
      hiddenDocks: ['mixer'],
      dockOrder: [...DOCK_ORDER],
    });
  });

  it('treats an all-invalid dockWeights record as no custom weights', () => {
    expect(parseWorkbenchLayout('{"dockWeights":{"bogus":1,"scenes":-1,"mixer":0}}').dockWeights).toBeNull();
  });

  it('defaults provider docks to hidden when hiddenDocks is absent', () => {
    expect(parseWorkbenchLayout('{}')).toEqual({ dockWeights: null, bottomPanelHeight: null, hiddenDocks: ['youtube', 'zoom'], dockOrder: [...DOCK_ORDER] });
  });

  it('respects an explicitly empty hiddenDocks list', () => {
    expect(parseWorkbenchLayout('{"hiddenDocks":[]}').hiddenDocks).toEqual([]);
  });

  it('falls back to the default hidden set when hiddenDocks is malformed', () => {
    expect(parseWorkbenchLayout('{"hiddenDocks":"youtube"}').hiddenDocks).toEqual(['youtube', 'zoom']);
  });

  it.each([null, '', 'not json', '[]'])('falls back to defaults for malformed storage: %s', (raw) => {
    expect(parseWorkbenchLayout(raw)).toEqual({ dockWeights: null, bottomPanelHeight: null, hiddenDocks: ['youtube', 'zoom'], dockOrder: [...DOCK_ORDER] });
  });

  it('falls back to defaults for a malformed legacy-shaped layout', () => {
    expect(parseWorkbenchLayout('{"dockWeights":[1,2],"bottomPanelHeight":"tall"}')).toEqual({
      dockWeights: null,
      bottomPanelHeight: null,
      hiddenDocks: ['youtube', 'zoom'],
      dockOrder: [...DOCK_ORDER],
    });
  });

  it('keeps the valid half of a partially valid layout', () => {
    expect(parseWorkbenchLayout('{"dockWeights":[1,1,1,1],"bottomPanelHeight":99999}')).toEqual({
      dockWeights: { scenes: 1, sources: 1, mixer: 1, controls: 1 },
      bottomPanelHeight: null,
      hiddenDocks: ['youtube', 'zoom'],
      dockOrder: [...DOCK_ORDER],
    });
  });

  it('parses a persisted dock order, dropping unknown and duplicate ids', () => {
    const raw = '{"dockOrder":["mixer","bogus","scenes","mixer","controls"]}';
    expect(parseWorkbenchLayout(raw).dockOrder).toEqual(['mixer', 'scenes', 'controls', 'sources', 'youtube', 'zoom']);
  });

  it('falls back to the default dock order when it is absent or malformed', () => {
    expect(parseWorkbenchLayout('{}').dockOrder).toEqual([...DOCK_ORDER]);
    expect(parseWorkbenchLayout('{"dockOrder":"scenes"}').dockOrder).toEqual([...DOCK_ORDER]);
    expect(parseWorkbenchLayout('{"dockOrder":[]}').dockOrder).toEqual([...DOCK_ORDER]);
  });
});

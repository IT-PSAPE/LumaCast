import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ProgramPanel } from './program-panel';

// Covers the program-panel composition refactor: the optional surface label
// is a compound child decision (all-mode composes a badge into each cell,
// single-mode composes none), the single/all header controls are explicit
// variant components, and the bottom tab tree renders through Tabs.Panel.

const mocks = vi.hoisted(() => {
  const workbenchState = {
    programMode: 'single',
    programSingleSurface: 'program',
    programGridDensity: 1,
  };
  return {
    workbenchState,
    workbenchActions: {
      setProgramMode: vi.fn((mode: 'single' | 'all') => { workbenchState.programMode = mode; }),
      setProgramSingleSurface: vi.fn((surface: 'program' | 'monitor' | 'stage') => { workbenchState.programSingleSurface = surface; }),
      setProgramGridDensity: vi.fn((density: 1 | 2) => { workbenchState.programGridDensity = density; }),
      setWorkbenchMode: vi.fn(),
    },
    overlayStack: { register: vi.fn(), unregister: vi.fn(), stack: [] as string[], baseZIndex: 100 },
    programBackground: 'black',
    audienceWithAlpha: false,
    stageWithAlpha: false,
  };
});

vi.mock('../../contexts/workbench-context', () => ({
  useWorkbench: () => ({
    state: mocks.workbenchState,
    actions: mocks.workbenchActions,
    overlayStack: mocks.overlayStack,
  }),
}));

vi.mock('../../contexts/app-context', () => ({
  useNdi: () => ({
    state: {
      outputConfigs: {
        audience: { withAlpha: mocks.audienceWithAlpha },
        stage: { withAlpha: mocks.stageWithAlpha },
      },
      outputState: {},
      diagnostics: null,
    },
    actions: { setOutputEnabled: vi.fn(), toggleAudienceOutput: vi.fn(), toggleStageOutput: vi.fn(), updateOutputConfig: vi.fn() },
  }),
}));

vi.mock('../../contexts/navigation-context', () => ({
  useNavigation: () => ({ currentOutputItemRef: null }),
}));

vi.mock('../../contexts/playback/playback-context', () => ({
  usePresentationLayers: () => ({
    clearLayer: vi.fn(),
    clearAllLayers: vi.fn(),
    mediaLayerAsset: null,
    videoLayerAsset: null,
    contentLayerVisible: false,
    activeOverlays: [],
    overlayMode: 'single',
    setOverlayMode: vi.fn(),
  }),
  useAudio: () => ({ isPlaying: false, currentTime: 0, clearAudio: vi.fn() }),
  useStagePlayback: () => ({ setCurrentStageId: vi.fn() }),
}));

vi.mock('../../contexts/asset-editor/asset-editor-context', () => ({
  useOverlayEditor: () => ({ createOverlay: vi.fn().mockResolvedValue(undefined) }),
  useStageEditor: () => ({ createStage: vi.fn().mockResolvedValue(null) }),
}));

vi.mock('../../contexts/canvas/canvas-context', () => ({
  useRenderScenes: () => ({ showScene: {} }),
}));

vi.mock('../automation/automation-context', () => ({
  useAutomation: () => ({ actions: { createMacro: vi.fn().mockResolvedValue({}) } }),
}));

vi.mock('./use-program-output', () => ({
  useProgramOutput: () => ({ scene: {}, status: 'idle', background: mocks.programBackground }),
}));

vi.mock('./use-stage-scene', () => ({
  useProgramBindingValue: () => ({
    currentSlideText: null,
    nextSlideText: null,
    slideNotes: null,
    talkScriptCurrent: null,
    talkScriptProgress: null,
    armedAtMs: null,
  }),
  useStageBindingValue: () => ({
    currentSlideText: null,
    nextSlideText: null,
    slideNotes: null,
    talkScriptCurrent: null,
    talkScriptProgress: null,
    armedAtMs: null,
  }),
  useStageScene: () => ({}),
}));

vi.mock('../canvas/scene-stage', () => ({
  SceneStage: ({ surface, ndiCaptureSource }: { surface: string; ndiCaptureSource?: string }) => (
    <div data-testid="scene-stage" data-surface={surface} data-ndi-capture={ndiCaptureSource ?? ''} />
  ),
}));

vi.mock('../assets/overlays/overlay-bin-panel', () => ({
  OverlayBinPanel: () => <div data-testid="overlay-bin" />,
}));

vi.mock('../assets/stages/stage-bin-panel', () => ({
  StageBinPanel: () => <div data-testid="stage-bin" />,
}));

vi.mock('../automation/macro-bin-panel', () => ({
  MacroBinPanel: () => <div data-testid="macro-bin" />,
}));

function surfaceBadges() {
  return Array.from(document.querySelectorAll<HTMLElement>('span[class*="bg-black/60"]'));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workbenchState.programMode = 'single';
  mocks.workbenchState.programSingleSurface = 'program';
  mocks.workbenchState.programGridDensity = 1;
  mocks.programBackground = 'black';
  mocks.audienceWithAlpha = false;
  mocks.stageWithAlpha = false;
});

afterEach(() => {
  cleanup();
});

describe('ProgramPanel surface composition', () => {
  it('single mode composes the surface picker and no label badges', () => {
    const { getByRole, queryByLabelText, queryAllByTestId } = render(<ProgramPanel />);

    expect(getByRole('button', { name: 'Program' })).not.toBeNull();
    expect(queryByLabelText('Grid columns')).toBeNull();
    expect(surfaceBadges()).toHaveLength(0);

    const stages = queryAllByTestId('scene-stage');
    expect(stages).toHaveLength(1);
    expect(stages[0].getAttribute('data-surface')).toBe('show');
  });

  it('all mode composes the grid density control and a badge per surface cell', () => {
    mocks.workbenchState.programMode = 'all';
    const { getByLabelText, queryByRole, queryAllByTestId } = render(<ProgramPanel />);

    expect(getByLabelText('Grid columns')).not.toBeNull();
    expect(queryByRole('button', { name: 'Program' })).toBeNull();

    const badges = surfaceBadges();
    expect(badges.map((badge) => badge.textContent)).toEqual(['Program', 'Monitor', 'Stage']);

    const stages = queryAllByTestId('scene-stage');
    expect(stages).toHaveLength(3);
    expect(stages.map((stage) => stage.getAttribute('data-surface'))).toEqual(['show', 'monitor', 'stage']);
  });

  it('mode toggle switches between the single and all header variant trees', () => {
    const { getByRole, rerender, queryByLabelText, queryByRole } = render(<ProgramPanel />);

    fireEvent.click(getByRole('button', { name: 'Switch to all program views' }));
    expect(mocks.workbenchActions.setProgramMode).toHaveBeenCalledWith('all');
    rerender(<ProgramPanel />);
    expect(getByRole('button', { name: 'Switch to single program view' })).not.toBeNull();
    expect(queryByLabelText('Grid columns')).not.toBeNull();
    expect(surfaceBadges()).toHaveLength(3);

    fireEvent.click(getByRole('button', { name: 'Switch to single program view' }));
    expect(mocks.workbenchActions.setProgramMode).toHaveBeenCalledWith('single');
    rerender(<ProgramPanel />);
    expect(queryByLabelText('Grid columns')).toBeNull();
    expect(queryByRole('button', { name: 'Program' })).not.toBeNull();
    expect(surfaceBadges()).toHaveLength(0);
  });

  it('surface pick replaces the single-mode cell composition', () => {
    const { getByRole, rerender, queryAllByTestId } = render(<ProgramPanel />);

    fireEvent.pointerDown(getByRole('button', { name: 'Program' }));
    fireEvent.click(getByRole('menuitem', { name: 'Stage' }));
    expect(mocks.workbenchActions.setProgramSingleSurface).toHaveBeenCalledWith('stage');

    rerender(<ProgramPanel />);
    expect(getByRole('button', { name: 'Stage' })).not.toBeNull();
    const stages = queryAllByTestId('scene-stage');
    expect(stages).toHaveLength(1);
    expect(stages[0].getAttribute('data-surface')).toBe('stage');
  });

  it('keeps the semantic checkerboard driven by output background and withAlpha config', () => {
    mocks.programBackground = 'transparent';
    const { container } = render(<ProgramPanel />);
    expect(container.querySelectorAll('[class*="repeating-conic-gradient"]')).toHaveLength(1);

    cleanup();
    mocks.workbenchState.programMode = 'all';
    mocks.audienceWithAlpha = true;
    const all = render(<ProgramPanel />);
    expect(all.container.querySelectorAll('[class*="repeating-conic-gradient"]')).toHaveLength(2);
  });
});

describe('ProgramPanel bottom tabs', () => {
  it('overlays tab is active by default with its action row and bin content', () => {
    const { getByLabelText, getByTestId, queryByLabelText, queryByTestId } = render(<ProgramPanel />);

    expect(getByLabelText('Add overlay')).not.toBeNull();
    expect(getByLabelText('Edit overlays')).not.toBeNull();
    expect(queryByLabelText('Add stage')).toBeNull();
    expect(queryByLabelText('Add macro')).toBeNull();
    expect(getByTestId('overlay-bin')).not.toBeNull();
    expect(queryByTestId('stage-bin')).toBeNull();
    expect(queryByTestId('macro-bin')).toBeNull();
  });

  it('switching tabs swaps the composed action row and bin content', () => {
    const { getByRole, getByLabelText, getByTestId, queryByLabelText, queryByTestId } = render(<ProgramPanel />);

    fireEvent.click(getByRole('tab', { name: 'Stage' }));
    expect(getByLabelText('Add stage')).not.toBeNull();
    expect(getByLabelText('Edit stages')).not.toBeNull();
    expect(queryByLabelText('Add overlay')).toBeNull();
    expect(getByTestId('stage-bin')).not.toBeNull();
    expect(queryByTestId('overlay-bin')).toBeNull();

    fireEvent.click(getByRole('tab', { name: 'Macros' }));
    expect(getByLabelText('Add macro')).not.toBeNull();
    expect(getByLabelText('Edit macros')).not.toBeNull();
    expect(queryByLabelText('Add stage')).toBeNull();
    expect(getByTestId('macro-bin')).not.toBeNull();
    expect(queryByTestId('stage-bin')).toBeNull();

    fireEvent.click(getByRole('tab', { name: 'Overlays' }));
    expect(getByLabelText('Add overlay')).not.toBeNull();
    expect(getByTestId('overlay-bin')).not.toBeNull();
    expect(queryByTestId('macro-bin')).toBeNull();
  });
});

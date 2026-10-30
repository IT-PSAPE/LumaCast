import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: {
    document: {
      project: {
        composition: { width: 1920, height: 1080, fps: 30 },
        background: { kind: 'color' },
      },
    },
    playback: { timeMs: 0, playing: false },
    media: { backgroundUrl: null as string | null },
    selection: [] as string[],
    clearSelection: vi.fn(),
  },
  rectProps: null as { draggable?: boolean } | null,
  scene: {
    width: 1920,
    height: 1080,
    blur: 0,
    dim: 0,
    background: { type: 'color', color: '#000000' },
    cue: {
      cueId: 'cue-a',
      node: { element: { x: 100, y: 200, width: 300, height: 150, rotation: 0, opacity: 1 } },
      transition: { opacity: 1, offsetX: 0, offsetY: 0, scale: 1 },
    },
  },
}));

vi.mock('../../../../../../apps/chord/renderer/store', () => ({
  useChordStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
}));

vi.mock('../../../../../../apps/chord/renderer/features/canvas/build-frame-scene', () => ({
  buildFrameScene: () => mocks.scene,
}));

vi.mock('../../../../../../apps/chord/renderer/features/canvas/chord-stage', () => ({
  ChordStage: () => <div data-testid="rendered-preview" />,
  computeStageFit: () => ({ scale: 1, offsetX: 0, offsetY: 0 }),
}));

vi.mock('../../../../../../apps/chord/renderer/features/canvas/use-background-video-sync', () => ({
  useBackgroundVideoSync: vi.fn(),
}));

vi.mock('react-konva', async () => {
  const React = await import('react');
  const Passthrough = (props: { children?: React.ReactNode }) => React.createElement('div', null, props.children);
  return {
    Stage: Passthrough,
    Layer: Passthrough,
    Group: Passthrough,
    Rect: (props: { draggable?: boolean }) => {
      mocks.rectProps = props;
      return React.createElement('div', {
        'data-testid': 'editable-cue-box',
        'data-draggable': String(Boolean(props.draggable)),
      });
    },
    Transformer: () => null,
  };
});

import { PreviewCanvas } from '../../../../../../apps/chord/renderer/features/canvas/preview-canvas';

const previousResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  mocks.state.selection = ['cue-a'];
  mocks.rectProps = null;
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  if (previousResizeObserver) vi.stubGlobal('ResizeObserver', previousResizeObserver);
  else vi.unstubAllGlobals();
});

describe('PreviewCanvas selection editing', () => {
  it('allows editing the active cue box when it is the only selection', () => {
    render(<PreviewCanvas />);

    expect(screen.getByTestId('rendered-preview')).toBeInTheDocument();
    expect(screen.getByTestId('editable-cue-box')).toHaveAttribute('data-draggable', 'true');
  });

  it('keeps rendering the active frame but removes its single-cue edit box for multi-selection', () => {
    mocks.state.selection = ['cue-a', 'cue-b'];

    render(<PreviewCanvas />);

    expect(screen.getByTestId('rendered-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('editable-cue-box')).not.toBeInTheDocument();
  });
});

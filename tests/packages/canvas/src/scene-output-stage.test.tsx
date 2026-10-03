import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { RenderScene } from '@lumacast/composition';
import { SceneOutputStage } from '../../../../packages/canvas/src/scene-output-stage';

const draw = vi.fn();
vi.mock('react-konva', () => ({
  Stage: ({ children, width, height, ref }: { children: ReactNode; width: number; height: number; ref: { current: unknown } }) => {
    ref.current = { draw };
    return <div data-testid="stage" data-width={width} data-height={height}>{children}</div>;
  },
  Layer: ({ children }: { children: ReactNode }) => <div data-testid="layer">{children}</div>,
  Group: ({ children, scaleX, scaleY }: { children: ReactNode; scaleX?: number; scaleY?: number }) => <div data-scale-x={scaleX} data-scale-y={scaleY}>{children}</div>,
}));
vi.mock('../../../../packages/canvas/src/scene-slide-background', () => ({
  SceneSlideBackground: () => null,
}));
vi.mock('../../../../packages/canvas/src/scene-node-content', () => ({ renderSceneNodeContent: () => null }));
const scene = { width: 960, height: 540, slide: { id: 'slide', background: null }, nodes: [] } as unknown as RenderScene;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('SceneOutputStage', () => {
  it('paints a transparent scene at the requested output size and redraws after resize', () => {
    const onDraw = vi.fn();
    const view = render(<SceneOutputStage scene={scene} surface="ndi-show" width={1920} height={1080} onDraw={onDraw} />);
    expect(view.getByTestId('stage').getAttribute('data-width')).toBe('1920');
    expect(view.getByTestId('stage').getAttribute('data-height')).toBe('1080');
    expect(view.getByTestId('layer').querySelector('[data-scale-x]')?.getAttribute('data-scale-x')).toBe('2');
    expect(view.getByTestId('layer').querySelector('[data-scale-y]')?.getAttribute('data-scale-y')).toBe('2');
    expect(view.getByTestId('layer').children).toHaveLength(1);
    const firstDrawCount = onDraw.mock.calls.length;
    view.rerender(<SceneOutputStage scene={scene} surface="ndi-show" width={960} height={540} onDraw={onDraw} />);
    expect(onDraw.mock.calls.length).toBeGreaterThan(firstDrawCount);
  });
});

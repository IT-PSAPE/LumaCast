import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { LazySceneStage } from './lazy-scene-stage';

vi.mock('../canvas/scene-stage', () => ({
  SceneStage: ({
    surface,
    className,
    ndiCaptureSource,
    fixedViewport,
  }: {
    surface: string;
    className?: string;
    ndiCaptureSource?: string;
    fixedViewport?: { width: number; height: number } | null;
  }) => (
    <div
      data-testid="scene-stage"
      data-surface={surface}
      data-class={className ?? ''}
      data-ndi-capture={ndiCaptureSource ?? ''}
      data-fixed-viewport={fixedViewport ? `${fixedViewport.width}x${fixedViewport.height}` : ''}
    />
  ),
}));

describe('LazySceneStage', () => {
  it('suspends through a placeholder before mounting SceneStage with the requested props', async () => {
    const scene = { width: 1920, height: 1080, slide: { background: null }, nodes: [] } as never;
    const { getByTestId, queryByTestId } = render(
      <LazySceneStage
        scene={scene}
        surface="show"
        className="stage-host"
        ndiCaptureSource="audience"
        fixedViewport={{ width: 640, height: 360 }}
      />,
    );

    expect(getByTestId('lazy-scene-stage-fallback').className).toBe('stage-host');

    await waitFor(() => expect(queryByTestId('scene-stage')).not.toBeNull());

    expect(getByTestId('scene-stage').getAttribute('data-surface')).toBe('show');
    expect(getByTestId('scene-stage').getAttribute('data-class')).toBe('stage-host');
    expect(getByTestId('scene-stage').getAttribute('data-ndi-capture')).toBe('audience');
    expect(getByTestId('scene-stage').getAttribute('data-fixed-viewport')).toBe('640x360');
  });
});

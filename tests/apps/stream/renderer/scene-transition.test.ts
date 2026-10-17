import { describe, expect, it } from 'vitest';
import { createSceneTransition } from '../../../../apps/stream/renderer/scene-transition';

describe('createSceneTransition', () => {
  it('does not create an animated transition for a cut', () => {
    expect(createSceneTransition('Cut', 'scene-a', 100, 350, '#123456')).toBeNull();
  });

  it('keeps fade-to-color settings with the transition', () => {
    expect(createSceneTransition('FadeToColor', 'scene-a', 100, 600, '#1a2b3c')).toEqual({
      type: 'FadeToColor',
      fromSceneId: 'scene-a',
      startedAt: 100,
      durationMs: 600,
      color: '#1a2b3c',
    });
  });

  it('does not attach a color setting to other transitions', () => {
    expect(createSceneTransition('Fade', 'scene-a', 100, 350, '#123456')).toEqual({
      type: 'Fade',
      fromSceneId: 'scene-a',
      startedAt: 100,
      durationMs: 350,
    });
  });
});

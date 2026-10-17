export type SceneTransitionType = 'Cut' | 'Fade' | 'Swipe' | 'Slide' | 'FadeToColor';

export interface SceneTransition {
  type: Exclude<SceneTransitionType, 'Cut'>;
  fromSceneId: string;
  startedAt: number;
  durationMs: number;
  color?: string;
}

export function createSceneTransition(
  type: SceneTransitionType,
  fromSceneId: string,
  startedAt: number,
  durationMs: number,
  color: string,
): SceneTransition | null {
  if (type === 'Cut') return null;
  return {
    type,
    fromSceneId,
    startedAt,
    durationMs,
    ...(type === 'FadeToColor' ? { color } : {}),
  };
}

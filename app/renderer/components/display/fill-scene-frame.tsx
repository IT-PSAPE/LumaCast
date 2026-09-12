import type { SceneFrameBaseProps } from './scene-frame-types';
import { CheckerboardBackdrop } from './checkerboard-backdrop';

export function FillSceneFrame({ width, height, className = '', stageClassName = '', checkerboard = false, children }: SceneFrameBaseProps) {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);

  return (
    <div className={`relative w-full overflow-hidden ${className}`} style={{ aspectRatio: `${safeWidth} / ${safeHeight}` }}>
      {checkerboard ? (
        <CheckerboardBackdrop />
      ) : null}
      <div className={`absolute inset-0 ${stageClassName}`}>
        {children}
      </div>
    </div>
  );
}

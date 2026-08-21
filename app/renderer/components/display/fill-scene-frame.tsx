import type { SceneFrameBaseProps } from './scene-frame-types';

export function FillSceneFrame({ width, height, className = '', stageClassName = '', checkerboard = false, children }: SceneFrameBaseProps) {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);

  return (
    <div className={`relative w-full overflow-hidden ${className}`} style={{ aspectRatio: `${safeWidth} / ${safeHeight}` }}>
      {checkerboard ? (
        <div className="pointer-events-none absolute inset-0 bg-[repeating-conic-gradient(var(--color-background-tertiary)_0%_25%,var(--color-background-quaternary)_0%_50%)] bg-[length:24px_24px]" />
      ) : null}
      <div className={`absolute inset-0 ${stageClassName}`}>
        {children}
      </div>
    </div>
  );
}

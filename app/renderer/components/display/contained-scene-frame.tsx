import { useEffect, useMemo, useRef, useState } from 'react';
import type { SceneFrameBaseProps } from './scene-frame-types';

interface FrameSize {
  width: number;
  height: number;
}

export function ContainedSceneFrame({ width, height, className = '', stageClassName = '', checkerboard = false, children }: SceneFrameBaseProps) {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<FrameSize>({ width: safeWidth, height: safeHeight });

  useEffect(() => {
    const target = containerRef.current;
    if (!target) return;

    function updateSize(nextTarget: HTMLDivElement) {
      const rect = nextTarget.getBoundingClientRect();
      setContainerSize({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      });
    }

    updateSize(target);
    const observer = new ResizeObserver(() => updateSize(target));
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const frameStyle = useMemo(() => {
    const scale = Math.min(containerSize.width / safeWidth, containerSize.height / safeHeight);
    return {
      width: `${safeWidth * scale}px`,
      height: `${safeHeight * scale}px`,
    };
  }, [containerSize.height, containerSize.width, safeHeight, safeWidth]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <div className={`absolute left-1/2 top-1/2 overflow-hidden -translate-x-1/2 -translate-y-1/2 ${className}`} style={frameStyle}>
        {checkerboard ? (
          <div className="pointer-events-none absolute inset-0 bg-[repeating-conic-gradient(var(--color-background-tertiary)_0%_25%,var(--color-background-quaternary)_0%_50%)] bg-[length:24px_24px]" />
        ) : null}
        <div className={`absolute inset-0 ${stageClassName}`}>
          {children}
        </div>
      </div>
    </div>
  );
}

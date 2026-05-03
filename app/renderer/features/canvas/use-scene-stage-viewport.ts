import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

interface ViewportSize {
  width: number;
  height: number;
}

interface SceneStageViewport {
  containerRef: React.RefObject<HTMLDivElement | null>;
  viewportWidth: number;
  viewportHeight: number;
  sceneScale: number;
  sceneOffsetX: number;
  sceneOffsetY: number;
  // CSS scale to apply to the Stage wrapper so a fixed-resolution canvas
  // (e.g. 1920x1080 for NDI capture) visually shrinks to fit the on-screen
  // container. 1 when no fixedViewport is in use.
  displayScale: number;
}

export interface SceneViewportTransform {
  viewportWidth: number;
  viewportHeight: number;
  sceneScale: number;
  sceneOffsetX: number;
  sceneOffsetY: number;
  sceneWidth: number;
  sceneHeight: number;
}

export function mapViewportPointToScene(clientX: number, clientY: number, containerRect: DOMRect, viewport: SceneViewportTransform): { x: number; y: number } {
  const normalizedX = (clientX - containerRect.left) * (viewport.viewportWidth / Math.max(1, containerRect.width));
  const normalizedY = (clientY - containerRect.top) * (viewport.viewportHeight / Math.max(1, containerRect.height));
  const rawSceneX = (normalizedX - viewport.sceneOffsetX) / Math.max(0.0001, viewport.sceneScale);
  const rawSceneY = (normalizedY - viewport.sceneOffsetY) / Math.max(0.0001, viewport.sceneScale);
  return {
    x: Math.min(viewport.sceneWidth, Math.max(0, rawSceneX)),
    y: Math.min(viewport.sceneHeight, Math.max(0, rawSceneY)),
  };
}

export function useSceneStageViewport(sceneWidth: number, sceneHeight: number, fixedViewport: ViewportSize | null): SceneStageViewport {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<ViewportSize>({ width: 1, height: 1 });

  // Always observe the container — even with a fixedViewport — so we can
  // compute a CSS displayScale that fits the fixed-resolution canvas inside
  // the actual on-screen container (program surfaces, NDI thumbnails, etc.).
  useLayoutEffect(() => {
    const target = containerRef.current;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    setContainerSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
  }, []);

  useEffect(() => {
    const target = containerRef.current;
    if (!target) return;

    const observer = new ResizeObserver(() => {
      const rect = target.getBoundingClientRect();
      setContainerSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    });

    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return useMemo(() => {
    const viewportWidth = fixedViewport ? fixedViewport.width : Math.max(1, containerSize.width);
    const viewportHeight = fixedViewport ? fixedViewport.height : Math.max(1, containerSize.height);
    const sceneScale = Math.min(viewportWidth / sceneWidth, viewportHeight / sceneHeight);
    const drawWidth = sceneWidth * sceneScale;
    const drawHeight = sceneHeight * sceneScale;
    const sceneOffsetX = (viewportWidth - drawWidth) / 2;
    const sceneOffsetY = (viewportHeight - drawHeight) / 2;
    const displayScale = fixedViewport
      ? Math.min(containerSize.width / fixedViewport.width, containerSize.height / fixedViewport.height)
      : 1;

    return {
      containerRef,
      viewportWidth,
      viewportHeight,
      sceneScale,
      sceneOffsetX,
      sceneOffsetY,
      displayScale,
    };
  }, [containerSize.height, containerSize.width, fixedViewport, sceneHeight, sceneWidth]);
}

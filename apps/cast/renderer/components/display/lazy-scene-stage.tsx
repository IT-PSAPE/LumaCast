import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useBinScrollRoot } from '@renderer/components/layout/bin-shell';
import type { RenderScene, SceneSurface } from '@lumacast/composition';

const SceneStage = lazy(() =>
  import('@renderer/features/canvas/scene-stage').then((module) => ({ default: module.SceneStage })),
);

interface LazySceneStageProps {
  scene: RenderScene;
  surface: SceneSurface;
  className?: string;
}

export function LazySceneStage({ scene, surface, className }: LazySceneStageProps) {
  const [visible, setVisible] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const scrollRootRef = useBinScrollRoot();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Two thresholds rather than one: mount just before the tile scrolls into
    // view, but only tear it down once it is well outside. A single margin
    // would thrash a tile parked on the boundary. Tearing down at all matters
    // because every mounted stage retains its images in the shared cache —
    // releasing offscreen tiles is what lets that cache stay inside its
    // memory budget instead of growing with everything ever scrolled past.
    const mountObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { root: scrollRootRef?.current ?? null, rootMargin: '240px' },
    );

    const releaseObserver = new IntersectionObserver(
      (entries) => {
        if (entries.every((entry) => !entry.isIntersecting)) setVisible(false);
      },
      { root: scrollRootRef?.current ?? null, rootMargin: '1200px' },
    );

    mountObserver.observe(host);
    releaseObserver.observe(host);

    return () => {
      mountObserver.disconnect();
      releaseObserver.disconnect();
    };
  }, [scrollRootRef]);

  return (
    <div ref={hostRef} className={className}>
      {visible ? (
        <Suspense fallback={null}>
          <SceneStage scene={scene} surface={surface} className="absolute inset-0 pointer-events-none" />
        </Suspense>
      ) : null}
    </div>
  );
}

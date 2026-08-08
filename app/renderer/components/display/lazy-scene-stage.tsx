import { useEffect, useRef, useState } from 'react';
import { SceneStage } from '@renderer/features/canvas/scene-stage';
import type { RenderScene, SceneSurface } from '@renderer/features/canvas/scene-types';

interface LazySceneStageProps {
  scene: RenderScene;
  surface: SceneSurface;
  className?: string;
}

export function LazySceneStage({ scene, surface, className }: LazySceneStageProps) {
  const [visible, setVisible] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

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
      { rootMargin: '240px' },
    );

    const releaseObserver = new IntersectionObserver(
      (entries) => {
        if (entries.every((entry) => !entry.isIntersecting)) setVisible(false);
      },
      { rootMargin: '1200px' },
    );

    mountObserver.observe(host);
    releaseObserver.observe(host);

    return () => {
      mountObserver.disconnect();
      releaseObserver.disconnect();
    };
  }, []);

  return (
    <div ref={hostRef} className={className}>
      {visible ? <SceneStage scene={scene} surface={surface} className="absolute inset-0 pointer-events-none" /> : null}
    </div>
  );
}

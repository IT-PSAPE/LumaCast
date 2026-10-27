import { useEffect, useMemo, useRef, useState } from 'react';
import { Layers2 } from 'lucide-react';
import { Meter, type MeterZone } from '@lumacast/ui';
import type { StreamProject, StreamScene } from '../../shared/desktop-api';
import { getVisibleSourceIdsForScenes } from '../../shared/scene-reference-graph';
import { CanvasComposition } from '../canvas-composition';
import './scene-thumbnail.css';

const SCENE_AUDIO_ZONES: MeterZone[] = [
  { from: 0, tone: 'success' },
  { from: 0.65, tone: 'warning' },
  { from: 0.9, tone: 'error' },
];

export interface SceneThumbnailProps {
  project: StreamProject;
  /** The runtime scene used to draw this logical scene's current composition. */
  scene: StreamScene;
  videoElements: Map<string, HTMLVideoElement>;
  imageElements: Map<string, HTMLImageElement>;
  /** Source activity levels keyed by stable source ID. These are pre-fader levels. */
  meterLevels: Record<string, number>;
  /** Reports when this scene's thumbnail needs live capture resources. */
  onVisibilityChange?: (sceneId: string, visible: boolean) => void;
}

/** Root-sum-square gives one scene-level activity indication without mute/fader weighting. */
export function aggregateSceneAudioLevel(project: StreamProject, scene: StreamScene, meterLevels: Record<string, number>): number {
  return aggregateVisibleSourceLevels(getVisibleSourceIdsForScenes(project.scenes, [scene.id]), meterLevels);
}

function aggregateVisibleSourceLevels(visibleSourceIds: ReadonlySet<string>, meterLevels: Record<string, number>): number {
  let power = 0;
  for (const sourceId of visibleSourceIds) {
    const level = meterLevels[sourceId];
    if (typeof level === 'number' && Number.isFinite(level) && level > 0) power += level * level;
  }
  return Math.min(1, Math.sqrt(power));
}

export function SceneThumbnail({ project, scene, videoElements, imageElements, meterLevels, onVisibilityChange }: SceneThumbnailProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const visibilityCallbackRef = useRef(onVisibilityChange);
  visibilityCallbackRef.current = onVisibilityChange;
  const [renderEnabled, setRenderEnabled] = useState(false);
  const visibleSourceIds = useMemo(() => getVisibleSourceIdsForScenes(project.scenes, [scene.id]), [project.scenes, scene.id]);
  const level = useMemo(() => aggregateVisibleSourceLevels(visibleSourceIds, meterLevels), [visibleSourceIds, meterLevels]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let lastVisible: boolean | null = null;
    const reportVisibility = (visible: boolean) => {
      setRenderEnabled(visible);
      if (lastVisible === visible) return;
      lastVisible = visible;
      visibilityCallbackRef.current?.(scene.id, visible);
    };
    if (typeof IntersectionObserver === 'undefined') {
      reportVisibility(true);
      return () => visibilityCallbackRef.current?.(scene.id, false);
    }
    const observer = new IntersectionObserver(([entry]) => {
      reportVisibility(entry?.isIntersecting ?? false);
    }, { rootMargin: '96px 0px' });
    observer.observe(container);
    return () => {
      observer.disconnect();
      visibilityCallbackRef.current?.(scene.id, false);
    };
  }, [scene.id]);

  return (
    <div ref={containerRef} className="scene-thumbnail">
      <div className="scene-thumbnail-visual" aria-hidden="true">
        {renderEnabled ? (
          <div className="scene-thumbnail-canvas">
            <CanvasComposition
              project={project}
              scene={scene}
              videoElements={videoElements}
              imageElements={imageElements}
              renderScale={0.2}
              maxFrameRate={10}
              renderEnabled
            />
          </div>
        ) : scene.sources.length === 0 ? (
          <span className="scene-thumbnail-empty">Empty</span>
        ) : (
          <span className="scene-thumbnail-pending"><Layers2 size={16} /><span>Preview</span></span>
        )}
        {renderEnabled && scene.sources.length === 0 && <span className="scene-thumbnail-empty">Empty</span>}
      </div>
      <div className="scene-thumbnail-meter">
        <Meter
          value={level}
          min={0}
          max={1}
          zones={SCENE_AUDIO_ZONES}
          fill="banded"
          orientation="vertical"
          size="sm"
          label={`${scene.name} audio activity`}
        />
      </div>
    </div>
  );
}

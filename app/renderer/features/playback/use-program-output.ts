import { useMemo } from 'react';
import type { Id } from '@lumacast/kernel';
import type { NdiSourceStatus } from '@lumacast/protocol';
import type { RenderScene } from '@lumacast/composition';
import { useNdi } from '../../contexts/app-context';
import { useNavigation } from '../../contexts/navigation-context';
import { useSlides } from '../../contexts/slide-context';
import { useProgramScene } from '../../contexts/canvas/canvas-context';
import { useProgramOverlayPlayback } from '../../contexts/playback/playback-context';
import { buildOverlayRenderNodeId } from '../canvas/build-render-scene';

export interface ProgramOutput {
  scene: RenderScene;
  status: NdiSourceStatus;
  background: 'black' | 'transparent';
}

export function useProgramOutput(): ProgramOutput {
  const { state: { outputConfigs } } = useNdi();
  const { currentOutputItemRef } = useNavigation();
  const { liveSlide } = useSlides();
  const programScene = useProgramScene();
  const { activeOverlays } = useProgramOverlayPlayback();
  const outputConfig = outputConfigs.audience;
  const status: NdiSourceStatus = currentOutputItemRef && liveSlide ? 'live' : 'idle';
  const background = outputConfig.withAlpha ? 'transparent' : 'black';

  return useMemo<ProgramOutput>(() => ({
    scene: applyOverlayOpacity(programScene, activeOverlays),
    status,
    background,
  }), [activeOverlays, background, programScene, status]);
}

function applyOverlayOpacity(scene: RenderScene, activeOverlays: ReturnType<typeof useProgramOverlayPlayback>['activeOverlays']): RenderScene {
  if (activeOverlays.length === 0) return scene;

  const overlayOpacityByElementId = new Map<Id, number>();
  for (const overlay of activeOverlays) {
    for (const element of overlay.overlay.elements) {
      overlayOpacityByElementId.set(
        buildOverlayRenderNodeId(overlay.overlayId, overlay.stackOrder, element.id),
        overlay.opacityMultiplier,
      );
    }
  }

  let changed = false;
  const nodes = scene.nodes.map((node) => {
    const opacityMultiplier = overlayOpacityByElementId.get(node.id);
    if (typeof opacityMultiplier === 'undefined') return node;

    const nextOpacity = node.element.opacity * opacityMultiplier;
    if (nextOpacity === node.element.opacity) return node;
    changed = true;
    return {
      ...node,
      element: {
        ...node.element,
        opacity: nextOpacity,
      },
    };
  });

  if (!changed) return scene;
  return { ...scene, nodes };
}

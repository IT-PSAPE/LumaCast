// Live playhead preview: builds a FrameScene from the store every frame and
// renders it through ChordStage, plus an editing overlay (drag to move,
// corner handles to resize the selected cue's text box) and a title-safe
// guide. The export encoder never touches this file — it drives ChordStage
// directly with its own viewport and per-frame background canvas (see
// ../export/export-engine.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Layer, Rect, Stage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { useChordStore } from '../../store';
import { frameDurationMs } from '../../../shared/cue-model';
import type { TextBox } from '../../../shared/project';
import { buildFrameScene } from './build-frame-scene';
import { ChordStage, computeStageFit, type StageFit } from './chord-stage';
import { useBackgroundVideoSync } from './use-background-video-sync';

const PREVIEW_SLIDE_ID = 'chord-preview';
const SAFE_AREA_INSET = 0.05; // 90% title-safe guide

interface ViewportSize {
  width: number;
  height: number;
}

function useContainerSize(): [React.RefObject<HTMLDivElement | null>, ViewportSize] {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<ViewportSize>({ width: 1, height: 1 });

  useEffect(() => {
    const target = containerRef.current;
    if (!target) return;
    const update = () => {
      const rect = target.getBoundingClientRect();
      setSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return [containerRef, size];
}

function commitCueBox(cueId: string, patch: Partial<TextBox>): void {
  const state = useChordStore.getState();
  const cue = state.document.project.cues.find((entry) => entry.id === cueId);
  if (!cue) return;
  if (cue.override === null) {
    state.setTheme({ box: { ...state.document.project.theme.box, ...patch } });
  } else {
    state.setCueOverride(cueId, { ...cue.override, box: { ...(cue.override.box ?? {}), ...patch } });
  }
}

/** Alt-drag detaches a linked cue from the theme before the move is committed, so the drag only affects this one cue. */
function detachOnAltDrag(cueId: string, altKey: boolean): void {
  if (!altKey) return;
  const state = useChordStore.getState();
  const cue = state.document.project.cues.find((entry) => entry.id === cueId);
  if (cue && cue.override === null) state.detachCue(cueId);
}

interface EditableCue {
  cueId: string;
  box: TextBox;
}

interface PreviewOverlayStageProps {
  viewport: ViewportSize;
  fit: StageFit;
  editable: EditableCue | null;
  onClearSelection: () => void;
}

/** The interactive layer on top of the read-only ChordStage: click-to-clear on empty space, drag/resize on the selected cue's box. */
function PreviewOverlayStage({ viewport, fit, editable, onClearSelection }: PreviewOverlayStageProps) {
  const rectRef = useRef<Konva.Rect | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    transformer.nodes(editable && rectRef.current ? [rectRef.current] : []);
    transformer.getLayer()?.batchDraw();
  }, [editable?.cueId]);

  const handleStageMouseDown = useCallback((event: Konva.KonvaEventObject<MouseEvent>) => {
    const target = event.target;
    const isEmptyClick = target === target.getStage() || target.getClassName() === 'Layer';
    if (isEmptyClick) onClearSelection();
  }, [onClearSelection]);

  const handleDragStart = useCallback((event: Konva.KonvaEventObject<DragEvent>) => {
    if (!editable) return;
    detachOnAltDrag(editable.cueId, event.evt.altKey);
  }, [editable]);

  const handleDragEnd = useCallback(() => {
    const rect = rectRef.current;
    if (!rect || !editable) return;
    commitCueBox(editable.cueId, { x: rect.x(), y: rect.y() });
  }, [editable]);

  const handleTransformEnd = useCallback(() => {
    const rect = rectRef.current;
    if (!rect || !editable) return;
    const width = Math.max(1, rect.width() * rect.scaleX());
    const height = Math.max(1, rect.height() * rect.scaleY());
    rect.setAttrs({ scaleX: 1, scaleY: 1, width, height });
    commitCueBox(editable.cueId, { x: rect.x(), y: rect.y(), width, height, rotation: rect.rotation() });
  }, [editable]);

  return (
    <Stage width={viewport.width} height={viewport.height} className="absolute inset-0" onMouseDown={handleStageMouseDown}>
      <Layer>
        <Group x={fit.offsetX} y={fit.offsetY} scaleX={fit.scale} scaleY={fit.scale}>
          {editable ? (
            <Rect
              ref={rectRef}
              x={editable.box.x}
              y={editable.box.y}
              width={editable.box.width}
              height={editable.box.height}
              rotation={editable.box.rotation}
              fill="rgba(77,163,255,0.08)"
              stroke="#4DA3FF"
              strokeWidth={Math.max(0.5, 1 / fit.scale)}
              draggable
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onTransformEnd={handleTransformEnd}
            />
          ) : null}
          <Transformer
            ref={transformerRef}
            rotateEnabled
            anchorSize={10}
            borderStroke="#4DA3FF"
            anchorStroke="#0F1A2A"
            anchorFill="#4DA3FF"
            boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < 16 || Math.abs(newBox.height) < 16 ? oldBox : newBox)}
          />
        </Group>
      </Layer>
    </Stage>
  );
}

export interface PreviewCanvasProps {
  showGuides?: boolean;
}

export function PreviewCanvas({ showGuides = false }: PreviewCanvasProps) {
  const [containerRef, viewport] = useContainerSize();
  const project = useChordStore((state) => state.document.project);
  const timeMs = useChordStore((state) => state.playback.timeMs);
  const playing = useChordStore((state) => state.playback.playing);
  const backgroundUrl = useChordStore((state) => state.media.backgroundUrl);
  const selection = useChordStore((state) => state.selection);
  const clearSelection = useChordStore((state) => state.clearSelection);

  const quantizedTimeMs = useMemo(() => {
    const frame = frameDurationMs(project.composition.fps);
    return Math.round(timeMs / frame) * frame;
  }, [timeMs, project.composition.fps]);

  const scene = useMemo(
    () => buildFrameScene(project, quantizedTimeMs, { slideId: PREVIEW_SLIDE_ID, backgroundUrl }),
    [project, quantizedTimeMs, backgroundUrl],
  );

  const fit = useMemo(
    () => computeStageFit({ width: scene.width, height: scene.height }, viewport),
    [scene.width, scene.height, viewport.width, viewport.height],
  );

  useBackgroundVideoSync({
    src: project.background.kind === 'video' ? backgroundUrl : null,
    playing,
    timeMs,
    loop: project.background.kind === 'video' ? project.background.loop : false,
  });

  const editable: EditableCue | null = useMemo(() => {
    if (!scene.cue || !selection.includes(scene.cue.cueId)) return null;
    const element = scene.cue.node.element;
    return {
      cueId: scene.cue.cueId,
      box: { x: element.x, y: element.y, width: element.width, height: element.height, rotation: element.rotation, opacity: element.opacity },
    };
  }, [scene.cue, selection]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <ChordStage scene={scene} viewport={viewport} />
      {showGuides ? (
        <div
          className="pointer-events-none absolute border border-dashed border-white/30"
          style={{
            left: fit.offsetX + scene.width * fit.scale * SAFE_AREA_INSET,
            top: fit.offsetY + scene.height * fit.scale * SAFE_AREA_INSET,
            width: scene.width * fit.scale * (1 - SAFE_AREA_INSET * 2),
            height: scene.height * fit.scale * (1 - SAFE_AREA_INSET * 2),
          }}
        />
      ) : null}
      <PreviewOverlayStage viewport={viewport} fit={fit} editable={editable} onClearSelection={clearSelection} />
    </div>
  );
}

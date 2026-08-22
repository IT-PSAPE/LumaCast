import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Layer, Line, Rect, Stage, Transformer } from 'react-konva';
import type Konva from 'konva';
import type { Id } from '@lumacast/kernel';
import type { NdiOutputName } from '@lumacast/protocol';
import type { RenderScene, SceneSurface } from '@lumacast/composition';
import { traverseSceneNodes } from '@lumacast/composition';
import {
  SceneSlideBackground,
  useSceneStageEditor,
  useSceneStageViewport,
  type SceneViewportTransform,
} from '@lumacast/canvas';
import { ContextMenu } from '../../components/overlays/context-menu';
import { useElements } from '../../contexts/canvas/canvas-context';
import { hasClipboardContent } from '../../contexts/element/use-element-history';
import { setCaptureSurface } from '../../rendering/capture-surface-registry';
import { InlineTextEditor } from './inline-text-editor';
import { SceneNode } from './scene-node';

interface SceneStageProps {
  scene: RenderScene;
  surface?: SceneSurface;
  editable?: boolean;
  className?: string;
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  fixedViewport?: { width: number; height: number } | null;
  onViewportChange?: (viewport: SceneViewportTransform) => void;
  ndiCaptureSource?: NdiOutputName;
}

type SceneStageSharedProps = Required<Pick<SceneStageProps, 'scene' | 'surface' | 'className'>> & Omit<SceneStageProps, 'editable'>;
type CaptureStageLike = Pick<Konva.Stage, 'getLayers' | 'batchDraw'>;

const NOOP_ID_HANDLER = (_id: string) => {};
const NOOP_SELECT_HANDLER = (_id: string, _shiftKey: boolean) => {};
const NOOP_CONTEXT_MENU_HANDLER = (_id: Id, _x: number, _y: number) => {};
const NOOP_NODE_REF_HANDLER = (_id: string, _node: Konva.Group | null) => {};
const NOOP_STAGE_HANDLER = () => {};

export function pinFixedViewportStagePixelRatio(
  stage: CaptureStageLike | null,
  fixedViewport: { width: number; height: number } | null,
): void {
  if (!stage || !fixedViewport) return;

  let changed = false;
  for (const layer of stage.getLayers()) {
    const canvas = layer.getCanvas();
    if (canvas.getPixelRatio() === 1) continue;
    canvas.setPixelRatio(1);
    changed = true;
  }

  if (changed) {
    stage.batchDraw();
  }
}

export function publishCaptureSurface(
  stage: CaptureStageLike | null,
  fixedViewport: { width: number; height: number } | null,
  source: NdiOutputName,
): void {
  pinFixedViewportStagePixelRatio(stage, fixedViewport);
  const layer = stage?.getLayers()[0];
  setCaptureSurface(source, layer?.getNativeCanvasElement() ?? null);
}

function rotationSnaps(): number[] {
  return Array.from({ length: 24 }, (_value, index) => index * 15);
}

function fixedViewportEquals(
  previous: { width: number; height: number } | null | undefined,
  next: { width: number; height: number } | null | undefined,
): boolean {
  if (!previous && !next) return true;
  if (!previous || !next) return false;
  return previous.width === next.width && previous.height === next.height;
}

function sceneStagePropsEqual(previous: SceneStageProps, next: SceneStageProps): boolean {
  return previous.scene === next.scene
    && previous.surface === next.surface
    && previous.editable === next.editable
    && previous.className === next.className
    && previous.onDrop === next.onDrop
    && previous.onDragOver === next.onDragOver
    && previous.onViewportChange === next.onViewportChange
    && previous.ndiCaptureSource === next.ndiCaptureSource
    && fixedViewportEquals(previous.fixedViewport, next.fixedViewport);
}

function viewportStyle(displayScale: number, viewportWidth: number, viewportHeight: number): React.CSSProperties | undefined {
  if (displayScale === 1) return undefined;
  return {
    transform: `scale(${displayScale})`,
    transformOrigin: 'top left',
    width: viewportWidth,
    height: viewportHeight,
  };
}

function useViewportChangeEffect(
  onViewportChange: SceneStageProps['onViewportChange'],
  viewport: ReturnType<typeof useSceneStageViewport>,
  scene: RenderScene,
): void {
  useEffect(() => {
    if (!onViewportChange) return;
    onViewportChange({
      viewportWidth: viewport.viewportWidth,
      viewportHeight: viewport.viewportHeight,
      sceneScale: viewport.sceneScale,
      sceneOffsetX: viewport.sceneOffsetX,
      sceneOffsetY: viewport.sceneOffsetY,
      sceneWidth: scene.width,
      sceneHeight: scene.height,
    });
  }, [
    onViewportChange,
    scene.height,
    scene.width,
    viewport.sceneOffsetX,
    viewport.sceneOffsetY,
    viewport.sceneScale,
    viewport.viewportHeight,
    viewport.viewportWidth,
  ]);
}

function useCaptureSurfaceEffect(
  stageRef: React.RefObject<Konva.Stage | null>,
  fixedViewport: { width: number; height: number } | null,
  ndiCaptureSource: NdiOutputName | undefined,
  scene: RenderScene,
  viewport: ReturnType<typeof useSceneStageViewport>,
): void {
  const fixedViewportWidth = fixedViewport?.width ?? null;
  const fixedViewportHeight = fixedViewport?.height ?? null;

  useEffect(() => {
    if (!ndiCaptureSource) return;
    const captureViewport = fixedViewportWidth === null || fixedViewportHeight === null
      ? null
      : { width: fixedViewportWidth, height: fixedViewportHeight };

    const syncCaptureSource = () => {
      publishCaptureSurface(stageRef.current, captureViewport, ndiCaptureSource);
    };

    syncCaptureSource();
    const frameId = requestAnimationFrame(syncCaptureSource);

    return () => {
      cancelAnimationFrame(frameId);
      setCaptureSurface(ndiCaptureSource, null);
    };
  }, [
    stageRef,
    fixedViewportHeight,
    fixedViewportWidth,
    ndiCaptureSource,
    scene.height,
    scene.width,
    viewport.viewportHeight,
    viewport.viewportWidth,
  ]);
}

function ReadOnlySceneStage({
  scene,
  surface,
  className,
  onDrop,
  onDragOver,
  fixedViewport,
  onViewportChange,
  ndiCaptureSource,
}: SceneStageSharedProps) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const resolvedFixedViewport = fixedViewport ?? null;
  const viewport = useSceneStageViewport(scene.width, scene.height, resolvedFixedViewport);
  const sceneNodes = useMemo(() => traverseSceneNodes(scene.nodes), [scene.nodes]);
  const stageWrapperStyle = viewportStyle(viewport.displayScale, viewport.viewportWidth, viewport.viewportHeight);

  useViewportChangeEffect(onViewportChange, viewport, scene);
  useCaptureSurfaceEffect(stageRef, resolvedFixedViewport, ndiCaptureSource, scene, viewport);

  return (
    <div
      ref={viewport.containerRef}
      className={`relative h-full w-full overflow-hidden ${className}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <div style={stageWrapperStyle}>
        <Stage
          ref={stageRef}
          width={viewport.viewportWidth}
          height={viewport.viewportHeight}
          className={viewport.displayScale === 1 ? 'h-full w-full' : ''}
        >
          <Layer listening={false}>
            <Group
              name="scene-root"
              x={viewport.sceneOffsetX}
              y={viewport.sceneOffsetY}
              scaleX={viewport.sceneScale}
              scaleY={viewport.sceneScale}
            >
              <SceneSlideBackground background={scene.slide.background} width={scene.width} height={scene.height} surface={surface} ownerId={scene.slide.id} />
              {sceneNodes.map(({ node }) => (
                <SceneNode
                  key={node.id}
                  node={node}
                  surface={surface}
                  editable={false}
                  isBeingEdited={false}
                  onSelect={NOOP_SELECT_HANDLER}
                  onDoubleClick={NOOP_ID_HANDLER}
                  onDragStart={NOOP_ID_HANDLER}
                  onDragMove={NOOP_ID_HANDLER}
                  onDragEnd={NOOP_STAGE_HANDLER}
                  onTransform={NOOP_STAGE_HANDLER}
                  onTransformEnd={NOOP_STAGE_HANDLER}
                  onContextMenu={NOOP_CONTEXT_MENU_HANDLER}
                  setNodeRef={NOOP_NODE_REF_HANDLER}
                />
              ))}
            </Group>
          </Layer>
        </Stage>
      </div>
    </div>
  );
}

function EditableSceneStage({
  scene,
  surface,
  className,
  onDrop,
  onDragOver,
  fixedViewport,
  onViewportChange,
  ndiCaptureSource,
}: SceneStageSharedProps) {
  const {
    selectedElementIds,
    selectElements,
    toggleElementSelection,
    selectElement,
    clearSelection,
    effectiveElements,
    baseElements,
    setDraftElements,
    commitElementUpdates,
    setCanvasInteracting,
    reorderElements,
    copySelection,
    cutSelection,
    pasteSelection,
    duplicateSelection,
    deleteSelected,
  } = useElements();
  const editor = useSceneStageEditor({
    scene,
    editable: true,
    elements: {
      effectiveElements,
      baseElements,
      selectedElementIds,
      selectElements,
      toggleElementSelection,
      selectElement,
      clearSelection,
      setDraftElements,
      commitElementUpdates,
      setCanvasInteracting,
    },
  });
  const resolvedFixedViewport = fixedViewport ?? null;
  const viewport = useSceneStageViewport(scene.width, scene.height, resolvedFixedViewport);
  const snaps = useMemo(rotationSnaps, []);
  const sceneNodes = useMemo(() => traverseSceneNodes(scene.nodes), [scene.nodes]);
  const stageWrapperStyle = viewportStyle(viewport.displayScale, viewport.viewportWidth, viewport.viewportHeight);

  const applyOrder = useCallback((kind: 'front' | 'forward' | 'backward' | 'back') => {
    const ids = effectiveElements.map((element) => element.id);
    const selected = new Set(selectedElementIds.filter((id) => ids.includes(id)));
    if (selected.size === 0) return;
    let next = ids.slice();
    if (kind === 'front') {
      next = [...ids.filter((id) => !selected.has(id)), ...ids.filter((id) => selected.has(id))];
    } else if (kind === 'back') {
      next = [...ids.filter((id) => selected.has(id)), ...ids.filter((id) => !selected.has(id))];
    } else if (kind === 'forward') {
      for (let index = next.length - 2; index >= 0; index -= 1) {
        if (selected.has(next[index]) && !selected.has(next[index + 1])) {
          [next[index], next[index + 1]] = [next[index + 1], next[index]];
        }
      }
    } else {
      for (let index = 1; index < next.length; index += 1) {
        if (selected.has(next[index]) && !selected.has(next[index - 1])) {
          [next[index], next[index - 1]] = [next[index - 1], next[index]];
        }
      }
    }
    void reorderElements(next).catch(() => undefined);
  }, [effectiveElements, reorderElements, selectedElementIds]);
  const [menuState, setMenuState] = useState<{ x: number; y: number; targetId: Id | null } | null>(null);
  const menuPosition = menuState ? { x: menuState.x, y: menuState.y } : null;

  const handleNodeContextMenu = useCallback((id: Id, x: number, y: number) => {
    if (!selectedElementIds.includes(id)) selectElement(id);
    setMenuState({ x, y, targetId: id });
  }, [selectElement, selectedElementIds]);

  const handleEmptyContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setMenuState({ x: event.clientX, y: event.clientY, targetId: null });
  }, []);

  const closeMenu = useCallback(() => setMenuState(null), []);

  const hasSelection = selectedElementIds.length > 0;
  const canPaste = hasClipboardContent();

  useViewportChangeEffect(onViewportChange, viewport, scene);
  useCaptureSurfaceEffect(editor.stageRef, resolvedFixedViewport, ndiCaptureSource, scene, viewport);

  return (
    <div
      ref={viewport.containerRef}
      className={`relative h-full w-full overflow-hidden ${className}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onContextMenu={handleEmptyContextMenu}
    >
      <div style={stageWrapperStyle}>
        <Stage
          ref={editor.stageRef}
          width={viewport.viewportWidth}
          height={viewport.viewportHeight}
          className={viewport.displayScale === 1 ? 'h-full w-full' : ''}
          onMouseDown={editor.handleStageMouseDown}
          onMouseMove={editor.handleStageMouseMove}
          onMouseUp={editor.handleStageMouseUp}
        >
          <Layer listening>
            <Group
              name="scene-root"
              x={viewport.sceneOffsetX}
              y={viewport.sceneOffsetY}
              scaleX={viewport.sceneScale}
              scaleY={viewport.sceneScale}
            >
              <SceneSlideBackground background={scene.slide.background} width={scene.width} height={scene.height} surface={surface} ownerId={scene.slide.id} />
              {sceneNodes.map(({ node }) => (
                <SceneNode
                  key={node.id}
                  node={node}
                  surface={surface}
                  editable
                  isBeingEdited={editor.editingTextId === node.id}
                  onSelect={editor.handleNodeSelect}
                  onDoubleClick={editor.handleNodeDoubleClick}
                  onDragStart={editor.handleNodeDragStart}
                  onDragMove={editor.handleNodeDragMove}
                  onDragEnd={editor.handleNodeDragEnd}
                  onTransform={editor.handleNodeTransform}
                  onTransformEnd={editor.handleNodeTransformEnd}
                  onContextMenu={handleNodeContextMenu}
                  setNodeRef={editor.setNodeRef}
                />
              ))}
              {editor.guideLines.map((guide, index) => (
                <Line
                  key={`${guide.orientation}-${index}`}
                  points={guide.points}
                  stroke="#49D6A3"
                  dash={[6, 4]}
                  strokeWidth={1 / viewport.sceneScale}
                />
              ))}
              <Transformer
                ref={editor.transformerRef}
                visible={editor.editingTextId === null}
                rotateEnabled
                rotationSnaps={editor.shiftPressed ? snaps : []}
                rotationSnapTolerance={5}
                anchorSize={10}
                borderStroke="#4DA3FF"
                anchorStroke="#0F1A2A"
                anchorFill="#4DA3FF"
                boundBoxFunc={(oldBox, newBox) => {
                  if (Math.abs(newBox.width) < 16 || Math.abs(newBox.height) < 16) return oldBox;
                  return newBox;
                }}
              />
            </Group>
          </Layer>

          {editor.selectionBox ? (
            <Layer listening={false}>
              <Rect
                x={editor.selectionBox.x}
                y={editor.selectionBox.y}
                width={editor.selectionBox.width}
                height={editor.selectionBox.height}
                fill="#4DA3FF22"
                stroke="#4DA3FF"
                dash={[6, 4]}
              />
            </Layer>
          ) : null}
        </Stage>
      </div>
      {editor.editingTextId ? (
        <InlineTextEditor
          editingTextId={editor.editingTextId}
          effectiveElements={editor.effectiveElements}
          sceneOffsetX={viewport.sceneOffsetX}
          sceneOffsetY={viewport.sceneOffsetY}
          sceneScale={viewport.sceneScale}
          onCommit={editor.commitTextEdit}
          onCancel={editor.cancelTextEdit}
          onLiveChange={editor.liveUpdateTextEdit}
        />
      ) : null}
      {menuPosition ? (
        <ContextMenu.Root
          open={menuState !== null}
          position={menuPosition}
          onOpenChange={(nextOpen) => { if (!nextOpen) closeMenu(); }}
        >
          <ContextMenu.Portal>
            <ContextMenu.Menu>
              <ContextMenu.Item onSelect={() => applyOrder('front')}>Bring to front</ContextMenu.Item>
              <ContextMenu.Item onSelect={() => applyOrder('forward')}>Bring forward</ContextMenu.Item>
              <ContextMenu.Item onSelect={() => applyOrder('backward')}>Send backward</ContextMenu.Item>
              <ContextMenu.Item onSelect={() => applyOrder('back')}>Send to back</ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Item disabled={!hasSelection} onSelect={() => copySelection()}>Copy</ContextMenu.Item>
              <ContextMenu.Item disabled={!hasSelection} onSelect={() => { void cutSelection(); }}>Cut</ContextMenu.Item>
              <ContextMenu.Item disabled={!canPaste} onSelect={() => { void pasteSelection(); }}>Paste</ContextMenu.Item>
              <ContextMenu.Item disabled={!hasSelection} onSelect={() => { void duplicateSelection(); }}>Duplicate</ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Item disabled={!hasSelection} variant="destructive" onSelect={() => { void deleteSelected(); }}>Delete</ContextMenu.Item>
            </ContextMenu.Menu>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      ) : null}
    </div>
  );
}

export const SceneStage = memo(function SceneStage({
  scene,
  surface = 'show',
  editable = false,
  className = '',
  onDrop,
  onDragOver,
  fixedViewport = null,
  onViewportChange,
  ndiCaptureSource,
}: SceneStageProps) {
  if (!editable) {
    return (
      <ReadOnlySceneStage
        scene={scene}
        surface={surface}
        className={className}
        onDrop={onDrop}
        onDragOver={onDragOver}
        fixedViewport={fixedViewport}
        onViewportChange={onViewportChange}
        ndiCaptureSource={ndiCaptureSource}
      />
    );
  }

  return (
    <EditableSceneStage
      scene={scene}
      surface={surface}
      className={className}
      onDrop={onDrop}
      onDragOver={onDragOver}
      fixedViewport={fixedViewport}
      onViewportChange={onViewportChange}
      ndiCaptureSource={ndiCaptureSource}
    />
  );
}, sceneStagePropsEqual);

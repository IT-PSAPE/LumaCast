import { memo, useCallback, useMemo, useState } from 'react';
import { Group, Layer, Line, Rect, Stage, Transformer } from 'react-konva';
import type { Id } from '@lumacast/kernel';
import type { AlignTarget } from '@lumacast/composition';
import { traverseSceneNodes } from '@lumacast/composition';
import {
  SceneSlideBackground,
  useSceneStageEditor,
  useSceneStageViewport,
} from '@lumacast/canvas';
import { ContextMenu } from '@lumacast/ui';
import { useElements } from '../../contexts/canvas/canvas-context';
import { hasClipboardContent } from '../../contexts/element/use-element-history';
import {
  pinFixedViewportStagePixelRatio,
  publishCaptureSurface,
  useCaptureSurfaceEffect,
  useViewportChangeEffect,
  viewportStyle,
} from '../../rendering/scene-render-stage';
import type { SceneRenderStageProps } from '../../rendering/scene-render-stage';
import { InlineTextEditor } from './inline-text-editor';
import { SceneNode } from '../../rendering/scene-node';
import type { SceneNodeInteractions } from '../../rendering/scene-node';

type SceneStageProps = SceneRenderStageProps;
export { pinFixedViewportStagePixelRatio, publishCaptureSurface };

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
    && previous.className === next.className
    && previous.onDrop === next.onDrop
    && previous.onDragOver === next.onDragOver
    && previous.onViewportChange === next.onViewportChange
    && previous.ndiCaptureSource === next.ndiCaptureSource
    && fixedViewportEquals(previous.fixedViewport, next.fixedViewport);
}

function EditableSceneStage({
  scene,
  surface = 'show',
  className = '',
  onDrop,
  onDragOver,
  fixedViewport,
  onViewportChange,
  ndiCaptureSource,
}: SceneStageProps) {
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
    groupSelection,
    ungroupSelection,
    alignSelection,
    distributeSelection,
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

  const nodeInteractions = useMemo<SceneNodeInteractions>(() => ({
    onSelect: editor.handleNodeSelect,
    onDoubleClick: editor.handleNodeDoubleClick,
    onDragStart: editor.handleNodeDragStart,
    onDragMove: editor.handleNodeDragMove,
    onDragEnd: editor.handleNodeDragEnd,
    onTransform: editor.handleNodeTransform,
    onTransformEnd: editor.handleNodeTransformEnd,
    onContextMenu: handleNodeContextMenu,
    setNodeRef: editor.setNodeRef,
  }), [
    editor.handleNodeSelect,
    editor.handleNodeDoubleClick,
    editor.handleNodeDragStart,
    editor.handleNodeDragMove,
    editor.handleNodeDragEnd,
    editor.handleNodeTransform,
    editor.handleNodeTransformEnd,
    editor.setNodeRef,
    handleNodeContextMenu,
  ]);

  const handleEmptyContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setMenuState({ x: event.clientX, y: event.clientY, targetId: null });
  }, []);

  const closeMenu = useCallback(() => setMenuState(null), []);

  const hasSelection = selectedElementIds.length > 0;
  const canPaste = hasClipboardContent();
  const canGroup = selectedElementIds.length >= 2;
  const canDistribute = selectedElementIds.length >= 3;
  const singleSelectedElement = selectedElementIds.length === 1
    ? effectiveElements.find((element) => element.id === selectedElementIds[0]) ?? null
    : null;
  const canUngroup = singleSelectedElement?.type === 'group';
  const alignTarget: AlignTarget = selectedElementIds.length >= 2 ? 'selection' : 'slide';

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
                  interactions={nodeInteractions}
                  isBeingEdited={editor.editingTextId === node.id}
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
                onTransformStart={editor.handleNodeTransformStart}
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
          key={editor.editingTextId}
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
              <ContextMenu.Item disabled={!canGroup} onSelect={() => { void groupSelection(); }}>Group</ContextMenu.Item>
              <ContextMenu.Item disabled={!canUngroup} onSelect={() => { void ungroupSelection(); }}>Ungroup</ContextMenu.Item>
              <ContextMenu.Submenu label="Align" disabled={!hasSelection}>
                <ContextMenu.Item onSelect={() => { void alignSelection('left', alignTarget); }}>Left</ContextMenu.Item>
                <ContextMenu.Item onSelect={() => { void alignSelection('centerX', alignTarget); }}>Center</ContextMenu.Item>
                <ContextMenu.Item onSelect={() => { void alignSelection('right', alignTarget); }}>Right</ContextMenu.Item>
                <ContextMenu.Item onSelect={() => { void alignSelection('top', alignTarget); }}>Top</ContextMenu.Item>
                <ContextMenu.Item onSelect={() => { void alignSelection('centerY', alignTarget); }}>Middle</ContextMenu.Item>
                <ContextMenu.Item onSelect={() => { void alignSelection('bottom', alignTarget); }}>Bottom</ContextMenu.Item>
              </ContextMenu.Submenu>
              <ContextMenu.Submenu label="Distribute" disabled={!canDistribute}>
                <ContextMenu.Item onSelect={() => { void distributeSelection('horizontal'); }}>Horizontally</ContextMenu.Item>
                <ContextMenu.Item onSelect={() => { void distributeSelection('vertical'); }}>Vertically</ContextMenu.Item>
              </ContextMenu.Submenu>
              <ContextMenu.Separator />
              <ContextMenu.Item disabled={!hasSelection} variant="destructive" onSelect={() => { void deleteSelected(); }}>Delete</ContextMenu.Item>
            </ContextMenu.Menu>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      ) : null}
    </div>
  );
}

export const SceneStage = memo(EditableSceneStage, sceneStagePropsEqual);

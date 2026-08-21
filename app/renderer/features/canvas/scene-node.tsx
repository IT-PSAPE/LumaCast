import { Fragment, memo } from 'react';
import { Group } from 'react-konva';
import type Konva from 'konva';
import type { Id } from '@lumacast/kernel';
import type { RenderNode, SceneSurface } from '@lumacast/composition';
import { isSceneNodeVisible, sceneNodeFrame } from '@lumacast/composition';
import { renderSceneNodeContent } from '@lumacast/canvas';

interface SceneNodeProps {
  node: RenderNode;
  surface: SceneSurface;
  editable: boolean;
  isBeingEdited: boolean;
  onSelect: (id: string, shiftKey: boolean) => void;
  onDoubleClick: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string) => void;
  onDragEnd: () => void;
  onTransform: () => void;
  onTransformEnd: () => void;
  onContextMenu: (id: Id, x: number, y: number) => void;
  setNodeRef: (id: string, node: Konva.Group | null) => void;
}

const SceneNode = memo(function SceneNode({
  node, surface, editable, isBeingEdited,
  onSelect, onDoubleClick, onDragStart, onDragMove, onDragEnd,
  onTransform, onTransformEnd, onContextMenu, setNodeRef,
}: SceneNodeProps) {
  if (!isSceneNodeVisible(node)) return null;
  const frame = sceneNodeFrame(node);

  function handleClick(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    event.cancelBubble = true;
    onSelect(node.id, event.evt.shiftKey);
  }

  function handleDblClick(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    event.cancelBubble = true;
    onDoubleClick(node.id);
  }

  function handleContextMenu(event: Konva.KonvaEventObject<PointerEvent>) {
    event.cancelBubble = true;
    event.evt.preventDefault();
    // Stop the native event so the wrapper's React onContextMenu doesn't also
    // fire and treat this as an empty-canvas right-click.
    event.evt.stopPropagation();
    onContextMenu(node.id, event.evt.clientX, event.evt.clientY);
  }

  function handleDragStart() {
    onDragStart(node.id);
  }

  function handleDragMove() {
    onDragMove(node.id);
  }

  function handleRef(ref: Konva.Group | null) {
    setNodeRef(node.id, ref);
  }

  const listening = editable && !node.visual.locked;

  return (
    <Fragment>
      <Group
        ref={handleRef}
        x={frame.x}
        y={frame.y}
        width={frame.width}
        height={frame.height}
        rotation={frame.rotation}
        // The text stays rendered on the canvas while editing — the inline editor
        // is a transparent input overlay, so there is one render path (no swap).
        opacity={frame.opacity}
        scaleX={frame.scaleX}
        scaleY={frame.scaleY}
        offsetX={frame.offsetX}
        offsetY={frame.offsetY}
        listening={listening}
        draggable={editable && !node.visual.locked && !isBeingEdited}
        onMouseDown={editable ? handleClick : undefined}
        onTap={editable ? handleClick : undefined}
        onDblClick={editable ? handleDblClick : undefined}
        onDblTap={editable ? handleDblClick : undefined}
        onDragStart={editable ? handleDragStart : undefined}
        onDragMove={editable ? handleDragMove : undefined}
        onDragEnd={editable ? onDragEnd : undefined}
        onTransform={editable ? onTransform : undefined}
        onTransformEnd={editable ? onTransformEnd : undefined}
        onContextMenu={editable ? handleContextMenu : undefined}
      >
        {renderSceneNodeContent(node, surface)}
      </Group>
    </Fragment>
  );
});

export { SceneNode };
export type { SceneNodeProps };

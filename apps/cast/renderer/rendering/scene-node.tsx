import { Fragment, memo } from 'react';
import { Group } from 'react-konva';
import type Konva from 'konva';
import type { Id } from '@lumacast/kernel';
import type { RenderNode, SceneSurface } from '@lumacast/composition';
import { isSceneNodeVisible, sceneNodeFrame } from '@lumacast/composition';
import { renderSceneNodeContent } from '@lumacast/canvas';

export interface SceneNodeInteractions {
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

interface SceneNodeProps {
  node: RenderNode;
  surface: SceneSurface;
  interactions?: SceneNodeInteractions;
  isBeingEdited?: boolean;
}

const SceneNode = memo(function SceneNode({
  node, surface, interactions, isBeingEdited = false,
}: SceneNodeProps) {
  if (!isSceneNodeVisible(node)) return null;
  const frame = sceneNodeFrame(node);

  function handleClick(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if ('button' in event.evt && event.evt.button !== 0) return;
    event.cancelBubble = true;
    interactions?.onSelect(node.id, event.evt.shiftKey || event.evt.ctrlKey || event.evt.metaKey);
  }

  function handleDblClick(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    event.cancelBubble = true;
    interactions?.onDoubleClick(node.id);
  }

  function handleContextMenu(event: Konva.KonvaEventObject<PointerEvent>) {
    event.cancelBubble = true;
    event.evt.preventDefault();
    // Stop the native event so the wrapper's React onContextMenu doesn't also
    // fire and treat this as an empty-canvas right-click.
    event.evt.stopPropagation();
    interactions?.onContextMenu(node.id, event.evt.clientX, event.evt.clientY);
  }

  function handleDragStart() {
    interactions?.onDragStart(node.id);
  }

  function handleDragMove() {
    interactions?.onDragMove(node.id);
  }

  function handleRef(ref: Konva.Group | null) {
    interactions?.setNodeRef(node.id, ref);
  }

  const listening = Boolean(interactions) && !node.visual.locked;

  return (
    <Fragment>
      <Group
        ref={interactions ? handleRef : undefined}
        x={frame.x}
        y={frame.y}
        width={frame.width}
        height={frame.height}
        rotation={frame.rotation}
        opacity={frame.opacity}
        scaleX={frame.scaleX}
        scaleY={frame.scaleY}
        offsetX={frame.offsetX}
        offsetY={frame.offsetY}
        listening={listening}
        draggable={Boolean(interactions) && !node.visual.locked && !isBeingEdited}
        onClick={interactions ? handleClick : undefined}
        onTap={interactions ? handleClick : undefined}
        onDblClick={interactions ? handleDblClick : undefined}
        onDblTap={interactions ? handleDblClick : undefined}
        onDragStart={interactions ? handleDragStart : undefined}
        onDragMove={interactions ? handleDragMove : undefined}
        onDragEnd={interactions?.onDragEnd}
        onTransform={interactions?.onTransform}
        onTransformEnd={interactions?.onTransformEnd}
        onContextMenu={interactions ? handleContextMenu : undefined}
      >
        {/* While a text element is being edited the inline editor renders its
            text in the DOM (one layout engine for text, caret, and selection),
            so the canvas draws only the element's background for it. */}
        {renderSceneNodeContent(node, surface, { hideText: isBeingEdited })}
      </Group>
    </Fragment>
  );
});

export { SceneNode };
export type { SceneNodeProps };

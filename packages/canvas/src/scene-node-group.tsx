import { Fragment } from 'react';
import { Group, Rect } from 'react-konva';
import type { RenderNode, SceneSurface } from '@lumacast/composition';
import { isSceneNodeVisible, sceneNodeFrame } from '@lumacast/composition';
import { renderSceneNodeContent, type SceneNodeContentOptions } from './scene-node-content';

// Fully transparent, but a real (non-alpha-only) fill color so the group's
// own bounding box stays hit-testable in its own right (Konva hit-tests a
// shape's painted region, not effective alpha) even though children paint
// over it. Mirrors scene-node-media.tsx's NO_FILL_COLOR sentinel.
const GROUP_HIT_FILL_COLOR = '#2b303900';

interface SceneNodeGroupProps {
  node: RenderNode;
  surface: SceneSurface;
  options: SceneNodeContentOptions;
}

// A group paints each child through the same content dispatcher recursively
// (so nested groups work), composing each child's own frame — position,
// size, rotation, flip — the same way scene-node.tsx composes a top-level
// node's frame, but relative to the group's own already-transformed local
// box instead of the slide. `renderSceneNodeContent` renders this component
// for `node.element.type === 'group'`.
//
// Children are not individually interactive in v1: every child subtree is
// `listening={false}`, so Konva's hit test skips it entirely (an ancestor's
// `listening=false` excludes all of its descendants from the hit graph, not
// just itself) and a click anywhere in the group's bounding box instead hits
// this component's own invisible hit rect, whose event bubbles up to the
// outer Konva `Group` that app/renderer/features/canvas/scene-node.tsx
// renders for the group element itself — the node that actually carries the
// selection/drag/transform handlers. Selecting a child directly is not
// supported (the whole group selects as one unit).
export function SceneNodeGroup({ node, surface, options }: SceneNodeGroupProps) {
  const children = node.children ?? [];
  return (
    <Fragment>
      <Rect
        x={0}
        y={0}
        width={node.element.width}
        height={node.element.height}
        fill={GROUP_HIT_FILL_COLOR}
      />
      {children.map((child) => {
        if (!isSceneNodeVisible(child)) return null;
        const frame = sceneNodeFrame(child);
        return (
          <Group
            key={child.id}
            listening={false}
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
          >
            {renderSceneNodeContent(child, surface, options)}
          </Group>
        );
      })}
    </Fragment>
  );
}

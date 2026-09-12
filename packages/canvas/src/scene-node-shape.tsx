import { Rect } from 'react-konva';
import type { RenderNode } from '@lumacast/composition';

interface SceneNodeShapeProps {
  node: RenderNode;
}

export function SceneNodeShape({ node }: SceneNodeShapeProps) {
  const element = node.element;
  const payload = element.payload as {
    fillColor: string;
    borderColor: string;
    borderWidth: number;
    borderRadius: number;
    strokeWidth?: number;
    strokeColor?: string;
  };

  return (
    <Rect
      x={0}
      y={0}
      width={element.width}
      height={element.height}
      fill={node.visual.fillEnabled ? payload.fillColor : 'transparent'}
      stroke={node.visual.strokeEnabled ? (payload.strokeColor ?? payload.borderColor) : undefined}
      strokeWidth={node.visual.strokeEnabled ? (payload.strokeWidth ?? payload.borderWidth) : 0}
      cornerRadius={Math.max(0, payload.borderRadius ?? 0)}
      shadowEnabled={node.visual.shadowEnabled}
      shadowColor={node.visual.shadowColor}
      shadowBlur={node.visual.shadowBlur}
      shadowOffsetX={node.visual.shadowOffsetX}
      shadowOffsetY={node.visual.shadowOffsetY}
    />
  );
}

import type { CSSProperties } from 'react';
import type { SlideBackgroundFit } from '@core/types';
import type {
  ResolvedBackground,
  ResolvedBoxVisual,
  ResolvedMediaState,
  ResolvedRenderNode,
  ResolvedRenderScene,
  ResolvedTextRenderNode,
  SceneSurface,
} from '../features/canvas/scene-types';

// Provider-independent render-only scene layer. Consumes the resolved
// ResolvedRenderScene contract and paints a deterministic DOM representation:
// background then nodes back→front, honoring visibility, nesting, surface
// flags, and resolved media handles. No application providers required.

export interface SceneLayerProps {
  scene: ResolvedRenderScene;
  className?: string;
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function clampPercentage(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function boxShadow(box: ResolvedBoxVisual): string | undefined {
  if (!box.shadowEnabled) return undefined;
  return `${box.shadowOffsetX}px ${box.shadowOffsetY}px ${box.shadowBlur}px ${box.shadowColor}`;
}

function gradientImage(background: Extract<ResolvedBackground, { type: 'gradient' }>): string {
  const stops = background.stops.map((stop) => `${stop.color} ${clampPercentage(stop.position)}%`).join(', ');
  if (background.kind === 'linear') return `linear-gradient(${finite(background.angle)}deg, ${stops})`;
  return `radial-gradient(circle, ${stops})`;
}

function MediaBody({
  media,
  kind,
  fit,
  surface,
}: {
  media: ResolvedMediaState;
  kind: 'image' | 'video';
  fit?: SlideBackgroundFit;
  surface: SceneSurface;
}) {
  if (media.status === 'loaded') {
    const src = typeof media.resource.src === 'string' ? media.resource.src : '';
    const style: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };
    if (fit) style.objectFit = fit;
    else style.objectFit = 'cover';
    if (kind === 'video') {
      return <video data-media="loaded" src={src} muted playsInline style={style} />;
    }
    return <img data-media="loaded" src={src} alt="" style={style} />;
  }
  if (media.status === 'broken' && surface === 'deck-editor') {
    return (
      <div
        data-media="broken"
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'repeating-linear-gradient(45deg, #050505 0px, #050505 12px, transparent 12px, transparent 24px)',
        }}
      />
    );
  }
  return <div data-media={media.status} style={{ position: 'absolute', inset: 0 }} />;
}

function ShapeContent({ box }: { box: ResolvedBoxVisual }) {
  return (
    <div
      data-node-content="shape"
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: box.fillEnabled ? box.fillColor : 'transparent',
        border: box.strokeEnabled ? `${finite(box.strokeWidth)}px solid ${box.strokeColor}` : undefined,
        borderRadius: Math.max(0, finite(box.borderRadius)),
        boxShadow: boxShadow(box),
      }}
    />
  );
}

function TextContent({ node }: { node: ResolvedTextRenderNode }) {
  const { box, text } = node;
  const alignItems = text.verticalAlign === 'top' ? 'flex-start' : text.verticalAlign === 'bottom' ? 'flex-end' : 'center';
  const justifyContent = text.alignment === 'center' ? 'center' : text.alignment === 'right' ? 'flex-end' : 'flex-start';
  return (
    <div
      data-node-content="text"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems,
        justifyContent,
        backgroundColor: box.fillEnabled ? box.fillColor : 'transparent',
        borderRadius: Math.max(0, finite(box.borderRadius)),
        boxShadow: boxShadow(box),
      }}
    >
      <div
        style={{
          color: text.color,
          fontFamily: text.fontFamily,
          fontSize: finite(text.fontSize),
          fontWeight: text.fontWeight,
          fontStyle: text.italic ? 'italic' : 'normal',
          lineHeight: text.lineHeight,
          textAlign: text.alignment,
          whiteSpace: 'pre-wrap',
          WebkitTextStroke: text.textStrokeEnabled
            ? `${finite(text.textStrokeWidth)}px ${text.textStrokeColor}`
            : undefined,
        }}
      >
        {text.text}
      </div>
    </div>
  );
}

function nodeFrameStyle(node: ResolvedRenderNode): CSSProperties {
  return {
    position: 'absolute',
    left: finite(node.x),
    top: finite(node.y),
    width: finite(node.width),
    height: finite(node.height),
    opacity: finite(node.opacity, 1),
    zIndex: finite(node.zIndex),
    transform: `rotate(${finite(node.rotation)}deg) scale(${node.flipX ? -1 : 1}, ${node.flipY ? -1 : 1})`,
    transformOrigin: `${node.flipX ? '100%' : '0%'} ${node.flipY ? '100%' : '0%'}`,
  };
}

function NodeContent({ node, surface }: { node: ResolvedRenderNode; surface: SceneSurface }) {
  switch (node.kind) {
    case 'shape':
      return <ShapeContent box={node.box} />;
    case 'text':
      return <TextContent node={node} />;
    case 'image':
    case 'video':
      return <MediaBody media={node.media} kind={node.kind} surface={surface} />;
    case 'group':
      return (
        <div data-node-content="group" style={{ position: 'absolute', inset: 0 }}>
          {(node.children ?? []).map((child, index) => (
            <SceneNode key={child.id} node={child} order={index} surface={surface} />
          ))}
        </div>
      );
    default:
      return null;
  }
}

function SceneNode({ node, order, surface }: { node: ResolvedRenderNode; order: number; surface: SceneSurface }) {
  if (node.visible === false) return null;
  return (
    <div
      data-node=""
      data-node-id={node.id}
      data-node-kind={node.kind}
      data-node-order={order}
      data-node-selected={node.selected ? 'true' : 'false'}
      data-node-locked={node.locked ? 'true' : 'false'}
      data-node-zindex={node.zIndex}
      style={nodeFrameStyle(node)}
    >
      <NodeContent node={node} surface={surface} />
    </div>
  );
}

function SceneBackground({ background, surface }: { background: ResolvedBackground; surface: SceneSurface }) {
  if (background.type === 'color') {
    return <div data-background="color" style={{ position: 'absolute', inset: 0, backgroundColor: background.color }} />;
  }
  if (background.type === 'gradient') {
    return <div data-background="gradient" style={{ position: 'absolute', inset: 0, backgroundImage: gradientImage(background) }} />;
  }
  return (
    <div data-background={background.type} style={{ position: 'absolute', inset: 0 }}>
      <MediaBody media={background.media} kind={background.type} fit={background.fit} surface={surface} />
    </div>
  );
}

export function SceneLayer({ scene, className = '' }: SceneLayerProps) {
  return (
    <div
      data-scene=""
      data-surface={scene.surface}
      data-width={scene.width}
      data-height={scene.height}
      data-interactive={scene.interactive ? 'true' : 'false'}
      className={`relative overflow-hidden ${className}`}
      style={{ width: finite(scene.width, 1), height: finite(scene.height, 1) }}
    >
      {scene.background ? <SceneBackground background={scene.background} surface={scene.surface} /> : null}
      {scene.nodes.map((node, index) => (
        <SceneNode key={node.id} node={node} order={index} surface={scene.surface} />
      ))}
    </div>
  );
}

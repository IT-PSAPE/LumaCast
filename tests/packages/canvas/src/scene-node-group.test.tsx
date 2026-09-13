import { cleanup, render, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RenderNode, ResolvedMediaState, VisualPayloadState } from '@lumacast/composition';
import { renderSceneNodeContent } from '../../../../packages/canvas/src/scene-node-content';

interface RecordedProps {
  [key: string]: unknown;
  children?: unknown;
}

const rects: RecordedProps[] = [];
const images: RecordedProps[] = [];
const groups: RecordedProps[] = [];

const imageStates = new Map<string, ResolvedMediaState>();

vi.mock('react-konva', () => ({
  Group: (props: RecordedProps) => {
    groups.push(props);
    return <>{props.children ?? null}</>;
  },
  Image: (props: RecordedProps) => {
    images.push(props);
    return null;
  },
  Rect: (props: RecordedProps) => {
    rects.push(props);
    return null;
  },
}));

vi.mock('../../../../packages/canvas/src/use-k-image', () => ({
  useKImage: (src: string | null) => (src ? imageStates.get(src) ?? { status: 'loading' } : { status: 'empty' }),
}));

vi.mock('../../../../packages/canvas/src/use-k-video', () => ({
  useKVideo: () => ({ status: 'empty' }),
}));

const DEFAULT_VISUAL: VisualPayloadState = {
  visible: true,
  locked: false,
  flipX: false,
  flipY: false,
  fillEnabled: false,
  fillColor: 'transparent',
  strokeEnabled: false,
  strokeColor: '#000000',
  strokeWidth: 0,
  strokePosition: 'inside',
  borderRadius: 0,
  shadowEnabled: false,
  shadowColor: '#000000',
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
};

function shapeNode(id: string, frame: { x: number; y: number; width: number; height: number; rotation?: number }): RenderNode {
  return {
    id,
    element: {
      id,
      slideId: 'slide-1',
      type: 'shape',
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      rotation: frame.rotation ?? 0,
      opacity: 1,
      zIndex: 0,
      layer: 'content',
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:00:00.000Z',
      payload: { fillColor: '#112233', borderColor: '#000000', borderWidth: 0, borderRadius: 0 },
    } as never,
    visual: DEFAULT_VISUAL,
    isVideo: false,
  };
}

function imageNode(id: string, src: string, frame: { x: number; y: number; width: number; height: number }): RenderNode {
  return {
    id,
    element: {
      id,
      slideId: 'slide-1',
      type: 'image',
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      layer: 'content',
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:00:00.000Z',
      payload: { src },
    } as never,
    visual: DEFAULT_VISUAL,
    isVideo: false,
  };
}

function groupNode(
  id: string,
  frame: { x: number; y: number; width: number; height: number; rotation?: number },
  children: RenderNode[],
): RenderNode {
  return {
    id,
    element: {
      id,
      slideId: 'slide-1',
      type: 'group',
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      rotation: frame.rotation ?? 0,
      opacity: 1,
      zIndex: 0,
      layer: 'content',
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:00:00.000Z',
      payload: { children: children.map((child) => child.element) },
    } as never,
    visual: DEFAULT_VISUAL,
    isVideo: false,
    children,
  };
}

function loadedImage(): HTMLImageElement {
  const image = document.createElement('img');
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 100 });
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 100 });
  return image;
}

async function flushRaf(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

describe('SceneNodeGroup (via renderSceneNodeContent)', () => {
  afterEach(() => {
    cleanup();
    rects.length = 0;
    images.length = 0;
    groups.length = 0;
    imageStates.clear();
  });

  it('renders each child with its own composed frame, relative to the group box', () => {
    const shape = shapeNode('shape-1', { x: 5, y: 6, width: 30, height: 40, rotation: 15 });
    const group = groupNode('group-1', { x: 10, y: 20, width: 200, height: 150 }, [shape]);

    render(<>{renderSceneNodeContent(group, 'show', {})}</>);

    const shapeGroup = groups.find((props) => props.x === 5 && props.y === 6);
    expect(shapeGroup).toMatchObject({
      x: 5, y: 6, width: 30, height: 40, rotation: 15, opacity: 1, scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, listening: false,
    });
    // The child's own content (a plain shape Rect) draws at its own box size,
    // independent of the group's box size.
    const shapeRect = rects.find((props) => props.width === 30 && props.height === 40);
    expect(shapeRect).toBeDefined();
  });

  it('paints an invisible, still-listening hit rect sized to the group box', () => {
    const shape = shapeNode('shape-1', { x: 0, y: 0, width: 10, height: 10 });
    const group = groupNode('group-1', { x: 0, y: 0, width: 200, height: 150 }, [shape]);

    render(<>{renderSceneNodeContent(group, 'show', {})}</>);

    const hitRect = rects.find((props) => props.width === 200 && props.height === 150);
    expect(hitRect).toBeDefined();
    expect(hitRect!.fill).toBe('#2b303900');
    // Unlike every child wrapper, the hit rect is not explicitly non-listening
    // — a click anywhere in the box must still resolve to this node.
    expect(hitRect!.listening).not.toBe(false);
  });

  it('renders nested groups recursively, composing each level its own frame', () => {
    const deepShape = shapeNode('deep-shape-1', { x: 1, y: 2, width: 10, height: 10 });
    const nestedGroup = groupNode('nested-group-1', { x: 100, y: 20, width: 80, height: 80 }, [deepShape]);
    const outerGroup = groupNode('outer-group-1', { x: 0, y: 0, width: 300, height: 300 }, [nestedGroup]);

    render(<>{renderSceneNodeContent(outerGroup, 'show', {})}</>);

    // The nested group's own wrapper composes relative to the outer group's box.
    const nestedGroupWrapper = groups.find((props) => props.x === 100 && props.y === 20 && props.width === 80);
    expect(nestedGroupWrapper).toMatchObject({ listening: false });
    // The nested group paints its own hit rect at its own (80x80) box size.
    expect(rects.some((props) => props.width === 80 && props.height === 80 && props.fill === '#2b303900')).toBe(true);
    // The grandchild's wrapper composes relative to the nested group's box.
    const deepShapeWrapper = groups.find((props) => props.x === 1 && props.y === 2 && props.width === 10);
    expect(deepShapeWrapper).toMatchObject({ listening: false });
  });

  it('propagates onMediaLoad from a child image up through the group', async () => {
    imageStates.set('asset://child.png', { status: 'loaded', resource: loadedImage() });
    const image = imageNode('image-1', 'asset://child.png', { x: 5, y: 5, width: 40, height: 40 });
    const group = groupNode('group-1', { x: 0, y: 0, width: 200, height: 150 }, [image]);
    const onMediaLoad = vi.fn();

    render(<>{renderSceneNodeContent(group, 'show', { onMediaLoad })}</>);
    await flushRaf();

    expect(onMediaLoad).toHaveBeenCalledWith('image-1');
  });
});

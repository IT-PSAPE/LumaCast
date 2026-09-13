import { describe, expect, it } from 'vitest';
import type { GroupElementPayload, SlideElement } from '@lumacast/composition';
import { buildRenderScene } from '../../../../../app/renderer/features/canvas/build-render-scene';

const T0 = '2026-01-01T00:00:00.000Z';

function baseElement(id: string, overrides: Partial<SlideElement> = {}): SlideElement {
  return {
    id,
    slideId: 'slide-1',
    type: 'shape',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    layer: 'content',
    createdAt: T0,
    updatedAt: T0,
    payload: { fillColor: '#FFFFFF', borderColor: '#000000', borderWidth: 1, borderRadius: 0 },
    ...overrides,
  } as SlideElement;
}

function imageElement(id: string, src: string, overrides: Partial<SlideElement> = {}): SlideElement {
  return baseElement(id, { type: 'image', payload: { src }, ...overrides });
}

function groupElement(id: string, children: SlideElement[], overrides: Partial<SlideElement> = {}): SlideElement {
  const payload: GroupElementPayload = { children };
  return baseElement(id, { type: 'group', payload, ...overrides });
}

describe('buildRenderScene group children', () => {
  it('resolves a group element children recursively into RenderNode.children', () => {
    const child = imageElement('child-1', 'media://child.png', { x: 5, y: 6, width: 20, height: 30 });
    const group = groupElement('group-1', [child]);

    const scene = buildRenderScene({ width: 1920, height: 1080, background: null }, [group]);

    expect(scene.nodes).toHaveLength(1);
    const groupNode = scene.nodes[0];
    expect(groupNode.id).toBe('group-1');
    expect(groupNode.children).toHaveLength(1);
    const childNode = groupNode.children![0];
    expect(childNode.id).toBe('child-1');
    expect(childNode.element).toBe(child);
    expect(childNode.isVideo).toBe(false);
    // The child's own visual defaults are computed exactly like a top-level
    // node's would be, not left unresolved.
    expect(childNode.visual.visible).toBe(true);
    expect(childNode.visual.locked).toBe(false);
  });

  it('leaves children undefined for every non-group element kind', () => {
    const scene = buildRenderScene({ width: 1920, height: 1080, background: null }, [baseElement('shape-1')]);
    expect(scene.nodes[0].children).toBeUndefined();
  });

  it('resolves nested groups recursively (a group inside a group)', () => {
    const grandchild = imageElement('grandchild-1', 'media://grandchild.png');
    const innerGroup = groupElement('inner-group', [grandchild]);
    const outerGroup = groupElement('outer-group', [innerGroup]);

    const scene = buildRenderScene({ width: 1920, height: 1080, background: null }, [outerGroup]);

    const outerNode = scene.nodes[0];
    expect(outerNode.children).toHaveLength(1);
    const innerNode = outerNode.children![0];
    expect(innerNode.id).toBe('inner-group');
    expect(innerNode.children).toHaveLength(1);
    expect(innerNode.children![0].id).toBe('grandchild-1');
    expect(innerNode.children![0].isVideo).toBe(false);
  });

  it('resolves proxyMediaKey for a nested image the same way a top-level node gets it', () => {
    const nestedImage = imageElement('nested-image', 'media://full.png');
    const group = groupElement('group-1', [nestedImage]);
    const proxyMediaBySource = new Map([['media://full.png', 'media://proxy.png']]);

    const scene = buildRenderScene({ width: 1920, height: 1080, background: null }, [group], { proxyMediaBySource });

    const childNode = scene.nodes[0].children![0];
    expect(childNode.proxyMediaKey).toBe('media://proxy.png');
  });
});

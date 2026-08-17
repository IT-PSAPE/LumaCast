import { describe, expect, it } from 'vitest';
import type { Id, Slide, SlideElement } from '@core/types';
import { buildRenderScene, buildResolvedRenderScene } from '../features/canvas/build-render-scene';
import { SceneNodeMedia } from '../features/canvas/scene-node-media';
import { SceneNodeShape } from '../features/canvas/scene-node-shape';
import { SceneNodeText } from '../features/canvas/scene-node-text';
import { renderSceneNodeContent } from './scene-node-content';
import { isSceneNodeVisible, sceneNodeFrame, traverseSceneNodes } from './scene-traversal';

// Structural parity between the two scene traversals that exist post-#147/#148:
//
//  - The Konva pipeline (buildRenderScene → traverseSceneNodes → renderSceneNodeContent)
//    that both the editor (scene-stage.tsx) and NDI (ndi-frame-capture.tsx) now share.
//  - The provider-independent resolved contract (buildResolvedRenderScene → SceneLayer)
//    that landed in #147.
//
// Both are driven by the same `sortElements` back→front ordering and the same
// SlideElement inputs, so a fixture fed through both should agree on node
// identity, order, visibility, and frame geometry. This file does not mount
// either Konva or the DOM SceneLayer — it asserts on the shared, renderer-agnostic
// data each pipeline produces, which is what "structural" parity means here.

const NOW = '2026-01-01T00:00:00.000Z';

// ─── Fixtures ──────────────────────────────────────────────────────────

function element(id: Id, partial: Partial<SlideElement> = {}): SlideElement {
  return {
    id,
    slideId: 'slide-1',
    type: 'text',
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    layer: 'content',
    createdAt: NOW,
    updatedAt: NOW,
    payload: { text: '', fontFamily: 'Avenir Next', fontSize: 32, color: '#ffffff', alignment: 'left' },
    ...partial,
  } as SlideElement;
}

function textElement(id: Id, text: string, partial: Partial<SlideElement> = {}): SlideElement {
  return element(id, {
    type: 'text',
    payload: { text, fontFamily: 'Avenir Next', fontSize: 48, color: '#ffffff', alignment: 'left' },
    ...partial,
  });
}

function shapeElement(id: Id, partial: Partial<SlideElement> = {}): SlideElement {
  return element(id, {
    type: 'shape',
    payload: { fillColor: '#ff0000', borderColor: '#000000', borderWidth: 2, borderRadius: 8 },
    ...partial,
  });
}

function imageElement(id: Id, src: string, partial: Partial<SlideElement> = {}): SlideElement {
  return element(id, { type: 'image', payload: { src }, ...partial });
}

function videoElement(id: Id, src: string, partial: Partial<SlideElement> = {}): SlideElement {
  return element(id, { type: 'video', payload: { src, autoplay: false, loop: false, muted: true }, ...partial });
}

function groupElement(id: Id, children: SlideElement[], partial: Partial<SlideElement> = {}): SlideElement {
  return element(id, { type: 'group', payload: { children }, ...partial });
}

function hidden(source: SlideElement): SlideElement {
  return { ...source, payload: { ...source.payload, visible: false } };
}

function slide(partial: Partial<Slide> = {}): Slide {
  return {
    id: 'slide-1',
    presentationId: null,
    lyricId: null,
    talkId: null,
    themeId: null,
    overlayId: null,
    stageId: null,
    kind: 'presentation',
    width: 1920,
    height: 1080,
    notes: '',
    order: 0,
    backgroundSource: 'local',
    background: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

// ─── Traversal / ordering parity ───────────────────────────────────────

describe('scene traversal parity: Konva pipeline vs. resolved contract', () => {
  it('orders visible nodes identically across element layers and z-indices', () => {
    const elements = [
      textElement('content-b', 'B', { zIndex: 5, layer: 'content' }),
      shapeElement('content-a', { zIndex: 1, layer: 'content' }),
      imageElement('media-a', 'cast-media://m.png', { zIndex: 0, layer: 'media' }),
      shapeElement('bg-a', { zIndex: 0, layer: 'background' }),
      videoElement('media-b', 'cast-media://m.mp4', { zIndex: -1, layer: 'media' }),
    ];

    const konvaScene = buildRenderScene(slide(), elements);
    const konvaOrder = traverseSceneNodes(konvaScene.nodes).map((entry) => entry.node.id);

    const resolvedScene = buildResolvedRenderScene(slide(), elements, {});
    const resolvedOrder = resolvedScene.nodes.map((node) => node.id);

    expect(konvaOrder).toEqual(resolvedOrder);
    expect(konvaOrder).toEqual(['bg-a', 'media-b', 'media-a', 'content-a', 'content-b']);
  });

  it('excludes hidden nodes from the Konva traversal while the resolved contract keeps them flagged, agreeing on the order of what remains visible', () => {
    const elements = [
      hidden(shapeElement('hidden-1', { zIndex: 0 })),
      textElement('visible-1', 'Hi', { zIndex: 1 }),
      hidden(imageElement('hidden-2', 'cast-media://x.png', { zIndex: 2 })),
      shapeElement('visible-2', { zIndex: 3 }),
    ];

    const konvaScene = buildRenderScene(slide(), elements);
    const konvaEntries = traverseSceneNodes(konvaScene.nodes);
    const konvaVisibleIds = konvaEntries.map((entry) => entry.node.id);

    const resolvedScene = buildResolvedRenderScene(slide(), elements, {});
    const resolvedVisibleIds = resolvedScene.nodes.filter((node) => node.visible).map((node) => node.id);

    expect(konvaVisibleIds).toEqual(['visible-1', 'visible-2']);
    expect(konvaVisibleIds).toEqual(resolvedVisibleIds);

    // The resolved contract keeps hidden nodes in its array (SceneLayer skips
    // them at render time); the Konva traversal drops them from its entries
    // outright but records their original back→front slot via `order` so a
    // caller can tell a filtered list from a reordered one.
    expect(resolvedScene.nodes.map((node) => node.id)).toEqual(['hidden-1', 'visible-1', 'hidden-2', 'visible-2']);
    expect(konvaEntries.map((entry) => entry.order)).toEqual([1, 3]);
    expect(konvaScene.nodes.filter((node) => !isSceneNodeVisible(node)).map((node) => node.id)).toEqual(['hidden-1', 'hidden-2']);
  });
});

// ─── Node-kind dispatch parity ──────────────────────────────────────────

describe('node-kind dispatch parity', () => {
  it('dispatches every shared node kind to the same content renderer identity the resolved contract labels it as', () => {
    const cases: Array<{ el: SlideElement; component: unknown }> = [
      { el: shapeElement('s'), component: SceneNodeShape },
      { el: textElement('t', 'hi'), component: SceneNodeText },
      { el: imageElement('i', 'cast-media://a.png'), component: SceneNodeMedia },
      { el: videoElement('v', 'cast-media://a.mp4'), component: SceneNodeMedia },
    ];

    for (const { el, component } of cases) {
      const konvaScene = buildRenderScene(slide(), [el]);
      const node = konvaScene.nodes[0];
      const rendered = renderSceneNodeContent(node, 'show');
      expect(rendered).not.toBeNull();
      expect((rendered as { type: unknown }).type).toBe(component);

      const resolvedScene = buildResolvedRenderScene(slide(), [el], {});
      expect(resolvedScene.nodes[0].kind).toBe(el.type);
    }
  });

  it('returns null for group nodes on the Konva surfaces — nested groups are a resolved-contract-only capability (#147); the editor/NDI Konva scenes do not render them, so this is a documented scope boundary rather than a bug', () => {
    const group = groupElement('g', [textElement('child', 'inside')]);
    const konvaScene = buildRenderScene(slide(), [group]);
    expect(renderSceneNodeContent(konvaScene.nodes[0], 'show')).toBeNull();

    const resolvedScene = buildResolvedRenderScene(slide(), [group], {});
    expect(resolvedScene.nodes[0].kind).toBe('group');
    expect((resolvedScene.nodes[0] as { children?: unknown[] }).children).toHaveLength(1);
  });
});

// ─── Frame geometry parity ─────────────────────────────────────────────

describe('frame geometry parity', () => {
  it('computes the same position, size, rotation, and opacity as the resolved node fields', () => {
    const el = shapeElement('s', { x: 40, y: 60, width: 300, height: 150, rotation: 33, opacity: 0.5 });
    const konvaScene = buildRenderScene(slide(), [el]);
    const frame = sceneNodeFrame(konvaScene.nodes[0]);

    const resolvedScene = buildResolvedRenderScene(slide(), [el], {});
    const resolvedNode = resolvedScene.nodes[0];

    expect(frame.x).toBe(resolvedNode.x);
    expect(frame.y).toBe(resolvedNode.y);
    expect(frame.width).toBe(resolvedNode.width);
    expect(frame.height).toBe(resolvedNode.height);
    expect(frame.rotation).toBe(resolvedNode.rotation);
    expect(frame.opacity).toBe(resolvedNode.opacity);
  });

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('derives equivalent flip transforms for flipX=%s flipY=%s', (flipX, flipY) => {
    const el = shapeElement('s', { width: 120, height: 80, payload: { fillColor: '#fff', borderColor: '#000', borderWidth: 0, borderRadius: 0, flipX, flipY } });
    const konvaScene = buildRenderScene(slide(), [el]);
    const frame = sceneNodeFrame(konvaScene.nodes[0]);

    const resolvedScene = buildResolvedRenderScene(slide(), [el], {});
    const resolvedNode = resolvedScene.nodes[0];

    // Konva anchors the flip with a scale + offset pair; the resolved DOM
    // layer anchors it with a CSS transform + transform-origin pair
    // (see nodeFrameStyle in scene-layer.tsx). Both encode the same fact —
    // "mirror around this edge" — just for different renderers.
    expect(resolvedNode.flipX).toBe(flipX);
    expect(resolvedNode.flipY).toBe(flipY);
    expect(frame.scaleX).toBe(flipX ? -1 : 1);
    expect(frame.scaleY).toBe(flipY ? -1 : 1);
    expect(frame.offsetX).toBe(flipX ? resolvedNode.width : 0);
    expect(frame.offsetY).toBe(flipY ? resolvedNode.height : 0);
  });
});

// ─── Documented divergences (not asserted equal — recorded on purpose) ──

describe('known scope-bounded divergence: invalid numeric fields', () => {
  it('leaves non-finite geometry unsanitized in the Konva frame while the resolved contract falls back to zero', () => {
    const el = shapeElement('s', { width: Number.NaN, height: Number.NaN, rotation: Number.NaN });
    const konvaScene = buildRenderScene(slide(), [el]);
    const frame = sceneNodeFrame(konvaScene.nodes[0]);

    const resolvedScene = buildResolvedRenderScene(slide(), [el], {});
    const resolvedNode = resolvedScene.nodes[0];

    // scene-types.ts / build-render-scene.ts are outside this issue's write
    // boundary (#147 owns them), so the Konva-side traversal intentionally
    // does not gain the resolved contract's `finiteNumber` sanitization here.
    // This test pins today's (differing) behavior so a future change to
    // either pipeline is a deliberate edit to this file, not silent drift.
    expect(Number.isNaN(frame.width)).toBe(true);
    expect(Number.isNaN(frame.height)).toBe(true);
    expect(Number.isNaN(frame.rotation)).toBe(true);
    expect(resolvedNode.width).toBe(0);
    expect(resolvedNode.height).toBe(0);
    expect(resolvedNode.rotation).toBe(0);
  });
});

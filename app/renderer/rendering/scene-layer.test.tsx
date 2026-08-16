import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Id, Slide, SlideBackground, SlideElement } from '@core/types';
import { buildResolvedRenderScene } from '../features/canvas/build-render-scene';
import type { MediaHandleLookup, ResolvedMediaState, ResolvedRenderNode, ResolvedRenderScene } from '../features/canvas/scene-types';
import { SceneLayer } from './scene-layer';

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
    payload: { text, fontFamily: 'Avenir Next', fontSize: 48, color: '#ffffff', alignment: 'left', weight: '700' },
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
  return element(id, {
    type: 'image',
    payload: { src },
    ...partial,
  });
}

function videoElement(id: Id, src: string, partial: Partial<SlideElement> = {}): SlideElement {
  return element(id, {
    type: 'video',
    payload: { src, autoplay: false, loop: false, muted: true },
    ...partial,
  });
}

function groupElement(id: Id, children: SlideElement[], partial: Partial<SlideElement> = {}): SlideElement {
  return element(id, {
    type: 'group',
    payload: { children },
    ...partial,
  });
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

function loadedImage(src: string): ResolvedMediaState {
  const resource = document.createElement('img');
  resource.src = src;
  return { status: 'loaded', resource };
}

function loadedVideo(src: string): ResolvedMediaState {
  const resource = document.createElement('video');
  resource.src = src;
  return { status: 'loaded', resource };
}

function lookup(...entries: Array<[string, ResolvedMediaState]>): MediaHandleLookup {
  return new Map(entries);
}

function nodeIds(container: HTMLElement): Array<string | null> {
  return Array.from(container.querySelectorAll('[data-node]')).map((node) => node.getAttribute('data-node-id'));
}

afterEach(() => {
  cleanup();
});

// ─── Provider-independent consumption ─────────────────────────────────

describe('SceneLayer without an application provider', () => {
  it('renders a resolved scene with no provider mounted', () => {
    const scene = buildResolvedRenderScene(slide(), [], { surface: 'ndi-show' });
    const { container } = render(<SceneLayer scene={scene} />);
    expect(container.querySelector('[data-scene]')).not.toBeNull();
  });

  it('carries surface, dimensions, and interaction flags on the scene root', () => {
    const scene = buildResolvedRenderScene(
      slide({ width: 800, height: 600 }),
      [],
      { surface: 'ndi-stage', interactive: true, selection: { selectedIds: ['a'], primarySelectedId: 'a' } },
    );
    const { container } = render(<SceneLayer scene={scene} />);
    const root = container.querySelector('[data-scene]');
    expect(root?.getAttribute('data-surface')).toBe('ndi-stage');
    expect(root?.getAttribute('data-width')).toBe('800');
    expect(root?.getAttribute('data-height')).toBe('600');
    expect(root?.getAttribute('data-interactive')).toBe('true');
  });

  it('renders no background when the scene has none', () => {
    const scene = buildResolvedRenderScene(slide({ background: null }), [], {});
    const { container } = render(<SceneLayer scene={scene} />);
    expect(container.querySelector('[data-background]')).toBeNull();
  });
});

// ─── Backgrounds ───────────────────────────────────────────────────────

describe('SceneLayer backgrounds', () => {
  it('renders a solid color background', () => {
    const scene = buildResolvedRenderScene(slide({ background: { type: 'color', color: '#112233' } }), [], {});
    const { container } = render(<SceneLayer scene={scene} />);
    const bg = container.querySelector('[data-background="color"]') as HTMLElement | null;
    expect(bg).not.toBeNull();
    expect(bg?.style.backgroundColor).toBe('rgb(17, 34, 51)');
  });

  it('renders linear and radial gradient backgrounds', () => {
    const linear: SlideBackground = { type: 'gradient', gradient: { kind: 'linear', angle: 45, stops: [{ color: '#ff0000', position: 0 }, { color: '#0000ff', position: 100 }] } };
    const radial: SlideBackground = { type: 'gradient', gradient: { kind: 'radial', stops: [{ color: '#00ff00', position: 20 }, { color: '#000000', position: 80 }] } };
    const linearScene = buildResolvedRenderScene(slide({ background: linear }), [], {});
    const radialScene = buildResolvedRenderScene(slide({ background: radial }), [], {});
    const linearBox = render(<SceneLayer scene={linearScene} />).container.querySelector('[data-background="gradient"]') as HTMLElement;
    const radialBox = render(<SceneLayer scene={radialScene} />).container.querySelector('[data-background="gradient"]') as HTMLElement;
    expect(linearBox.style.backgroundImage).toContain('linear-gradient(45deg');
    expect(linearBox.style.backgroundImage).toContain('#ff0000');
    expect(radialBox.style.backgroundImage).toContain('radial-gradient(circle');
  });

  it('clamps gradient stop positions into 0..100', () => {
    const bg: SlideBackground = { type: 'gradient', gradient: { kind: 'linear', stops: [{ color: '#fff', position: -10 }, { color: '#000', position: 140 }] } };
    const scene = buildResolvedRenderScene(slide({ background: bg }), [], {});
    expect(scene.background && 'stops' in scene.background ? scene.background.stops.map((stop) => stop.position) : []).toEqual([0, 100]);
  });

  it('renders image and video backgrounds from resolved media handles', () => {
    const imageBg: SlideBackground = { type: 'image', mediaAssetId: null, src: 'cast-media://bg.png', fit: 'cover' };
    const videoBg: SlideBackground = { type: 'video', mediaAssetId: null, src: 'cast-media://bg.mp4', fit: 'contain' };
    const imageScene = buildResolvedRenderScene(slide({ background: imageBg }), [], {
      media: lookup(['cast-media://bg.png', loadedImage('cast-media://bg.png')]),
    });
    const videoScene = buildResolvedRenderScene(slide({ background: videoBg }), [], {
      media: lookup(['cast-media://bg.mp4', loadedVideo('cast-media://bg.mp4')]),
    });
    const image = render(<SceneLayer scene={imageScene} />).container.querySelector('[data-background="image"] img');
    const video = render(<SceneLayer scene={videoScene} />).container.querySelector('[data-background="video"] video');
    expect(image?.getAttribute('data-media')).toBe('loaded');
    expect(image?.getAttribute('src')).toBe('cast-media://bg.png');
    expect(video?.getAttribute('data-media')).toBe('loaded');
    expect(video?.getAttribute('src')).toBe('cast-media://bg.mp4');
  });

  it('renders an empty media background when no handle resolves', () => {
    const bg: SlideBackground = { type: 'video', mediaAssetId: null, src: 'cast-media://bg.mp4', fit: 'cover' };
    const scene = buildResolvedRenderScene(slide({ background: bg }), [], {});
    const { container } = render(<SceneLayer scene={scene} />);
    expect(container.querySelector('[data-background="video"] [data-media="empty"]')).not.toBeNull();
  });
});

// ─── Node kinds, ordering, and nesting ─────────────────────────────────

describe('SceneLayer nodes', () => {
  it('renders every node kind in stable back→front order', () => {
    const elements = [
      textElement('t', 'Title', { zIndex: 3 }),
      shapeElement('s', { zIndex: 1 }),
      imageElement('i', 'cast-media://a.png', { zIndex: 2 }),
      videoElement('v', 'cast-media://a.mp4', { zIndex: 0 }),
    ];
    const scene = buildResolvedRenderScene(slide(), elements, {
      media: lookup(
        ['cast-media://a.png', loadedImage('cast-media://a.png')],
        ['cast-media://a.mp4', loadedVideo('cast-media://a.mp4')],
      ),
    });
    const { container } = render(<SceneLayer scene={scene} />);
    const nodes = Array.from(container.querySelectorAll('[data-node]'));
    expect(nodes.map((node) => node.getAttribute('data-node-id'))).toEqual(['v', 's', 'i', 't']);
    expect(nodes.map((node) => node.getAttribute('data-node-kind'))).toEqual(['video', 'shape', 'image', 'text']);
    expect(nodes.map((node) => node.getAttribute('data-node-order'))).toEqual(['0', '1', '2', '3']);
    expect(nodes.map((node) => node.getAttribute('data-node-zindex'))).toEqual(['0', '1', '2', '3']);

    const shape = container.querySelector('[data-node-kind="shape"] [data-node-content="shape"]') as HTMLElement;
    expect(shape.style.backgroundColor).toBe('rgb(255, 0, 0)');
    expect(shape.style.borderRadius).toBe('8px');

    const text = container.querySelector('[data-node-kind="text"] [data-node-content="text"]') as HTMLElement;
    expect(text.textContent).toBe('Title');
    expect(text.style.fontWeight).toBe('700');

    expect(container.querySelector('[data-node-kind="image"] img')?.getAttribute('data-media')).toBe('loaded');
    expect(container.querySelector('[data-node-kind="video"] video')?.getAttribute('data-media')).toBe('loaded');
  });

  it('orders across element layers: background before media before content', () => {
    const elements = [
      textElement('content-a', 'A', { zIndex: 5, layer: 'content' }),
      imageElement('media-a', 'cast-media://m.png', { zIndex: 0, layer: 'media' }),
      shapeElement('bg-a', { zIndex: 0, layer: 'background' }),
    ];
    const scene = buildResolvedRenderScene(slide(), elements, { media: lookup(['cast-media://m.png', loadedImage('cast-media://m.png')]) });
    const { container } = render(<SceneLayer scene={scene} />);
    expect(nodeIds(container)).toEqual(['bg-a', 'media-a', 'content-a']);
  });

  it('applies the case transform to resolved text', () => {
    const upper = textElement('u', 'hello world', {
      zIndex: 0,
      payload: { text: 'hello world', fontFamily: 'Avenir Next', fontSize: 48, color: '#ffffff', alignment: 'left', caseTransform: 'uppercase' },
    });
    const scene = buildResolvedRenderScene(slide(), [upper], {});
    const { container } = render(<SceneLayer scene={scene} />);
    expect(container.querySelector('[data-node-content="text"]')?.textContent).toBe('HELLO WORLD');
  });

  it('resolves media handles through a lookup function', () => {
    const scene = buildResolvedRenderScene(slide(), [imageElement('i', 'cast-media://f.png')], {
      media: (key) => (key === 'cast-media://f.png' ? loadedImage('cast-media://f.png') : { status: 'empty' }),
    });
    const { container } = render(<SceneLayer scene={scene} />);
    expect(container.querySelector('[data-node-kind="image"] img')?.getAttribute('src')).toBe('cast-media://f.png');
  });

  it('marks selected and locked nodes', () => {
    const elements = [textElement('a', 'A', { zIndex: 0 }), shapeElement('b', { zIndex: 1 })];
    const scene = buildResolvedRenderScene(slide(), elements, { selection: { selectedIds: ['b'], primarySelectedId: 'b' } });
    const { container } = render(<SceneLayer scene={scene} />);
    expect(container.querySelector('[data-node-id="a"]')?.getAttribute('data-node-selected')).toBe('false');
    expect(container.querySelector('[data-node-id="b"]')?.getAttribute('data-node-selected')).toBe('true');
    expect(scene.selection.primarySelectedId).toBe('b');
  });
});

// ─── Visibility ────────────────────────────────────────────────────────

describe('SceneLayer visibility', () => {
  it('skips hidden nodes while preserving the contract ordering for visible nodes', () => {
    const elements = [
      hidden(shapeElement('hidden', { zIndex: 0 })),
      textElement('visible', 'Hi', { zIndex: 1 }),
      hidden(imageElement('hidden2', 'cast-media://x.png', { zIndex: 2 })),
    ];
    const scene = buildResolvedRenderScene(slide(), elements, {});
    const { container } = render(<SceneLayer scene={scene} />);
    const nodes = Array.from(container.querySelectorAll('[data-node]'));
    expect(nodes.map((node) => node.getAttribute('data-node-id'))).toEqual(['visible']);
    expect(nodes[0]?.getAttribute('data-node-order')).toBe('1');
  });

  it('renders nested groups recursively', () => {
    const group = groupElement('g', [
      textElement('g-child', 'inside', { zIndex: 0 }),
      groupElement('sub', [shapeElement('sub-shape', { zIndex: 0 })], { zIndex: 1 }),
    ], { zIndex: 0 });
    const image = imageElement('i', 'cast-media://n.png', { zIndex: 1 });
    const scene = buildResolvedRenderScene(slide(), [group, image], { media: lookup(['cast-media://n.png', loadedImage('cast-media://n.png')]) });
    const { container } = render(<SceneLayer scene={scene} />);
    expect(nodeIds(container)).toEqual(['g', 'i']);
    expect(container.querySelector('[data-node-id="g"] [data-node-content="group"]')).not.toBeNull();
    expect(container.querySelector('[data-node-id="g"] [data-node-id="g-child"]')).not.toBeNull();
    expect(container.querySelector('[data-node-id="g"] [data-node-id="sub"] [data-node-id="sub-shape"]')).not.toBeNull();
  });

  it('skips a hidden group and its whole subtree', () => {
    const group = hidden(groupElement('g', [textElement('nested', 'gone')], { zIndex: 0 }));
    const scene = buildResolvedRenderScene(slide(), [group], {});
    const { container } = render(<SceneLayer scene={scene} />);
    expect(container.querySelector('[data-node-id="g"]')).toBeNull();
    expect(container.querySelector('[data-node-id="nested"]')).toBeNull();
  });

  it('shows a broken-media placeholder only on the deck-editor surface', () => {
    const broken: ResolvedMediaState = { status: 'broken' };
    const editorScene = buildResolvedRenderScene(slide(), [imageElement('b', 'cast-media://bad.png')], {
      surface: 'deck-editor',
      media: lookup(['cast-media://bad.png', broken]),
    });
    const showScene = buildResolvedRenderScene(slide(), [imageElement('b', 'cast-media://bad.png')], {
      surface: 'show',
      media: lookup(['cast-media://bad.png', broken]),
    });
    const editor = render(<SceneLayer scene={editorScene} />).container;
    const show = render(<SceneLayer scene={showScene} />).container;
    const editorPlaceholder = editor.querySelector('[data-media="broken"]') as HTMLElement;
    const showPlaceholder = show.querySelector('[data-media="broken"]') as HTMLElement;
    expect(editorPlaceholder.style.backgroundImage).toBeTruthy();
    expect(showPlaceholder.style.backgroundImage).toBe('');
  });
});

// ─── Invalid inputs are deterministic ──────────────────────────────────

describe('SceneLayer determinism for invalid inputs', () => {
  it('drops elements without an id or with an unknown type during resolution', () => {
    const noId = element('', { type: 'shape', payload: { fillColor: '#ffffff', borderColor: '#000000', borderWidth: 0, borderRadius: 0 } });
    const unknown = {
      ...element('weird'),
      type: 'audio' as never,
      payload: {},
    } as unknown as SlideElement;
    const valid = textElement('ok', 'fine', { zIndex: 0 });
    const scene = buildResolvedRenderScene(slide(), [noId, unknown, valid], {});
    expect(scene.nodes.map((node) => node.id)).toEqual(['ok']);
  });

  it('renders deterministically for malformed nodes fed directly to the layer', () => {
    const malformed = {
      id: 'ghost',
      kind: 'ghost',
      x: Number.NaN,
      y: Number.NaN,
      width: Number.NaN,
      height: Number.NaN,
      rotation: Number.NaN,
      opacity: Number.NaN,
      zIndex: Number.NaN,
      visible: true,
      locked: false,
      flipX: false,
      flipY: false,
      selected: false,
    };
    const emptyGroup = {
      id: 'empty-group',
      kind: 'group',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      visible: true,
      locked: false,
      flipX: false,
      flipY: false,
      selected: false,
      children: [],
    };
    const scene: ResolvedRenderScene = {
      surface: 'show',
      width: 100,
      height: 100,
      background: null,
      nodes: [malformed as unknown as ResolvedRenderNode, emptyGroup as ResolvedRenderNode],
      interactive: false,
      selection: { selectedIds: [], primarySelectedId: null },
    };
    const { container } = render(<SceneLayer scene={scene} />);
    const ghost = container.querySelector('[data-node-id="ghost"]') as HTMLElement;
    expect(ghost).not.toBeNull();
    expect(ghost.querySelector('[data-node-content]')).toBeNull();
    const group = container.querySelector('[data-node-id="empty-group"]') as HTMLElement;
    expect(group.querySelector('[data-node-content="group"]')).not.toBeNull();
  });

  it('falls back to the preview slide frame when the frame is missing', () => {
    const scene = buildResolvedRenderScene(null, []);
    expect(scene.width).toBe(1920);
    expect(scene.height).toBe(1080);
  });
});

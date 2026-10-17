import { describe, expect, it } from 'vitest';
import type { StreamScene, StreamSource } from '../../../../apps/stream/shared/desktop-api';
import { canReferenceScene, getSceneReferenceValidationError, getVisibleSourceIdsForScenes, MAX_SCENE_REFERENCE_DEPTH } from '../../../../apps/stream/shared/scene-reference-graph';

function source(id: string, kind: string = 'image', overrides: Partial<StreamSource> & { referencedSceneId?: string } = {}): StreamSource {
  return {
    id,
    name: id,
    kind: kind as StreamSource['kind'],
    visible: true,
    muted: false,
    volume: 1,
    transform: { x: 0, y: 0, width: 100, height: 100 },
    ...overrides,
  };
}

function scene(id: string, sources: StreamSource[] = []): StreamScene {
  return { id, name: id, sources };
}

function chain(referenceDepth: number): StreamScene[] {
  return Array.from({ length: referenceDepth + 1 }, (_, index) => scene(`scene-${index}`, index < referenceDepth
    ? [source(`ref-${index}`, 'scene', { referencedSceneId: `scene-${index + 1}` })]
    : []));
}

describe('scene reference graph', () => {
  it('accepts projects without scene sources and valid references', () => {
    expect(getSceneReferenceValidationError([scene('one'), scene('two', [source('ref', 'scene', { referencedSceneId: 'one' })])])).toBeNull();
    expect(getSceneReferenceValidationError([scene('one', [source('image')])])).toBeNull();
  });

  it('rejects missing, empty, and whitespace-only scene targets', () => {
    expect(getSceneReferenceValidationError([scene('one', [source('ref', 'scene')])])).toMatch(/must reference/i);
    expect(getSceneReferenceValidationError([scene('one', [source('ref', 'scene', { referencedSceneId: '' })])])).toMatch(/must reference/i);
    expect(getSceneReferenceValidationError([scene('one', [source('ref', 'scene', { referencedSceneId: '  ' })])])).toMatch(/must reference/i);
    expect(getSceneReferenceValidationError([scene('one', [source('ref', 'scene', { referencedSceneId: 'missing' })])])).toMatch(/does not exist/i);
  });

  it('rejects direct and indirect scene-reference cycles', () => {
    expect(getSceneReferenceValidationError([scene('one', [source('self', 'scene', { referencedSceneId: 'one' })])])).toMatch(/cycle/i);
    expect(getSceneReferenceValidationError([
      scene('one', [source('to-two', 'scene', { referencedSceneId: 'two' })]),
      scene('two', [source('to-three', 'scene', { referencedSceneId: 'three' })]),
      scene('three', [source('to-one', 'scene', { referencedSceneId: 'one' })]),
    ])).toMatch(/cycle/i);
  });

  it('allows exactly the maximum reference depth and rejects one more edge', () => {
    expect(getSceneReferenceValidationError(chain(MAX_SCENE_REFERENCE_DEPTH))).toBeNull();
    expect(getSceneReferenceValidationError(chain(MAX_SCENE_REFERENCE_DEPTH + 1))).toMatch(/maximum nesting depth/i);
  });

  it('checks candidate scene-reference edges for existence, self-reference, cycles, and depth', () => {
    expect(canReferenceScene([scene('one'), scene('two')], 'one', 'two')).toBe(true);
    expect(canReferenceScene([scene('one'), scene('two')], 'one', 'one')).toBe(false);
    expect(canReferenceScene([scene('one'), scene('two')], 'missing', 'two')).toBe(false);
    expect(canReferenceScene([scene('one'), scene('two')], 'one', 'missing')).toBe(false);
    expect(canReferenceScene([
      scene('one', [source('to-two', 'scene', { referencedSceneId: 'two' })]),
      scene('two'),
    ], 'two', 'one')).toBe(false);

    const atBoundary = [...chain(MAX_SCENE_REFERENCE_DEPTH - 1), scene('new-root')];
    expect(canReferenceScene(atBoundary, 'new-root', 'scene-0')).toBe(true);
    const beyondBoundary = [...chain(MAX_SCENE_REFERENCE_DEPTH), scene('new-root')];
    expect(canReferenceScene(beyondBoundary, 'new-root', 'scene-0')).toBe(false);
  });

  it('collects visible sources through groups and scene references and deduplicates shared targets', () => {
    const scenes = [
      scene('root', [
        source('root-image'),
        source('group', 'group', { children: [source('group-image')] }),
        source('ref-one', 'scene', { referencedSceneId: 'shared' }),
        source('ref-two', 'scene', { referencedSceneId: 'shared' }),
      ]),
      scene('shared', [source('shared-image'), source('shared-audio', 'microphone')]),
    ];
    expect(getVisibleSourceIdsForScenes(scenes, ['root'])).toEqual(new Set([
      'root-image', 'group', 'group-image', 'ref-one', 'ref-two', 'shared-image', 'shared-audio',
    ]));
  });

  it('prunes descendants beneath hidden groups and hidden scene references', () => {
    const scenes = [
      scene('root', [
        source('hidden-group', 'group', { visible: false, children: [source('hidden-group-child')] }),
        source('hidden-ref', 'scene', { visible: false, referencedSceneId: 'target' }),
        source('visible-ref', 'scene', { referencedSceneId: 'target' }),
      ]),
      scene('target', [source('target-source')]),
    ];
    expect(getVisibleSourceIdsForScenes(scenes, ['root'])).toEqual(new Set(['visible-ref', 'target-source']));
  });

  it('guards cycles and over-depth graphs while collecting visible IDs', () => {
    const cyclic = [
      scene('one', [source('to-two', 'scene', { referencedSceneId: 'two' })]),
      scene('two', [source('to-one', 'scene', { referencedSceneId: 'one' }), source('two-image')]),
    ];
    expect(getVisibleSourceIdsForScenes(cyclic, ['one'])).toEqual(new Set(['to-two', 'to-one', 'two-image']));
    expect(getVisibleSourceIdsForScenes(chain(MAX_SCENE_REFERENCE_DEPTH + 1), ['scene-0']).size).toBe(MAX_SCENE_REFERENCE_DEPTH + 1);
  });

  it('revisits a shared scene when reached at a shallower depth', () => {
    const scenes = chain(MAX_SCENE_REFERENCE_DEPTH);
    scenes[MAX_SCENE_REFERENCE_DEPTH]!.sources.push(source('to-leaf', 'scene', { referencedSceneId: 'leaf-scene' }));
    scenes.push(scene('leaf-scene', [source('leaf')]));
    expect(getVisibleSourceIdsForScenes(scenes, ['scene-0', `scene-${MAX_SCENE_REFERENCE_DEPTH}`])).toContain('leaf');
  });
});

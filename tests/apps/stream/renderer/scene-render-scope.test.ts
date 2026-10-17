import { describe, expect, it } from 'vitest';
import { getRenderedSourceIds } from '../../../../apps/stream/renderer/scene-render-scope';
import type { StreamScene } from '../../../../apps/stream/shared/desktop-api';

function scene(id: string, sources: Array<{ id: string; visible?: boolean }>): StreamScene {
  return {
    id,
    name: id,
    sources: sources.map((source) => ({
      id: source.id,
      name: source.id,
      kind: 'image',
      visible: source.visible ?? true,
      muted: false,
      volume: 1,
      transform: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
  };
}

describe('getRenderedSourceIds', () => {
  const scenes = [scene('preview', [{ id: 'preview-source' }, { id: 'hidden-preview', visible: false }]), scene('program', [{ id: 'program-source' }]), scene('idle', [{ id: 'idle-source' }])];

  it('renders only visible sources from preview and program scenes in the normal monitor', () => {
    expect(getRenderedSourceIds(scenes, 'preview', 'program', false)).toEqual(new Set(['preview-source', 'program-source']));
  });

  it('renders visible sources from every scene while multiview is open', () => {
    expect(getRenderedSourceIds(scenes, 'preview', 'program', true)).toEqual(new Set(['preview-source', 'program-source', 'idle-source']));
  });

  it('handles missing scene IDs without activating unrelated sources', () => {
    expect(getRenderedSourceIds(scenes, 'missing', null, false)).toEqual(new Set());
  });

  it('includes visible group members and excludes members of hidden groups', () => {
    const groupScene: StreamScene = {
      id: 'group-scene',
      name: 'Group scene',
      sources: [
        { ...scene('one', [{ id: 'visible-group' }]).sources[0]!, kind: 'group', children: [scene('nested-visible', [{ id: 'nested-visible' }]).sources[0]!] },
        { ...scene('one', [{ id: 'hidden-group', visible: false }]).sources[0]!, kind: 'group', children: [scene('nested-hidden', [{ id: 'inherited-hidden' }]).sources[0]!] },
      ],
    };
    expect(getRenderedSourceIds([groupScene], groupScene.id, groupScene.id, false)).toEqual(new Set(['visible-group', 'nested-visible']));
  });

  it('activates visible descendants of Scene sources and prunes hidden references', () => {
    const sceneOwner = scene('owner', [{ id: 'visible-ref' }, { id: 'hidden-ref', visible: false }]);
    sceneOwner.sources[0]!.kind = 'scene';
    sceneOwner.sources[0]!.referencedSceneId = 'target';
    sceneOwner.sources[1]!.kind = 'scene';
    sceneOwner.sources[1]!.referencedSceneId = 'target';
    const target = scene('target', [{ id: 'target-image' }, { id: 'target-hidden', visible: false }]);

    expect(getRenderedSourceIds([sceneOwner, target], 'owner', 'owner', false)).toEqual(new Set(['visible-ref', 'target-image']));
  });
});

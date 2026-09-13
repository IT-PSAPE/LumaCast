import { describe, expect, it } from 'vitest';
import { ACTION_IDS, type ActionId } from '@lumacast/commands';
import {
  ACTION_SCHEMAS,
  CodecError,
  actionIdFromToolName,
  buildActionToolDefinitions,
  decodeActionParams,
  toolNameForAction,
  type CodecContext,
} from '@lumacast/protocol';

const context: CodecContext = { boundary: 'agent', operation: 'test', path: '' };

function decode(actionId: ActionId, params: unknown): unknown {
  return decodeActionParams(actionId, params, context);
}

function rejects(actionId: ActionId, params: unknown): void {
  expect(() => decode(actionId, params)).toThrow(CodecError);
}

const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

describe('ACTION_SCHEMAS completeness', () => {
  it('has exactly one entry per ActionId, and only ActionIds', () => {
    const schemaKeys = Object.keys(ACTION_SCHEMAS).sort();
    const actionIds = [...ACTION_IDS].sort();
    expect(schemaKeys).toEqual(actionIds);
  });

  it('every params schema serializes to a JSON Schema object with additionalProperties: false', () => {
    for (const id of ACTION_IDS) {
      const json = ACTION_SCHEMAS[id].params.toJsonSchema();
      expect(json, `${id} toJsonSchema()`).toBeTruthy();
      expect(json.type, `${id} type`).toBe('object');
      expect(json.additionalProperties, `${id} additionalProperties`).toBe(false);
    }
  });
});

describe('tool name round-trip', () => {
  it('round-trips every ActionId through toolNameForAction/actionIdFromToolName', () => {
    for (const id of ACTION_IDS) {
      const name = toolNameForAction(id);
      expect(name, `${id} tool name`).toMatch(TOOL_NAME_PATTERN);
      expect(actionIdFromToolName(name)).toBe(id);
    }
  });

  it('converts the documented example', () => {
    expect(toolNameForAction('playlist.create')).toBe('playlist_create');
  });

  it('returns null for an unknown tool name', () => {
    expect(actionIdFromToolName('not_a_real_action')).toBeNull();
    expect(actionIdFromToolName('')).toBeNull();
  });

  it('has no duplicate tool names across the whole vocabulary', () => {
    const names = ACTION_IDS.map(toolNameForAction);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('buildActionToolDefinitions', () => {
  it('builds one definition per action, sourced from ACTION_METADATA and ACTION_SCHEMAS', () => {
    const defs = buildActionToolDefinitions();
    expect(defs).toHaveLength(ACTION_IDS.length);
    const byId = new Map(defs.map((def) => [def.actionId, def]));
    expect(byId.get('playlist.create')?.name).toBe('playlist_create');
    expect(byId.get('playlist.create')?.description).toMatch(/playlist/i);
    expect(byId.get('playlist.create')?.inputSchema.type).toBe('object');
  });

  it('applies the filter', () => {
    const readOnly = buildActionToolDefinitions((_id, meta) => meta.risk === 'read');
    expect(readOnly.length).toBeGreaterThan(0);
    expect(readOnly.length).toBeLessThan(ACTION_IDS.length);
    expect(readOnly.some((def) => def.actionId === 'playlist.list')).toBe(true);
    expect(readOnly.some((def) => def.actionId === 'playlist.create')).toBe(false);
  });

  it('returns an empty array when the filter matches nothing', () => {
    expect(buildActionToolDefinitions(() => false)).toEqual([]);
  });
});

describe('unknown keys are rejected everywhere', () => {
  it('rejects an extra top-level field for a representative sample of actions', () => {
    rejects('playlist.create', { name: 'Sunday', bogus: true });
    rejects('slide.jumpTo', { index: 0, bogus: true });
    rejects('workbench.setMode', { mode: 'show', bogus: true });
    rejects('edit.undo', { bogus: true });
    rejects('media.import', { path: '/tmp/a.png', bogus: true });
    rejects('cue.create', { kind: 'stage.clear', payload: {}, bogus: true });
  });
});

describe('element.create', () => {
  it('accepts a realistic text element', () => {
    const params = {
      slideId: 's1',
      type: 'text',
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      payload: { text: 'Hello', fontFamily: 'Inter', fontSize: 48, color: '#ffffff', alignment: 'center' },
    };
    expect(decode('element.create', params)).toEqual(params);
  });

  it('accepts a realistic image element addressed by assetId (not src)', () => {
    const params = {
      slideId: 's1',
      type: 'image',
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      payload: { assetId: 'asset-1', fit: 'cover' },
    };
    expect(decode('element.create', params)).toEqual(params);
  });

  it('rejects an image payload that still carries src instead of assetId', () => {
    rejects('element.create', {
      slideId: 's1',
      type: 'image',
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      payload: { src: 'cast-media://abc' },
    });
  });

  it('rejects a payload that does not match the declared type', () => {
    rejects('element.create', {
      slideId: 's1',
      type: 'video',
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      // Missing autoplay/loop (required for video), and this is not a valid
      // image or shape payload either — cross-validated against `type`.
      payload: { assetId: 'asset-1' },
    });
  });

  it('rejects a missing required field', () => {
    rejects('element.create', { slideId: 's1', type: 'text', x: 0, y: 0, width: 200, height: 80, payload: {} });
  });
});

describe('slide.updateBackground', () => {
  it('accepts a realistic gradient background', () => {
    const params = {
      slideId: 's1',
      background: {
        type: 'gradient',
        gradient: { kind: 'linear', angle: 45, stops: [{ color: '#000000', position: 0 }, { color: '#ffffff', position: 100 }] },
      },
    };
    expect(decode('slide.updateBackground', params)).toEqual(params);
  });

  it('accepts a null background (clears it)', () => {
    expect(decode('slide.updateBackground', { slideId: 's1', background: null })).toEqual({ slideId: 's1', background: null });
  });

  it('rejects a gradient with fewer than 2 stops', () => {
    rejects('slide.updateBackground', {
      slideId: 's1',
      background: { type: 'gradient', gradient: { kind: 'linear', stops: [{ color: '#000000', position: 0 }] } },
    });
  });

  it('rejects an image background that still carries src/mediaAssetId instead of assetId', () => {
    rejects('slide.updateBackground', {
      slideId: 's1',
      background: { type: 'image', mediaAssetId: null, src: 'cast-media://abc', fit: 'cover' },
    });
  });
});

describe('cue.create', () => {
  it('accepts an overlay.activate cue', () => {
    const params = { kind: 'overlay.activate', payload: { overlayId: 'o1' } };
    expect(decode('cue.create', params)).toEqual(params);
  });

  it('accepts a layer.clear cue', () => {
    const params = { kind: 'layer.clear', payload: { layer: 'video' } };
    expect(decode('cue.create', params)).toEqual(params);
  });

  it('accepts a zero-argument kind with an empty payload', () => {
    const params = { kind: 'layer.clearAll', payload: {} };
    expect(decode('cue.create', params)).toEqual(params);
  });

  it('rejects an unknown kind', () => {
    rejects('cue.create', { kind: 'not.a.kind', payload: {} });
  });

  it('rejects a payload shape that matches no CuePayload variant', () => {
    rejects('cue.create', { kind: 'overlay.activate', payload: { overlayId: 'o1', extra: true } });
  });
});

describe('playlist.addItem', () => {
  it('accepts a realistic payload with position', () => {
    const params = { playlistId: 'p1', itemRef: { type: 'presentation', id: 'i1' }, position: 2 };
    expect(decode('playlist.addItem', params)).toEqual(params);
  });

  it('accepts omitting the optional position', () => {
    const params = { playlistId: 'p1', itemRef: { type: 'lyric', id: 'i1' } };
    expect(decode('playlist.addItem', params)).toEqual(params);
  });

  it('rejects an invalid item ref type', () => {
    rejects('playlist.addItem', { playlistId: 'p1', itemRef: { type: 'overlay', id: 'i1' } });
  });

  it('rejects a missing itemRef', () => {
    rejects('playlist.addItem', { playlistId: 'p1' });
  });
});

describe('slide.jumpTo', () => {
  it('accepts a non-negative index', () => {
    expect(decode('slide.jumpTo', { index: 0 })).toEqual({ index: 0 });
  });

  it('rejects a non-number index', () => {
    rejects('slide.jumpTo', { index: 'first' });
  });

  it('rejects a negative index', () => {
    rejects('slide.jumpTo', { index: -1 });
  });
});

describe('workbench.setMode', () => {
  it('accepts every documented mode', () => {
    for (const mode of ['show', 'item-editor', 'overlay-editor', 'theme-editor', 'stage-editor', 'macro-editor', 'settings']) {
      expect(decode('workbench.setMode', { mode })).toEqual({ mode });
    }
  });

  it('rejects an unknown mode', () => {
    rejects('workbench.setMode', { mode: 'preview' });
  });
});

describe('media.import', () => {
  it('accepts a realistic payload', () => {
    const params = { path: '/Users/nico/Desktop/photo.png', name: 'Photo', type: 'image' };
    expect(decode('media.import', params)).toEqual(params);
  });

  it('accepts the minimal payload (name/type optional)', () => {
    expect(decode('media.import', { path: '/tmp/a.mp4' })).toEqual({ path: '/tmp/a.mp4' });
  });

  it('rejects an invalid media type', () => {
    rejects('media.import', { path: '/tmp/a.mp4', type: 'document' });
  });

  it('rejects a missing path', () => {
    rejects('media.import', { name: 'Photo' });
  });
});

describe('snapshots', () => {
  it('matches the JSON Schema for playlist.create', () => {
    expect(ACTION_SCHEMAS['playlist.create'].params.toJsonSchema()).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
      additionalProperties: false,
    });
  });

  it('matches the JSON Schema for element.create', () => {
    const json = ACTION_SCHEMAS['element.create'].params.toJsonSchema();
    expect(json.type).toBe('object');
    expect(json.additionalProperties).toBe(false);
    expect(Object.keys(json.properties as Record<string, unknown>).sort()).toEqual(
      ['id', 'layer', 'payload', 'rotation', 'opacity', 'zIndex', 'sourceThemeElementId', 'themeOverrideKeys', 'slideId', 'type', 'x', 'y', 'width', 'height'].sort(),
    );
    const oneOf = json.oneOf as Array<Record<string, unknown>>;
    expect(oneOf).toHaveLength(5);
    const types = oneOf
      .map((branch) => ((branch.properties as Record<string, { const?: string }>).type)?.const)
      .sort();
    expect(types).toEqual(['group', 'image', 'shape', 'text', 'video']);
  });
});

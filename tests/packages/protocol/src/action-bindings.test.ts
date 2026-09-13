import { describe, expect, it } from 'vitest';
import { ACTION_METADATA, type ActionId } from '@lumacast/commands';
import {
  ACTION_RPC_BINDINGS,
  ACTION_SCHEMAS,
  IPC,
  type MainActionId,
} from '@lumacast/protocol';

const actionIds = Object.keys(ACTION_METADATA) as ActionId[];
const mainActionIds = actionIds.filter((id) => ACTION_METADATA[id].site === 'main');
const rendererActionIds = actionIds.filter((id) => ACTION_METADATA[id].site === 'renderer');

describe('ACTION_RPC_BINDINGS', () => {
  it('binds every main-site action exactly once', () => {
    const bound = Object.keys(ACTION_RPC_BINDINGS).sort();
    expect(bound).toEqual([...mainActionIds].sort());
  });

  it('binds no renderer-site action', () => {
    for (const id of rendererActionIds) {
      expect(ACTION_RPC_BINDINGS).not.toHaveProperty(id);
    }
  });

  it('names only real IPC channels', () => {
    for (const [id, binding] of Object.entries(ACTION_RPC_BINDINGS)) {
      if (binding.method === null) continue;
      expect(IPC, `${id} -> ${binding.method}`).toHaveProperty(binding.method);
    }
  });

  it('leaves no main-site binding unimplemented', () => {
    // The seven ids that used to be reserved with a null method
    // (`slide.render`, `slide.renderContactSheet`, `element.setRichText`,
    // `element.group`, `element.ungroup`, `element.align`,
    // `element.distribute`) are now `site: 'renderer'` (ADR-0037) and no
    // longer appear here at all.
    for (const [id, binding] of Object.entries(ACTION_RPC_BINDINGS)) {
      expect(binding.method, `${id} has a null method`).not.toBeNull();
    }
  });

  it('moved the seven canvas/render actions to the renderer, off ACTION_RPC_BINDINGS', () => {
    for (const id of [
      'slide.render',
      'slide.renderContactSheet',
      'element.setRichText',
      'element.group',
      'element.ungroup',
      'element.align',
      'element.distribute',
    ]) {
      expect(ACTION_METADATA[id as ActionId].site).toBe('renderer');
      expect(ACTION_RPC_BINDINGS).not.toHaveProperty(id);
    }
  });

  it('declares the `input` sentinel on its own, never mixed with field names', () => {
    for (const [id, binding] of Object.entries(ACTION_RPC_BINDINGS)) {
      if (!binding.args.includes('input')) continue;
      expect(binding.args, `${id}`).toEqual(['input']);
    }
  });

  it('routes the three filesystem-reading actions through their own agent RPCs', () => {
    // These take a raw path, which main authorizes against the user's granted
    // roots. They must never bind to the RPC a UI gesture uses, because that
    // one expects an already-blessed `cast-media:` capability.
    expect(ACTION_RPC_BINDINGS['media.import']).toEqual({ method: 'agentImportMedia', args: ['input'] });
    expect(ACTION_RPC_BINDINGS['media.replaceSource']).toEqual({ method: 'agentReplaceMediaSource', args: ['input'] });
    expect(ACTION_RPC_BINDINGS['document.extractText']).toEqual({ method: 'agentExtractDocumentText', args: ['input'] });
  });

  it('keeps document.extractText on main, with a real binding', () => {
    expect(ACTION_METADATA['document.extractText'].site).toBe('main');
    expect(ACTION_RPC_BINDINGS['document.extractText'].method).toBe('agentExtractDocumentText');
  });
});

describe('RendererActionParams', () => {
  it('covers the seven canvas/render actions with the schema-authoritative field names', () => {
    for (const id of [
      'slide.render',
      'slide.renderContactSheet',
      'element.setRichText',
      'element.group',
      'element.ungroup',
      'element.align',
      'element.distribute',
    ] as const) {
      // Every one of these ids has an agent-facing schema (`ACTION_SCHEMAS`)
      // and no main-site binding — `RendererActionParams`'s compile-time
      // `EveryActionIdIsBound` assertion is what actually proves it is typed;
      // this just proves it is wired at runtime, not left dangling.
      expect(ACTION_SCHEMAS[id]).toBeDefined();
      expect(ACTION_RPC_BINDINGS).not.toHaveProperty(id);
    }
  });
});

describe('polymorphic bindings', () => {
  function resolve(id: MainActionId, params: Record<string, unknown>) {
    const binding = ACTION_RPC_BINDINGS[id];
    if (!binding.resolve) throw new Error(`${id} has no resolver`);
    return binding.resolve(params);
  }

  it('picks the item table from the ref type for rename', () => {
    expect(resolve('item.rename', { ref: { type: 'presentation', id: 'p1' }, title: 'New' })).toEqual({
      method: 'renamePresentation',
      args: ['p1', 'New'],
    });
    expect(resolve('item.rename', { ref: { type: 'lyric', id: 'l1' }, title: 'New' })).toEqual({
      method: 'renameLyric',
      args: ['l1', 'New'],
    });
  });

  it('picks the item table for move and delete', () => {
    expect(resolve('item.move', { ref: { type: 'lyric', id: 'l1' }, direction: 'up' })).toEqual({
      method: 'moveLyric',
      args: ['l1', 'up'],
    });
    expect(resolve('item.delete', { ref: { type: 'presentation', id: 'p1' } })).toEqual({
      method: 'deletePresentation',
      args: ['p1'],
    });
  });

  it('rejects a malformed item reference', () => {
    expect(() => resolve('item.delete', { ref: { type: 'playlist', id: 'x' } })).toThrow(/item reference/);
    expect(() => resolve('item.delete', { ref: null })).toThrow(/item reference/);
    expect(() => resolve('item.rename', {})).toThrow(/item reference/);
  });

  it('names a real IPC channel for every resolved method', () => {
    const resolved = [
      resolve('item.rename', { ref: { type: 'lyric', id: 'l1' }, title: 'x' }),
      resolve('item.move', { ref: { type: 'presentation', id: 'p1' }, direction: 'down' }),
      resolve('item.delete', { ref: { type: 'lyric', id: 'l1' } }),
    ];
    for (const entry of resolved) expect(IPC).toHaveProperty(entry.method);
  });
});

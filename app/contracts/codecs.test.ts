import { describe, expect, it } from 'vitest';
import {
  CodecError,
  DECK_BUNDLE_FORMAT,
  DECK_BUNDLE_VERSION,
  decodeAppSnapshotShape,
  decodeCollectionCreateInput,
  decodeCollectionReorderInput,
  decodeCueCreateInput,
  decodeCuePayload,
  decodeCuePayloadJson,
  decodeCueUpdateInput,
  decodeDeckBundleBrokenReferenceDecision,
  decodeDeckBundleExportOptions,
  decodeDeckBundleManifest,
  decodeDeckItemCreateWithThemeInput,
  decodeElementCreateInput,
  decodeElementUpdateInput,
  decodeInlineWindowMenuBounds,
  decodeMacroCreateInput,
  decodeMediaAssetCreateInput,
  decodeNdiOutputConfigInput,
  decodeNdiOutputName,
  decodeOverlayAnimation,
  decodeOverlayCreateInput,
  decodePersisted,
  decodeSlideBackground,
  decodeSlideBackgroundUpdateInput,
  decodeSlideCreateInput,
  decodeSlideElement,
  decodeSlideElementPayload,
  decodeSlideElementPayloadJson,
  decodeStageCreateInput,
  decodeStoredNdiOutputConfigMap,
  decodeThemeCreateInput,
  decodeTriggerBindingCreateInput,
  expectRpcPrimitiveArgs,
  type CodecContext,
} from './codecs';
import type { DeckBundleManifest } from './deck-bundle-manifest';
import type { SlideElement } from '@core/domain/slide-elements';

const CONTEXT: CodecContext = { boundary: 'test', operation: 'unit', path: '' };

function textPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    text: 'Hello',
    fontFamily: 'Arial',
    fontSize: 32,
    color: '#FFFFFF',
    alignment: 'left',
    ...overrides,
  };
}

function imagePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { src: 'asset://logo', ...overrides };
}

function textElement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'e-1',
    slideId: 'slide-1',
    type: 'text',
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    rotation: 0,
    opacity: 1,
    zIndex: 5,
    layer: 'content',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    payload: textPayload(),
    ...overrides,
  };
}

function decodeDeckBundleManifestWith(value: unknown): DeckBundleManifest {
  return decodeDeckBundleManifest(value, CONTEXT);
}

function expectCodecError(action: () => unknown, pathPart: string): void {
  let error: unknown;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(CodecError);
  expect(error).toMatchObject({ boundary: 'test', operation: 'unit' });
  const message = error instanceof Error ? error.message : '';
  expect(message).toContain(pathPart);
}

function buildValidManifest(): Record<string, unknown> {
  return {
    format: DECK_BUNDLE_FORMAT,
    version: DECK_BUNDLE_VERSION,
    exportedAt: '2024-01-01T00:00:00.000Z',
    items: [
      {
        id: 'pres-1',
        type: 'presentation',
        title: 'Deck',
        themeId: 'theme-1',
        order: 0,
        slides: [
          {
            id: 'slide-1',
            width: 1920,
            height: 1080,
            notes: '',
            order: 0,
            background: { type: 'color', color: '#000000' },
            backgroundSource: 'theme',
            elements: [textElement()],
          },
        ],
      },
    ],
    themes: [
      {
        id: 'theme-1',
        name: 'Theme',
        kind: 'slides',
        width: 1920,
        height: 1080,
        order: 0,
        elements: [textElement({ id: 't-1', slideId: 'theme-1:slide' })],
      },
    ],
    mediaReferences: [{ source: 'asset://logo', elementTypes: ['image'], occurrenceCount: 1 }],
    overlays: [
      {
        id: 'ov-1',
        name: 'Overlay',
        type: 'image',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        opacity: 1,
        zIndex: 10,
        enabled: true,
        elements: [],
        animation: { kind: 'none', durationMs: 0, autoClearDurationMs: null },
      },
    ],
    stages: [{ id: 'stage-1', name: 'Stage', width: 1920, height: 1080, order: 0, elements: [] }],
    playlists: [
      {
        id: 'playlist-1',
        name: 'Sunday',
        libraryName: 'Main',
        order: 0,
        groups: [
          {
            id: 'group-1',
            name: 'Group',
            colorKey: null,
            order: 0,
            entries: [{ id: 'entry-1', presentationId: 'pres-1', lyricId: null, talkId: null, order: 0 }],
          },
        ],
      },
    ],
  };
}

describe('decodePersisted', () => {
  it('reports invalid JSON with the boundary context', () => {
    expectCodecError(() => decodePersisted('{not json', (value) => value, CONTEXT), 'invalid JSON');
  });
});

describe('decodeSlideElementPayload', () => {
  it('decodes a valid text payload', () => {
    const payload = decodeSlideElementPayload(textPayload(), 'text', CONTEXT);
    expect(payload).toMatchObject({ text: 'Hello', fontSize: 32 });
  });

  it('decodes a valid group payload with recursive children', () => {
    const group = { children: [textElement()] };
    const payload = decodeSlideElementPayload(group, 'group', CONTEXT);
    expect((payload as { children: SlideElement[] }).children).toHaveLength(1);
  });

  it('rejects a missing required text field', () => {
    // Called directly (not via decodeSlideElement), so the context is the
    // payload's own root — no extra `payload.` segment is added on top of
    // whatever path the caller already supplied (e.g. a persisted-column
    // path already ending in `.payload_json`).
    const payload = textPayload();
    delete payload.text;
    expectCodecError(() => decodeSlideElementPayload(payload, 'text', CONTEXT), 'text');
  });

  it('rejects a wrong-typed required field', () => {
    expectCodecError(
      () => decodeSlideElementPayload(textPayload({ fontSize: 'huge' }), 'text', CONTEXT),
      'fontSize',
    );
  });

  it('rejects an unknown element type', () => {
    expectCodecError(
      () => decodeSlideElementPayload(imagePayload(), 'unknown' as SlideElement['type'], CONTEXT),
      'unknown element type',
    );
  });

  it('rejects a corrupt nested group child', () => {
    const group = { children: [textElement({ type: 'shape' })] };
    expectCodecError(() => decodeSlideElementPayload(group, 'group', CONTEXT), 'children[0].payload');
  });

  it('decodes a persisted JSON payload column', () => {
    const payload = decodeSlideElementPayloadJson(JSON.stringify(textPayload()), 'text', CONTEXT);
    expect(payload).toMatchObject({ text: 'Hello' });
  });

  it('rejects a corrupt persisted JSON payload column', () => {
    expectCodecError(
      () => decodeSlideElementPayloadJson('{"text": 7}', 'text', CONTEXT),
      'text',
    );
  });
});

describe('decodeSlideElement', () => {
  it('decodes a valid element with nullable provenance', () => {
    const element = decodeSlideElement(textElement({ sourceThemeElementId: null }), CONTEXT);
    expect(element.id).toBe('e-1');
  });

  it('rejects a non-finite z-index', () => {
    expectCodecError(() => decodeSlideElement(textElement({ zIndex: 'top' }), CONTEXT), 'zIndex');
  });

  it('rejects an invalid layer', () => {
    expectCodecError(() => decodeSlideElement(textElement({ layer: 'front' }), CONTEXT), 'layer');
  });

  it('rejects a missing payload', () => {
    const element = textElement();
    delete element.payload;
    expectCodecError(() => decodeSlideElement(element, CONTEXT), 'payload');
  });
});

describe('decodeSlideBackground', () => {
  it('decodes color, gradient, and image backgrounds', () => {
    expect(decodeSlideBackground({ type: 'color', color: '#000000' }, CONTEXT)).toMatchObject({ type: 'color' });
    const gradient = decodeSlideBackground(
      {
        type: 'gradient',
        gradient: {
          kind: 'linear',
          angle: 90,
          stops: [
            { color: '#000000', position: 0 },
            { color: '#FFFFFF', position: 100 },
          ],
        },
      },
      CONTEXT,
    );
    expect(gradient).toMatchObject({ type: 'gradient' });
    expect(
      decodeSlideBackground({ type: 'image', mediaAssetId: null, src: 'asset://bg', fit: 'cover' }, CONTEXT),
    ).toMatchObject({ type: 'image', fit: 'cover' });
  });

  it('rejects a gradient with fewer than two stops', () => {
    expectCodecError(
      () =>
        decodeSlideBackground(
          { type: 'gradient', gradient: { kind: 'linear', stops: [{ color: '#000000', position: 0 }] } },
          CONTEXT,
        ),
      'gradient.stops',
    );
  });

  it('rejects an invalid fit', () => {
    expectCodecError(
      () => decodeSlideBackground({ type: 'image', mediaAssetId: null, src: 'asset://bg', fit: 'stretch' }, CONTEXT),
      'fit',
    );
  });

  it('rejects an image background without a source', () => {
    expectCodecError(
      () => decodeSlideBackground({ type: 'image', mediaAssetId: null, fit: 'cover' }, CONTEXT),
      'src',
    );
  });
});

describe('decodeOverlayAnimation', () => {
  it('decodes a valid animation and preserves the null/omitted distinction', () => {
    const explicit = decodeOverlayAnimation({ kind: 'fade', durationMs: 250, autoClearDurationMs: null }, CONTEXT);
    expect(explicit).toEqual({ kind: 'fade', durationMs: 250, autoClearDurationMs: null });
    const omitted = decodeOverlayAnimation({ kind: 'fade', durationMs: 250 }, CONTEXT);
    expect(omitted).toMatchObject({ kind: 'fade', durationMs: 250 });
    expect(omitted).not.toHaveProperty('autoClearDurationMs');
  });

  it('rejects an unknown kind', () => {
    expectCodecError(() => decodeOverlayAnimation({ kind: 'zoom', durationMs: 0 }, CONTEXT), 'kind');
  });

  it('rejects a negative duration', () => {
    expectCodecError(() => decodeOverlayAnimation({ kind: 'none', durationMs: -1 }, CONTEXT), 'durationMs');
  });
});

describe('decodeCuePayload', () => {
  it('decodes every discriminator branch', () => {
    expect(decodeCuePayload({ overlayId: 'ov-1' }, CONTEXT)).toEqual({ overlayId: 'ov-1' });
    expect(decodeCuePayload({ assetId: 'asset-1' }, CONTEXT)).toEqual({ assetId: 'asset-1' });
    expect(decodeCuePayload({ stageId: 'stage-1' }, CONTEXT)).toEqual({ stageId: 'stage-1' });
    expect(decodeCuePayload({ layer: 'media' }, CONTEXT)).toEqual({ layer: 'media' });
    expect(decodeCuePayload({ action: 'cancel', target: '*' }, CONTEXT)).toEqual({ action: 'cancel', target: '*' });
  });

  it('decodes the empty payload', () => {
    expect(decodeCuePayload({}, CONTEXT)).toEqual({});
  });

  it('rejects multiple discriminators', () => {
    expectCodecError(() => decodeCuePayload({ overlayId: 'ov-1', assetId: 'asset-1' }, CONTEXT), 'exactly one');
  });

  it('rejects an unknown key', () => {
    expectCodecError(() => decodeCuePayload({ mystery: 'x' }, CONTEXT), 'unknown cue payload key');
  });

  it('rejects an action without a target', () => {
    expectCodecError(() => decodeCuePayload({ action: 'revert' }, CONTEXT), 'target');
  });

  it('rejects a lifecycle action with a non-string target', () => {
    expectCodecError(() => decodeCuePayload({ action: 'cancel', target: 42 }, CONTEXT), 'target');
  });

  it('decodes a persisted cue payload column', () => {
    expect(decodeCuePayloadJson(JSON.stringify({ layer: 'video' }), CONTEXT)).toEqual({ layer: 'video' });
  });
});

describe('decodeDeckBundleManifest', () => {
  it('decodes a valid current manifest', () => {
    const manifest = decodeDeckBundleManifestWith(buildValidManifest());
    expect(manifest.items).toHaveLength(1);
    expect(manifest.themes[0].elements[0].payload).toMatchObject({ text: 'Hello' });
    expect(manifest.overlays?.[0].animation).toEqual({ kind: 'none', durationMs: 0, autoClearDurationMs: null });
  });

  it('rejects an unsupported format explicitly', () => {
    const manifest = buildValidManifest();
    manifest.format = 'cast-backup';
    expectCodecError(() => decodeDeckBundleManifestWith(manifest), 'unsupported bundle format');
  });

  it('rejects a future version explicitly without partial results', () => {
    const manifest = buildValidManifest();
    manifest.version = 2;
    expectCodecError(() => decodeDeckBundleManifestWith(manifest), 'future bundle version 2');
  });

  it('rejects an unsupported version', () => {
    const manifest = buildValidManifest();
    manifest.version = 0;
    expectCodecError(() => decodeDeckBundleManifestWith(manifest), 'unsupported bundle version');
  });

  it('rejects a corrupt item with a field path', () => {
    const manifest = buildValidManifest();
    delete (manifest.items as Record<string, unknown>[])[0].title;
    expectCodecError(() => decodeDeckBundleManifestWith(manifest), 'items[0].title');
  });

  it('rejects a corrupt nested slide element with a field path', () => {
    const manifest = buildValidManifest();
    ((manifest.items as Record<string, unknown>[])[0].slides as Record<string, unknown>[])[0].elements = [
      textElement({ type: 'bogus' }),
    ];
    expectCodecError(() => decodeDeckBundleManifestWith(manifest), 'items[0].slides[0].elements[0].type');
  });

  it('rejects a corrupt slide background with a field path', () => {
    const manifest = buildValidManifest();
    ((manifest.items as Record<string, unknown>[])[0].slides as Record<string, unknown>[])[0].background = {
      type: 'gradient',
      gradient: { kind: 'linear', stops: [{ color: '#000000', position: 0 }] },
    };
    expectCodecError(() => decodeDeckBundleManifestWith(manifest), 'items[0].slides[0].background.gradient.stops');
  });

  it('preserves an omitted talkId on playlist entries', () => {
    const manifest = buildValidManifest();
    const entry = ((manifest.playlists as Record<string, unknown>[])[0].groups as Record<string, unknown>[])[0]
      .entries as Record<string, unknown>[];
    delete entry[0].talkId;
    const decoded = decodeDeckBundleManifestWith(manifest);
    const decodedEntry = (
      (decoded.playlists?.[0].groups[0] as unknown as { entries: Array<Record<string, unknown>> }).entries as Array<
        Record<string, unknown>
      >
    )[0];
    expect(decodedEntry).not.toHaveProperty('talkId');
  });

  it('rejects an invalid media reference', () => {
    const manifest = buildValidManifest();
    (manifest.mediaReferences as Record<string, unknown>[])[0].elementTypes = ['gif'];
    expectCodecError(() => decodeDeckBundleManifestWith(manifest), 'mediaReferences[0].elementTypes[0]');
  });
});

// ---------------------------------------------------------------------------
// Renderer-originated RPC input codecs (issue #150)
// ---------------------------------------------------------------------------

describe('expectRpcPrimitiveArgs', () => {
  it('accepts a valid mix of primitive kinds', () => {
    expect(() =>
      expectRpcPrimitiveArgs(
        ['id-1', null, 5, true, undefined, ['a', 'b'], 'up'],
        [
          { name: 'id', kind: 'string' },
          { name: 'groupId', kind: 'nullableString' },
          { name: 'count', kind: 'number' },
          { name: 'flag', kind: 'boolean' },
          { name: 'manual', kind: 'optionalBoolean' },
          { name: 'ids', kind: 'stringArray' },
          { name: 'direction', kind: 'enum', values: ['up', 'down'] },
        ],
        CONTEXT,
      ),
    ).not.toThrow();
  });

  it('rejects a wrong-typed primitive with the field name in the path', () => {
    expectCodecError(
      () => expectRpcPrimitiveArgs([42], [{ name: 'id', kind: 'string' }], CONTEXT),
      'id',
    );
  });

  it('rejects an out-of-range enum value', () => {
    expectCodecError(
      () => expectRpcPrimitiveArgs(['sideways'], [{ name: 'direction', kind: 'enum', values: ['up', 'down'] }], CONTEXT),
      'direction',
    );
  });

  it('rejects a non-string entry inside a stringArray argument', () => {
    expectCodecError(
      () => expectRpcPrimitiveArgs([['a', 7]], [{ name: 'ids', kind: 'stringArray' }], CONTEXT),
      'ids.1',
    );
  });

  it('allows an omitted optionalBoolean but rejects a wrong-typed one', () => {
    expect(() =>
      expectRpcPrimitiveArgs([undefined], [{ name: 'manual', kind: 'optionalBoolean' }], CONTEXT),
    ).not.toThrow();
    expectCodecError(
      () => expectRpcPrimitiveArgs(['yes'], [{ name: 'manual', kind: 'optionalBoolean' }], CONTEXT),
      'manual',
    );
  });
});

describe('decodeInlineWindowMenuBounds', () => {
  it('decodes valid bounds', () => {
    expect(decodeInlineWindowMenuBounds({ x: 1, y: 2 }, CONTEXT)).toEqual({ x: 1, y: 2 });
  });

  it('rejects an unknown field', () => {
    expectCodecError(() => decodeInlineWindowMenuBounds({ x: 1, y: 2, z: 3 }, CONTEXT), 'z');
  });

  it('rejects a non-finite coordinate', () => {
    expectCodecError(() => decodeInlineWindowMenuBounds({ x: Number.NaN, y: 2 }, CONTEXT), 'x');
  });
});

describe('decodeCueCreateInput / decodeCueUpdateInput', () => {
  it('decodes a valid create input, reusing decodeCuePayload', () => {
    const input = decodeCueCreateInput({ kind: 'overlay.activate', payload: { overlayId: 'ov-1' } }, CONTEXT);
    expect(input).toMatchObject({ kind: 'overlay.activate', payload: { overlayId: 'ov-1' } });
  });

  it('rejects an unknown top-level field', () => {
    expectCodecError(
      () => decodeCueCreateInput({ kind: 'overlay.activate', payload: {}, extra: true }, CONTEXT),
      'unknown field',
    );
  });

  it('rejects an invalid cue kind', () => {
    expectCodecError(() => decodeCueCreateInput({ kind: 'bogus.kind', payload: {} }, CONTEXT), 'kind');
  });

  it('propagates a nested cue payload error with its field path', () => {
    expectCodecError(
      () => decodeCueCreateInput({ kind: 'overlay.activate', payload: { mystery: 'x' } }, CONTEXT),
      'payload',
    );
  });

  it('decodes an update input with only id required', () => {
    const input = decodeCueUpdateInput({ id: 'cue-1' }, CONTEXT);
    expect(input).toEqual({ id: 'cue-1' });
  });

  it('preserves operation and field path across the boundary', () => {
    let error: unknown;
    try {
      decodeCueCreateInput({ kind: 'bogus' }, { boundary: 'rpc', operation: 'createCue', path: '' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CodecError);
    expect(error).toMatchObject({ boundary: 'rpc', operation: 'createCue', fieldPath: 'kind' });
    expect((error as Error).message).toBe('[rpc/createCue] kind: must be one of [overlay.activate, overlay.clear, overlay.clearAll, mediaLayer.set, video.arm, video.clear, audio.arm, audio.clear, stage.set, stage.clear, layer.clear, layer.clearAll, flow.lifecycle], got "bogus"');
  });
});

describe('decodeMacroCreateInput', () => {
  it('decodes a valid macro with nested cue entries', () => {
    const macro = decodeMacroCreateInput(
      { name: 'My Macro', loopEnabled: true, cues: [{ cueId: 'cue-1', orderIndex: 0, delayBeforeMs: 100 }] },
      CONTEXT,
    );
    expect(macro).toMatchObject({ name: 'My Macro', loopEnabled: true });
  });

  it('rejects an unknown field on a nested cue entry', () => {
    expectCodecError(
      () => decodeMacroCreateInput({ name: 'M', cues: [{ cueId: 'cue-1', orderIndex: 0, bogus: 1 }] }, CONTEXT),
      'cues[0]',
    );
  });

  it('rejects an id on a create-input cue entry (create never carries one)', () => {
    expectCodecError(
      () => decodeMacroCreateInput({ name: 'M', cues: [{ id: 'x', cueId: 'cue-1', orderIndex: 0 }] }, CONTEXT),
      'cues[0]',
    );
  });

  it('allows loopCount to be explicitly null', () => {
    expect(() => decodeMacroCreateInput({ name: 'M', loopCount: null }, CONTEXT)).not.toThrow();
  });
});

describe('decodeTriggerBindingCreateInput', () => {
  it('decodes a valid input with a nullable sourceId and free-form config', () => {
    const input = decodeTriggerBindingCreateInput(
      { triggerType: 'slide.take', sourceId: null, targetType: 'cue', targetId: 'cue-1', config: { anything: 'goes' } },
      CONTEXT,
    );
    expect(input).toMatchObject({ triggerType: 'slide.take', targetType: 'cue' });
  });

  it('rejects a non-object config', () => {
    expectCodecError(
      () => decodeTriggerBindingCreateInput(
        { triggerType: 'slide.take', sourceId: null, targetType: 'cue', targetId: 'cue-1', config: 'nope' },
        CONTEXT,
      ),
      'config',
    );
  });
});

describe('decodeElementCreateInput / decodeElementUpdateInput', () => {
  function baseElementCreate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      slideId: 'slide-1',
      type: 'text',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      payload: { text: 'Hi', fontFamily: 'Arial', fontSize: 12, color: '#fff', alignment: 'left' },
      ...overrides,
    };
  }

  it('decodes a valid create input, reusing full per-type payload validation', () => {
    const input = decodeElementCreateInput(baseElementCreate(), CONTEXT);
    expect(input).toMatchObject({ slideId: 'slide-1', type: 'text' });
  });

  it('rejects a malformed payload with the nested field path (regression: create must not bypass payload validation)', () => {
    expectCodecError(
      () => decodeElementCreateInput(baseElementCreate({ payload: { text: 'Hi' } }), CONTEXT),
      'payload.fontFamily',
    );
  });

  it('rejects an unknown top-level field', () => {
    expectCodecError(() => decodeElementCreateInput(baseElementCreate({ bogus: 1 }), CONTEXT), 'unknown field');
  });

  it('decodes a valid update input with only id required', () => {
    expect(decodeElementUpdateInput({ id: 'e-1' }, CONTEXT)).toEqual({ id: 'e-1' });
  });

  it('rejects a non-object replacement payload on update (regression: previously reached the repository unchecked)', () => {
    expectCodecError(() => decodeElementUpdateInput({ id: 'e-1', payload: 'not-an-object' }, CONTEXT), 'payload');
  });

  it('accepts any object-shaped replacement payload on update (documented shallow-check gap: type-specific fields are not cross-checked)', () => {
    expect(() => decodeElementUpdateInput({ id: 'e-1', payload: { anything: 'goes' } }, CONTEXT)).not.toThrow();
  });
});

describe('decodeOverlayCreateInput / decodeThemeCreateInput / decodeStageCreateInput', () => {
  it('decodes overlay elements and animation, reusing decodeSlideElement/decodeOverlayAnimation', () => {
    const overlay = decodeOverlayCreateInput(
      { name: 'Lower Third', elements: [], animation: { kind: 'fade', durationMs: 200 } },
      CONTEXT,
    );
    expect(overlay).toMatchObject({ name: 'Lower Third' });
  });

  it('rejects an invalid nested element on an overlay', () => {
    expectCodecError(
      () => decodeOverlayCreateInput({ name: 'X', elements: [{ id: 'e', slideId: 's', type: 'bogus' }] }, CONTEXT),
      'elements[0].type',
    );
  });

  it('decodes theme background via decodeSlideBackground', () => {
    const theme = decodeThemeCreateInput(
      { name: 'Theme', kind: 'slides', background: { type: 'color', color: '#000' } },
      CONTEXT,
    );
    expect(theme).toMatchObject({ kind: 'slides' });
  });

  it('rejects an invalid theme kind', () => {
    expectCodecError(() => decodeThemeCreateInput({ name: 'Theme', kind: 'bogus' }, CONTEXT), 'kind');
  });

  it('decodes a minimal stage create input', () => {
    expect(decodeStageCreateInput({ name: 'Stage A' }, CONTEXT)).toEqual({ name: 'Stage A' });
  });
});

describe('decodeSlideCreateInput / decodeSlideBackgroundUpdateInput', () => {
  it('decodes a minimal slide create input', () => {
    expect(decodeSlideCreateInput({ presentationId: 'pres-1' }, CONTEXT)).toEqual({ presentationId: 'pres-1' });
  });

  it('rejects a wrong-typed nullable owner field', () => {
    expectCodecError(() => decodeSlideCreateInput({ presentationId: 42 }, CONTEXT), 'presentationId');
  });

  it('decodes a background update, reusing decodeSlideBackground', () => {
    const input = decodeSlideBackgroundUpdateInput({ slideId: 's-1', background: { type: 'color', color: '#000' } }, CONTEXT);
    expect(input).toMatchObject({ slideId: 's-1' });
  });

  it('allows an explicit null background but rejects an omitted one', () => {
    expect(decodeSlideBackgroundUpdateInput({ slideId: 's-1', background: null }, CONTEXT)).toEqual({
      slideId: 's-1',
      background: null,
    });
    expectCodecError(() => decodeSlideBackgroundUpdateInput({ slideId: 's-1' }, CONTEXT), 'background');
  });
});

describe('decodeMediaAssetCreateInput / decodeDeckItemCreateWithThemeInput', () => {
  it('decodes a valid media asset input', () => {
    const asset = decodeMediaAssetCreateInput({ name: 'Logo', type: 'image', src: 'asset://logo.png' }, CONTEXT);
    expect(asset).toMatchObject({ type: 'image' });
  });

  it('rejects an invalid media asset type', () => {
    expectCodecError(() => decodeMediaAssetCreateInput({ name: 'Logo', type: 'pdf', src: 'x' }, CONTEXT), 'type');
  });

  it('rejects an unknown field (capability boundary)', () => {
    expectCodecError(
      () => decodeMediaAssetCreateInput({ name: 'Logo', type: 'image', src: 'x', path: '/etc/passwd' }, CONTEXT),
      'unknown field',
    );
  });

  it('decodes a valid deck-item-with-theme input', () => {
    const input = decodeDeckItemCreateWithThemeInput({ type: 'presentation', title: 'New', themeId: null }, CONTEXT);
    expect(input).toMatchObject({ type: 'presentation', title: 'New' });
  });
});

describe('decodeCollectionCreateInput / decodeCollectionReorderInput', () => {
  it('decodes a valid collection create input', () => {
    expect(decodeCollectionCreateInput({ binKind: 'image', name: 'Backgrounds' }, CONTEXT)).toEqual({
      binKind: 'image',
      name: 'Backgrounds',
    });
  });

  it('rejects an invalid bin kind', () => {
    expectCodecError(() => decodeCollectionCreateInput({ binKind: 'bogus', name: 'X' }, CONTEXT), 'binKind');
  });

  it('decodes and validates a reorder input as a string array', () => {
    expect(decodeCollectionReorderInput({ binKind: 'deck', ids: ['a', 'b'] }, CONTEXT)).toEqual({
      binKind: 'deck',
      ids: ['a', 'b'],
    });
  });

  it('rejects a non-string entry in the reorder ids array', () => {
    expectCodecError(() => decodeCollectionReorderInput({ binKind: 'deck', ids: ['a', 7] }, CONTEXT), 'ids.1');
  });
});

describe('decodeDeckBundleExportOptions / decodeDeckBundleBrokenReferenceDecision', () => {
  it('decodes valid export options', () => {
    expect(decodeDeckBundleExportOptions({ includeAllThemes: true, playlistIds: ['p-1'] }, CONTEXT)).toEqual({
      includeAllThemes: true,
      playlistIds: ['p-1'],
    });
  });

  it('rejects an unknown export option (filesystem export boundary)', () => {
    expectCodecError(() => decodeDeckBundleExportOptions({ includeAllThemes: true, bogus: 1 }, CONTEXT), 'unknown field');
  });

  it('decodes a valid broken-reference decision', () => {
    expect(
      decodeDeckBundleBrokenReferenceDecision({ source: 'asset://x', action: 'replace', replacementPath: '/tmp/y.png' }, CONTEXT),
    ).toMatchObject({ action: 'replace' });
  });

  it('rejects an invalid decision action', () => {
    expectCodecError(
      () => decodeDeckBundleBrokenReferenceDecision({ source: 'asset://x', action: 'ignore' }, CONTEXT),
      'action',
    );
  });
});

describe('NDI RPC input vs. persisted config file: unknown-field policy contrast', () => {
  it('decodeNdiOutputName accepts only the known output names', () => {
    expect(decodeNdiOutputName('audience', CONTEXT)).toBe('audience');
    expectCodecError(() => decodeNdiOutputName('program', CONTEXT), 'name');
  });

  it('decodeNdiOutputConfigInput (RPC, capability boundary) rejects an unknown field', () => {
    expect(decodeNdiOutputConfigInput({ senderName: 'Cast' }, CONTEXT)).toEqual({ senderName: 'Cast' });
    expectCodecError(
      () => decodeNdiOutputConfigInput({ senderName: 'Cast', groupName: 'Studio' }, CONTEXT),
      'unknown field',
    );
  });

  it('decodeStoredNdiOutputConfigMap (persisted file) tolerates and ignores the same unknown field', () => {
    const decoded = decodeStoredNdiOutputConfigMap(
      {
        audience: { senderName: 'Cast Audience', withAlpha: false, groupName: 'Studio' },
        stage: { senderName: 'Cast Stage', withAlpha: true },
      },
      CONTEXT,
    );
    expect(decoded).toEqual({
      audience: { senderName: 'Cast Audience', withAlpha: false },
      stage: { senderName: 'Cast Stage', withAlpha: true },
    });
  });

  it('decodeStoredNdiOutputConfigMap still rejects a wrong-typed known field', () => {
    expectCodecError(
      () =>
        decodeStoredNdiOutputConfigMap(
          { audience: { senderName: 42, withAlpha: false }, stage: { senderName: 'Cast Stage', withAlpha: true } },
          CONTEXT,
        ),
      'audience.senderName',
    );
  });

  it('decodeStoredNdiOutputConfigMap rejects a missing required output', () => {
    expectCodecError(
      () => decodeStoredNdiOutputConfigMap({ audience: { senderName: 'Cast', withAlpha: false } }, CONTEXT),
      'stage',
    );
  });
});

describe('decodeAppSnapshotShape', () => {
  const EMPTY_SNAPSHOT_FIELDS = [
    'libraries', 'libraryBundles', 'presentations', 'lyrics', 'talks', 'slides',
    'talkScriptBlocks', 'slideElements', 'mediaAssets', 'overlays', 'themes',
    'stages', 'collections', 'cues', 'macros', 'triggerBindings',
  ];

  function emptySnapshot(): Record<string, unknown> {
    return Object.fromEntries(EMPTY_SNAPSHOT_FIELDS.map((field) => [field, []]));
  }

  it('decodes a minimal snapshot with every array present but empty', () => {
    expect(() => decodeAppSnapshotShape(emptySnapshot(), CONTEXT)).not.toThrow();
  });

  it('decodes a snapshot with well-formed entity rows', () => {
    const snapshot = emptySnapshot();
    snapshot.libraries = [{ id: 'lib-1', name: 'Main' }];
    expect(() => decodeAppSnapshotShape(snapshot, CONTEXT)).not.toThrow();
  });

  it('rejects a missing entity array before touching the repository', () => {
    const snapshot = emptySnapshot();
    delete snapshot.macros;
    expectCodecError(() => decodeAppSnapshotShape(snapshot, CONTEXT), 'macros');
  });

  it('rejects a non-object row inside an entity array', () => {
    const snapshot = emptySnapshot();
    snapshot.cues = ['not-an-object'];
    expectCodecError(() => decodeAppSnapshotShape(snapshot, CONTEXT), 'cues[0]');
  });

  it('rejects a row missing a string id', () => {
    const snapshot = emptySnapshot();
    snapshot.themes = [{ name: 'Theme without id' }];
    expectCodecError(() => decodeAppSnapshotShape(snapshot, CONTEXT), 'themes[0].id');
  });

  // --- issue #224: libraryBundles is a tree, not a flat row list -----------

  function libraryBundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      library: { id: 'lib-1', name: 'Main', order: 0, createdAt: 'now', updatedAt: 'now' },
      playlists: [
        {
          playlist: { id: 'pl-1', libraryId: 'lib-1', name: 'Sunday', order: 0, createdAt: 'now', updatedAt: 'now' },
          groups: [
            {
              group: { id: 'grp-1', playlistId: 'pl-1', name: 'Opening', colorKey: null, order: 0, createdAt: 'now', updatedAt: 'now' },
              entries: [
                {
                  entry: {
                    id: 'ent-1',
                    groupId: 'grp-1',
                    reference: { kind: 'presentation', itemId: 'pres-1' },
                    presentationId: 'pres-1',
                    lyricId: null,
                    talkId: null,
                    order: 0,
                    createdAt: 'now',
                    updatedAt: 'now',
                  },
                  item: { id: 'pres-1', type: 'presentation', title: 'Deck', collectionId: 'col-1', order: 0, createdAt: 'now', updatedAt: 'now' },
                },
              ],
            },
          ],
        },
      ],
      ...overrides,
    };
  }

  it('accepts a populated libraryBundles tree (regression: bundles carry no id of their own)', () => {
    // The shallow pass required a string `id` on every row of every array,
    // including libraryBundles — whose entries are `{ library, playlists }`.
    // Any project with at least one library therefore failed validation, which
    // took restoreFromSnapshot (undo/redo) out entirely.
    const snapshot = emptySnapshot();
    snapshot.libraryBundles = [libraryBundle()];
    expect(() => decodeAppSnapshotShape(snapshot, CONTEXT)).not.toThrow();
  });

  it('rejects a bundle whose library is not an object', () => {
    const snapshot = emptySnapshot();
    snapshot.libraryBundles = [libraryBundle({ library: 'Main' })];
    expectCodecError(() => decodeAppSnapshotShape(snapshot, CONTEXT), 'libraryBundles[0].library');
  });

  it('rejects a wrong-typed field deep inside a bundle tree, naming the path', () => {
    const snapshot = emptySnapshot();
    const bundle = libraryBundle();
    const playlists = bundle.playlists as Record<string, unknown>[];
    const groups = playlists[0].groups as Record<string, unknown>[];
    (groups[0].group as Record<string, unknown>).order = 'first';
    snapshot.libraryBundles = [bundle];
    expectCodecError(
      () => decodeAppSnapshotShape(snapshot, CONTEXT),
      'libraryBundles[0].playlists[0].groups[0].group.order',
    );
  });

  it('rejects a bundle whose playlists is not an array', () => {
    const snapshot = emptySnapshot();
    snapshot.libraryBundles = [libraryBundle({ playlists: {} })];
    expectCodecError(() => decodeAppSnapshotShape(snapshot, CONTEXT), 'libraryBundles[0].playlists');
  });

  // --- issue #224: wrong-typed fields on otherwise well-shaped rows --------

  it('rejects a numeric field supplied as a string', () => {
    // SQLite INTEGER affinity would coerce this silently and it would survive
    // the restore transaction as a corrupt row.
    const snapshot = emptySnapshot();
    snapshot.collections = [{ id: 'col-1', name: 'Default', order: '3', isDefault: true }];
    expectCodecError(() => decodeAppSnapshotShape(snapshot, CONTEXT), 'collections[0].order');
  });

  it('rejects a string field supplied as a number', () => {
    const snapshot = emptySnapshot();
    snapshot.mediaAssets = [{ id: 'm-1', name: 42, type: 'image', src: 'cast-media://x' }];
    expectCodecError(() => decodeAppSnapshotShape(snapshot, CONTEXT), 'mediaAssets[0].name');
  });

  it('rejects a boolean field supplied as a string', () => {
    const snapshot = emptySnapshot();
    snapshot.collections = [{ id: 'col-1', name: 'Default', isDefault: 'yes' }];
    expectCodecError(() => decodeAppSnapshotShape(snapshot, CONTEXT), 'collections[0].isDefault');
  });

  it('rejects a non-finite number where a number is expected', () => {
    const snapshot = emptySnapshot();
    snapshot.talkScriptBlocks = [{ id: 'b-1', slideId: 's-1', text: 'hi', order: Number.NaN }];
    expectCodecError(() => decodeAppSnapshotShape(snapshot, CONTEXT), 'talkScriptBlocks[0].order');
  });

  it('rejects an object where a primitive field is expected', () => {
    const snapshot = emptySnapshot();
    snapshot.libraries = [{ id: 'lib-1', name: { first: 'Main' } }];
    expectCodecError(() => decodeAppSnapshotShape(snapshot, CONTEXT), 'libraries[0].name');
  });

  it('accepts null and undefined for any recognized field, and ignores unknown field names', () => {
    // Both leniencies are deliberate: nullability varies per family, and this
    // pass must only ever narrow what is accepted.
    const snapshot = emptySnapshot();
    snapshot.slides = [{
      id: 's-1',
      presentationId: null,
      lyricId: null,
      talkId: null,
      themeId: undefined,
      order: 0,
      // Not in the field-kind map: not this boundary's business.
      somethingNewFromAFutureMigration: { nested: true },
    }];
    expect(() => decodeAppSnapshotShape(snapshot, CONTEXT)).not.toThrow();
  });

  // --- issue #224: structured fields delegate to their owning decoders -----

  it('rejects a slide element whose payload does not match its own type', () => {
    const snapshot = emptySnapshot();
    snapshot.slideElements = [{
      ...textElement(),
      id: 'el-1',
      type: 'video',
      // A video payload requires src, autoplay, and loop.
      payload: { src: 'cast-media://x' },
    }];
    expectCodecError(() => decodeAppSnapshotShape(snapshot, CONTEXT), 'slideElements[0].payload');
  });

  it('rejects a malformed slide background', () => {
    const snapshot = emptySnapshot();
    snapshot.slides = [{ id: 's-1', background: { type: 'gradient', gradient: { kind: 'linear', stops: [] } } }];
    expectCodecError(() => decodeAppSnapshotShape(snapshot, CONTEXT), 'slides[0].background');
  });

  it('rejects a theme whose owned element is malformed', () => {
    const snapshot = emptySnapshot();
    snapshot.themes = [{
      id: 'th-1',
      name: 'Theme',
      elements: [{ ...textElement(), id: 'el-1', type: 'text', payload: { text: 'hi' } }],
    }];
    expectCodecError(() => decodeAppSnapshotShape(snapshot, CONTEXT), 'themes[0].elements[0].payload');
  });

  it('rejects a theme whose elements array is missing', () => {
    const snapshot = emptySnapshot();
    snapshot.themes = [{ id: 'th-1', name: 'Theme' }];
    expectCodecError(() => decodeAppSnapshotShape(snapshot, CONTEXT), 'themes[0].elements');
  });

  it('rejects a malformed cue payload', () => {
    const snapshot = emptySnapshot();
    snapshot.cues = [{ id: 'cue-1', kind: 'overlay.activate', payload: { overlayId: 7 } }];
    expectCodecError(() => decodeAppSnapshotShape(snapshot, CONTEXT), 'cues[0].payload');
  });

  it("rejects a malformed cue payload nested in a macro's steps", () => {
    const snapshot = emptySnapshot();
    snapshot.macros = [{
      id: 'mac-1',
      name: 'Macro',
      cues: [{
        id: 'mc-1',
        macroId: 'mac-1',
        cueId: 'cue-1',
        cue: { id: 'cue-1', kind: 'overlay.activate', payload: { unknownKey: 'x' } },
        orderIndex: 0,
        delayBeforeMs: 0,
        delayAfterMs: 0,
      }],
    }];
    expectCodecError(() => decodeAppSnapshotShape(snapshot, CONTEXT), 'macros[0].cues[0].cue.payload');
  });

  it('rejects a trigger binding whose config is not an object', () => {
    const snapshot = emptySnapshot();
    snapshot.triggerBindings = [{ id: 'tb-1', triggerType: 'slide.take', targetType: 'cue', targetId: 'cue-1', config: 'nope' }];
    expectCodecError(() => decodeAppSnapshotShape(snapshot, CONTEXT), 'triggerBindings[0].config');
  });

  it('accepts a well-formed populated snapshot across every structured family', () => {
    const snapshot = emptySnapshot();
    snapshot.libraryBundles = [libraryBundle()];
    snapshot.collections = [{ id: 'col-1', binKind: 'deck', name: 'Default', order: 0, isDefault: true, createdAt: 'now', updatedAt: 'now' }];
    snapshot.slides = [{ id: 's-1', background: { type: 'color', color: '#000' }, order: 0, notes: '', width: 1920, height: 1080 }];
    snapshot.slideElements = [{ ...textElement(), id: 'el-1', type: 'shape', payload: { fillColor: '#fff' } }];
    snapshot.themes = [{ id: 'th-1', name: 'Theme', kind: 'slides', elements: [], background: null, width: 1920, height: 1080 }];
    snapshot.overlays = [{ id: 'ov-1', name: 'Lower third', enabled: true, elements: [], animation: { kind: 'fade', durationMs: 250 } }];
    snapshot.stages = [{ id: 'st-1', name: 'Stage', elements: [], width: 1920, height: 1080 }];
    snapshot.cues = [{ id: 'cue-1', kind: 'overlay.activate', payload: { overlayId: 'ov-1' }, failurePolicy: 'continue' }];
    snapshot.triggerBindings = [{ id: 'tb-1', triggerType: 'slide.take', targetType: 'cue', targetId: 'cue-1', config: {}, enabled: true }];
    expect(() => decodeAppSnapshotShape(snapshot, CONTEXT)).not.toThrow();
  });
});
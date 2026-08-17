import { describe, expect, it } from 'vitest';
import {
  CodecError,
  DECK_BUNDLE_FORMAT,
  DECK_BUNDLE_VERSION,
  decodeCuePayload,
  decodeCuePayloadJson,
  decodeDeckBundleManifest,
  decodeOverlayAnimation,
  decodePersisted,
  decodeSlideBackground,
  decodeSlideElement,
  decodeSlideElementPayload,
  decodeSlideElementPayloadJson,
  type CodecContext,
} from './codecs';
import type { DeckBundleManifest, SlideElement } from '@core/types';

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
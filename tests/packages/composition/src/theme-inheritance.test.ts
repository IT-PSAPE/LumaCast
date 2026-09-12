import { describe, expect, it } from 'vitest';
import {
  deriveLegacyOverrideKeys,
  deriveLinkedElementId,
  isLinkedSlideElement,
  planDetachMaterialization,
  preserveThemeLocalRemovals,
  resolveLinkedSlideBackground,
  resolveLinkedSlideElements,
  stampExplicitOverrides,
  stripOverrideMetadata,
  type ThemeInheritanceSource,
} from '../../../../packages/composition/src/theme-inheritance';
import { cloneElement } from '../../../../packages/composition/src/clone';
import type { SlideElement } from '../../../../packages/composition/src/domain/slide-elements';

const T0 = '2024-01-01T00:00:00.000Z';
const T1 = '2024-02-01T00:00:00.000Z';

function baseElement(id: string, type: SlideElement['type'], overrides: Partial<SlideElement> = {}): SlideElement {
  return {
    id,
    slideId: 'slide-1',
    type,
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
    payload: { text: `Text ${id}`, fontFamily: 'Arial', fontSize: 32, color: '#FFFFFF', alignment: 'left' },
    ...overrides,
  };
}

function textElement(id: string, overrides: Partial<SlideElement> = {}): SlideElement {
  return baseElement(id, 'text', {
    payload: {
      text: `Text ${id}`,
      fontFamily: 'Arial',
      fontSize: 32,
      color: '#FFFFFF',
      alignment: 'left',
    },
    ...overrides,
  });
}

function imageElement(id: string): SlideElement {
  return baseElement(id, 'image', { payload: { src: `asset://${id}` } });
}

function groupElement(id: string, children: SlideElement[]): SlideElement {
  return baseElement(id, 'group', { payload: { children } });
}

function themeSource(elements: SlideElement[], overrides: Partial<ThemeInheritanceSource> = {}): ThemeInheritanceSource {
  return { elements, background: { type: 'color', color: '#111111' }, updatedAt: T1, ...overrides };
}

function linkedRow(themeElement: SlideElement, id: string, overrides: Partial<SlideElement> = {}): SlideElement {
  return {
    ...cloneElement(themeElement),
    id,
    slideId: 'slide-1',
    sourceThemeElementId: themeElement.id,
    ...overrides,
  };
}

describe('resolveLinkedSlideElements', () => {
  it('resolves current theme styling immediately while preserving authored text', () => {
    const themeElement = textElement('title', {
      payload: { text: 'Theme Title', fontFamily: 'Arial', fontSize: 48, color: '#FFFFFF', alignment: 'center' },
    });
    const theme = themeSource([themeElement]);
    const row = linkedRow(themeElement, 'row-title', {
      payload: { text: 'Authored Title', fontFamily: 'Helvetica', fontSize: 12, color: '#DDDDDD', alignment: 'left' },
    });

    const resolved = resolveLinkedSlideElements(theme, 'slide-1', [row]);

    expect(resolved).toHaveLength(1);
    // Stable instance ID, not a fresh copy.
    expect(resolved[0].id).toBe('row-title');
    expect(resolved[0].sourceThemeElementId).toBe('title');
    expect(resolved[0].payload).toMatchObject({
      text: 'Authored Title',
      fontSize: 48,
      fontFamily: 'Arial',
      color: '#FFFFFF',
      alignment: 'center',
    });
  });

  it('keeps local overrides fixed when the theme changes', () => {
    const v1 = textElement('title', {
      payload: { text: 'Theme', fontFamily: 'Arial', fontSize: 32, color: '#FFFFFF', alignment: 'left' },
      x: 10,
    });
    const row = linkedRow(v1, 'row-title', { x: 400, themeOverrideKeys: ['x', 'fontSize'] });
    const v2 = textElement('title', {
      payload: { text: 'Theme', fontFamily: 'Georgia', fontSize: 64, color: '#FF0000', alignment: 'right' },
      x: 20,
      y: 30,
    });
    const theme = themeSource([v2]);

    const resolved = resolveLinkedSlideElements(theme, 'slide-1', [row]);

    expect(resolved[0].x).toBe(400);
    expect((resolved[0].payload as { fontSize: number }).fontSize).toBe(32);
    // Non-overridden properties follow the theme live.
    expect(resolved[0].y).toBe(30);
    expect((resolved[0].payload as { fontFamily: string }).fontFamily).toBe('Georgia');
    expect((resolved[0].payload as { color: string }).color).toBe('#FF0000');
  });

  it('represents new theme elements deterministically with no random IDs', () => {
    const theme = themeSource([textElement('a'), textElement('b')]);
    const first = resolveLinkedSlideElements(theme, 'slide-1', []);
    const second = resolveLinkedSlideElements(theme, 'slide-1', []);

    expect(first.map((element) => element.id)).toEqual([
      deriveLinkedElementId('slide-1', 'a'),
      deriveLinkedElementId('slide-1', 'b'),
    ]);
    expect(second.map((element) => element.id)).toEqual(first.map((element) => element.id));
    expect(first[0].sourceThemeElementId).toBe('a');
    expect((first[1].payload as { text: string }).text).toBe('Text b');
  });

  it('drops rows whose source was deleted from the theme without touching storage input', () => {
    const theme = themeSource([textElement('title')]);
    const stale = linkedRow(textElement('stale'), 'row-stale');
    const rows = [linkedRow(theme.elements[0], 'row-title'), stale];

    const resolved = resolveLinkedSlideElements(theme, 'slide-1', rows);

    expect(resolved.map((element) => element.id)).toEqual(['row-title']);
    // Read-only: the input rows are unchanged.
    expect(rows).toHaveLength(2);
  });

  it('replaces a type-changed source with a deterministic derived element', () => {
    const theme = themeSource([imageElement('logo')]);
    const staleText = linkedRow(textElement('logo'), 'row-logo');

    const resolved = resolveLinkedSlideElements(theme, 'slide-1', [staleText]);

    expect(resolved).toHaveLength(1);
    expect(resolved[0].type).toBe('image');
    expect(resolved[0].id).toBe(deriveLinkedElementId('slide-1', 'logo'));
  });

  it('preserves user-created elements and nested local children', () => {
    const themeChild = textElement('c1');
    const theme = themeSource([groupElement('g', [themeChild])]);
    const linkedChild = linkedRow(themeChild, 'row-c1', {
      payload: { ...themeChild.payload, text: 'Authored Child' },
    });
    const localChild = baseElement('local-child', 'image', { payload: { src: 'asset://local' } });
    const groupRow = linkedRow(theme.elements[0], 'row-g', {
      payload: { children: [linkedChild, localChild] },
    });
    const topUser = baseElement('user-1', 'shape', {
      payload: { fillColor: '#FF0000', borderColor: '#000000', borderWidth: 1, borderRadius: 0 },
    });

    const resolved = resolveLinkedSlideElements(theme, 'slide-1', [groupRow, topUser]);

    expect(resolved.map((element) => element.id)).toEqual(['row-g', 'user-1']);
    const children = (resolved[0].payload as { children: SlideElement[] }).children;
    expect(children.map((child) => child.id)).toEqual(['row-c1', 'local-child']);
    expect((children[0].payload as { text: string }).text).toBe('Authored Child');
  });

  it('merges nested group theme edits live while nested overrides hold', () => {
    const innerV1 = textElement('inner', {
      payload: { text: 'Theme Inner', fontFamily: 'Arial', fontSize: 20, color: '#FFFFFF', alignment: 'left' },
    });
    const innerV2 = textElement('inner', {
      payload: { text: 'Theme Inner', fontFamily: 'Georgia', fontSize: 44, color: '#00FF00', alignment: 'left' },
    });
    const existingInner = linkedRow(innerV1, 'row-inner', {
      payload: { ...innerV1.payload, text: 'Authored Inner' },
      themeOverrideKeys: ['color'],
    });
    const existingGroup = linkedRow(groupElement('g', [innerV1]), 'row-g', {
      payload: { children: [existingInner] },
    });
    const theme = themeSource([groupElement('g', [innerV2])]);

    const resolved = resolveLinkedSlideElements(theme, 'slide-1', [existingGroup]);

    const children = (resolved[0].payload as { children: SlideElement[] }).children;
    expect(children).toHaveLength(1);
    expect(children[0].id).toBe('row-inner');
    expect((children[0].payload as { text: string }).text).toBe('Authored Inner');
    expect((children[0].payload as { color: string }).color).toBe('#FFFFFF');
    expect((children[0].payload as { fontFamily: string }).fontFamily).toBe('Georgia');
    expect((children[0].payload as { fontSize: number }).fontSize).toBe(44);
  });

  it('propagates theme geometry edits to rows without overrides', () => {
    const v1 = textElement('title', { x: 10, y: 10 });
    const v2 = textElement('title', { x: 99, y: 88 });
    const row = linkedRow(v1, 'row-title');

    const resolved = resolveLinkedSlideElements(themeSource([v2]), 'slide-1', [row]);

    expect(resolved[0].x).toBe(99);
    expect(resolved[0].y).toBe(88);
    expect(resolved[0].id).toBe('row-title');
  });

  it('preserves rich-text authored content on resolve', () => {
    const richBody = [{ runs: [{ text: 'plain projection' }], indent: 0 }];
    const theme = themeSource([textElement('title')]);
    const row = linkedRow(theme.elements[0], 'row-title', {
      payload: { ...theme.elements[0].payload, format: 'rich', richBody },
    });

    const resolved = resolveLinkedSlideElements(theme, 'slide-1', [row]);

    expect(resolved[0].payload).toMatchObject({ format: 'rich', richBody });
  });
});

describe('resolveLinkedSlideBackground', () => {
  it('applies the theme background unless the slide is local', () => {
    const themeBg = { type: 'color' as const, color: '#123456' };
    const localBg = { type: 'color' as const, color: '#654321' };
    expect(resolveLinkedSlideBackground(themeBg, localBg, 'theme')).toEqual(themeBg);
    expect(resolveLinkedSlideBackground(themeBg, localBg, 'local')).toEqual(localBg);
    expect(resolveLinkedSlideBackground(undefined, localBg, 'theme')).toBeNull();
  });
});

describe('override metadata', () => {
  it('isLinkedSlideElement reflects provenance', () => {
    expect(isLinkedSlideElement(linkedRow(textElement('a'), 'row-a'))).toBe(true);
    expect(isLinkedSlideElement(baseElement('u', 'shape'))).toBe(false);
  });

  it('stampExplicitOverrides records edited keys and clears re-adopted ones', () => {
    const themeElement = textElement('title', {
      payload: { text: 'Theme', fontFamily: 'Arial', fontSize: 32, color: '#FFFFFF', alignment: 'left' },
      x: 10,
    });
    const theme = themeSource([themeElement]);
    const edited = linkedRow(themeElement, 'row-title', {
      x: 400,
      payload: { ...themeElement.payload, text: 'Authored', fontSize: 72 },
      themeOverrideKeys: ['x', 'fontSize', 'color'],
    });

    const [stamped] = stampExplicitOverrides(theme, [edited]);

    // `color` matches the theme again, so the pin is cleared; text is authored, never a key.
    expect(stamped.themeOverrideKeys).toEqual(['fontSize', 'x']);
  });

  it('stampExplicitOverrides leaves unlinked rows by reference', () => {
    const theme = themeSource([textElement('title')]);
    const user = baseElement('user-1', 'shape');
    expect(stampExplicitOverrides(theme, [user])[0]).toBe(user);
    expect(stampExplicitOverrides(null, [user])).toBe(user);
  });

  it('deriveLegacyOverrideKeys captures divergences for the backfill migration', () => {
    const themeElement = textElement('title', {
      payload: { text: 'Theme', fontFamily: 'Arial', fontSize: 32, color: '#FFFFFF', alignment: 'left' },
      x: 10,
    });
    const row = linkedRow(themeElement, 'row-title', {
      x: 400,
      payload: { ...themeElement.payload, text: 'Authored', fontSize: 72 },
    });

    expect(deriveLegacyOverrideKeys(themeElement, row)).toEqual(['fontSize', 'x']);
    expect(deriveLegacyOverrideKeys(null, row)).toEqual([]);
    expect(deriveLegacyOverrideKeys(imageElement('title'), row)).toEqual([]);
  });

  it('override keys survive a JSON reload round-trip', () => {
    const row = linkedRow(textElement('title'), 'row-title', { themeOverrideKeys: ['x', 'fontSize'] });
    const reloaded = JSON.parse(JSON.stringify(row)) as SlideElement;
    const theme = themeSource([textElement('title', { x: 99 })]);

    const resolved = resolveLinkedSlideElements(theme, 'slide-1', [reloaded]);

    expect(resolved[0].x).toBe(0);
    expect(resolved[0].themeOverrideKeys).toEqual(['fontSize', 'x']);
  });
});

describe('planDetachMaterialization', () => {
  it('materializes current resolved appearance before dropping the link', () => {
    const themeElement = textElement('title', {
      payload: { text: 'Theme', fontFamily: 'Georgia', fontSize: 64, color: '#FF0000', alignment: 'center' },
      x: 99,
    });
    const theme = themeSource([themeElement], { background: { type: 'color', color: '#123456' } });
    const row = linkedRow(textElement('title'), 'row-title', {
      payload: { text: 'Authored', fontFamily: 'Arial', fontSize: 32, color: '#FFFFFF', alignment: 'left' },
      x: 10,
    });

    const plan = planDetachMaterialization(theme, 'slide-1', [row], { type: 'color', color: '#000000' }, 'theme');

    expect(plan.creates).toEqual([]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].id).toBe('row-title');
    expect(plan.updates[0].sourceThemeElementId).toBeNull();
    expect(plan.updates[0].themeOverrideKeys).toBeNull();
    expect(plan.updates[0].x).toBe(99);
    expect(plan.updates[0].payload).toMatchObject({ text: 'Authored', fontFamily: 'Georgia', fontSize: 64 });
    expect(plan.background).toEqual({ type: 'color', color: '#123456' });
  });

  it('creates persisted rows for derived theme elements so nothing vanishes on detach', () => {
    const theme = themeSource([textElement('title'), textElement('footer')]);
    const rows = [linkedRow(theme.elements[0], 'row-title')];

    const plan = planDetachMaterialization(theme, 'slide-1', rows, null, 'theme');

    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0].id).toBe(deriveLinkedElementId('slide-1', 'footer'));
    expect(plan.creates[0].sourceThemeElementId).toBe('footer');
    expect(plan.creates[0].slideId).toBe('slide-1');
  });

  it('emits no writes when rows already match the resolved appearance', () => {
    const themeElement = textElement('title');
    const theme = themeSource([themeElement], { background: { type: 'color', color: '#111111' } });
    const row = linkedRow(themeElement, 'row-title');

    const plan = planDetachMaterialization(theme, 'slide-1', [row], { type: 'color', color: '#111111' }, 'local');

    expect(plan.updates).toEqual([]);
    expect(plan.creates).toEqual([]);
    expect(plan.background).toEqual({ type: 'color', color: '#111111' });
  });

  it('yields no writes when the assigned theme is gone', () => {
    const rows = [linkedRow(textElement('title'), 'row-title')];
    const plan = planDetachMaterialization(null, 'slide-1', rows, null, 'theme');
    expect(plan).toEqual({ updates: [], creates: [], background: null });
  });

  it('stripOverrideMetadata drops provenance recursively with stable IDs', () => {
    const child = linkedRow(textElement('c1'), 'row-c1', { themeOverrideKeys: ['x'] });
    const group = linkedRow(groupElement('g', [child]), 'row-g', { themeOverrideKeys: ['opacity'] });

    const stripped = stripOverrideMetadata(group);

    expect(stripped.id).toBe('row-g');
    expect(stripped.sourceThemeElementId).toBeNull();
    expect(stripped.themeOverrideKeys).toBeNull();
    const children = (stripped.payload as { children: SlideElement[] }).children;
    expect(children[0].id).toBe('row-c1');
    expect(children[0].sourceThemeElementId).toBeNull();
  });
});


describe('local removal of inherited elements', () => {
  it('keeps a visibility override across theme edits without retaining deleted local nodes', () => {
    const source = textElement('source');
    const linked = linkedRow(source, 'row');
    const result = preserveThemeLocalRemovals([source], [linked, textElement('local')], []);
    expect(result).toHaveLength(1);
    const stamped = stampExplicitOverrides(themeSource([source]), result, [linked]);
    const resolved = resolveLinkedSlideElements(themeSource([{ ...source, x: 500 }]), 'slide-1', stamped);
    expect(resolved[0]).toMatchObject({ x: 500, payload: { visible: false }, themeOverrideKeys: ['visible'] });
  });

  it('clears nested override metadata when detaching an unchanged group', () => {
    const sourceChild = textElement('child');
    const source = groupElement('group', [sourceChild]);
    const row = linkedRow(source, 'row', { payload: { children: [linkedRow(sourceChild, 'child-row', { themeOverrideKeys: ['x'] })] } });
    const plan = planDetachMaterialization(themeSource([source]), 'slide-1', [row], null, 'theme');
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]?.payload).toMatchObject({ children: [{ themeOverrideKeys: null, sourceThemeElementId: null }] });
  });
});


it('does not erase a deliberate override when an unrelated edit happens to match the theme', () => {
  const source = textElement('source', { x: 123 });
  const before = linkedRow(source, 'row', { themeOverrideKeys: ['x'] });
  const stamped = stampExplicitOverrides(themeSource([source]), [{ ...before, y: 222 }], [before]);
  expect(stamped[0]?.themeOverrideKeys).toEqual(['x', 'y']);
  expect(resolveLinkedSlideElements(themeSource([{ ...source, x: 900 }]), 'slide-1', stamped)[0]?.x).toBe(123);
});

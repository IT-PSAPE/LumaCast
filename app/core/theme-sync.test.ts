import { describe, expect, it } from 'vitest';
import { cloneElement } from './clone';
import { syncThemeToElements } from './themes';
import type { SlideElement, Theme } from './types';

const T0 = '2024-01-01T00:00:00.000Z';

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

function themeWith(elements: SlideElement[]): Theme {
  return {
    id: 'theme-1',
    slideId: 'theme-slide',
    name: 'Theme',
    kind: 'slides',
    width: 1920,
    height: 1080,
    elements,
    collectionId: 'collection-1',
    order: 0,
    createdAt: T0,
    updatedAt: T0,
  };
}

function materializedFrom(themeElement: SlideElement, id: string, overrides: Partial<SlideElement> = {}): SlideElement {
  return {
    ...cloneElement(themeElement),
    id,
    sourceThemeElementId: themeElement.id,
    ...overrides,
  };
}

function userElement(id: string, overrides: Partial<SlideElement> = {}): SlideElement {
  return baseElement(id, 'shape', {
    payload: { fillColor: '#FF0000', borderColor: '#000000', borderWidth: 1, borderRadius: 0 },
    ...overrides,
  });
}

function withoutUpdatedAt(elements: SlideElement[]): Array<Omit<SlideElement, 'updatedAt'>> {
  return elements.map(({ updatedAt: _updatedAt, ...rest }) => rest);
}

describe('syncThemeToElements', () => {
  it('updates matched theme elements in place and preserves authored text', () => {
    const themeElement = textElement('title', {
      payload: { text: 'New Title', fontFamily: 'Arial', fontSize: 48, color: '#FFFFFF', alignment: 'center' },
      zIndex: 10,
    });
    const theme = themeWith([themeElement]);
    const existing = materializedFrom(textElement('title'), 'm-title', {
      payload: { text: 'Authored Title', fontFamily: 'Helvetica', fontSize: 32, color: '#DDDDDD', alignment: 'left' },
    });

    const result = syncThemeToElements(theme, [existing], 'slide-1');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('m-title');
    expect(result[0].zIndex).toBe(10);
    expect(result[0].payload).toMatchObject({
      text: 'Authored Title',
      fontSize: 48,
      color: '#FFFFFF',
      alignment: 'center',
    });
  });

  it('preserves rich-text content on matched text elements', () => {
    const richBody = [{ runs: [{ text: 'plain projection' }], indent: 0 }];
    const theme = themeWith([textElement('title')]);
    const existing = materializedFrom(textElement('title'), 'm-title', {
      payload: {
        text: 'plain projection',
        fontFamily: 'Arial',
        fontSize: 32,
        color: '#FFFFFF',
        alignment: 'left',
        format: 'rich',
        richBody,
      },
    });

    const result = syncThemeToElements(theme, [existing], 'slide-1');

    expect(result[0].payload).toMatchObject({
      format: 'rich',
      richBody,
    });
  });

  it('keeps authored text attached to its theme field when fields are reordered', () => {
    const title = textElement('title', { payload: { text: 'Theme Title', fontFamily: 'Arial', fontSize: 32, color: '#FFFFFF', alignment: 'left' } });
    const body = textElement('body', { payload: { text: 'Theme Body', fontFamily: 'Arial', fontSize: 24, color: '#FFFFFF', alignment: 'left' } });
    const theme = themeWith([title, body]);
    const existingTitle = materializedFrom(title, 'm-title', { payload: { ...title.payload, text: 'Authored Title' } });
    const existingBody = materializedFrom(body, 'm-body', { payload: { ...body.payload, text: 'Authored Body' } });

    // Materialized elements appear in the reverse order of the theme.
    const result = syncThemeToElements(theme, [existingBody, existingTitle], 'slide-1');

    expect(result.map((element) => element.id)).toEqual(['m-title', 'm-body']);
    expect((result[0].payload as { text: string }).text).toBe('Authored Title');
    expect((result[1].payload as { text: string }).text).toBe('Authored Body');
  });

  it('inserts a new theme element next to surviving theme neighbors with theme default text', () => {
    const a = textElement('a');
    const c = textElement('c');
    const b = textElement('b', {
      payload: { text: 'Footer Default', fontFamily: 'Arial', fontSize: 20, color: '#FFFFFF', alignment: 'left' },
    });
    const theme = themeWith([a, b, c]);
    const existingA = materializedFrom(a, 'm-a', { payload: { ...a.payload, text: 'Authored A' } });
    const existingC = materializedFrom(c, 'm-c', { payload: { ...c.payload, text: 'Authored C' } });

    const result = syncThemeToElements(theme, [existingA, existingC], 'slide-1');

    expect(result.map((element) => element.id)).toEqual(['m-a', expect.any(String), 'm-c']);
    const inserted = result[1];
    expect(inserted.sourceThemeElementId).toBe('b');
    expect(inserted.id).not.toBe(existingA.id);
    expect(inserted.id).not.toBe(existingC.id);
    expect((inserted.payload as { text: string }).text).toBe('Footer Default');
  });

  it('never pulls authored text into a newly added text field', () => {
    const title = textElement('title', { payload: { text: 'Theme Title', fontFamily: 'Arial', fontSize: 32, color: '#FFFFFF', alignment: 'left' } });
    const theme = themeWith([title, textElement('footer', { payload: { text: 'Theme Footer', fontFamily: 'Arial', fontSize: 20, color: '#FFFFFF', alignment: 'left' } })]);
    const existing = materializedFrom(title, 'm-title', { payload: { ...title.payload, text: 'Authored Title' } });

    const result = syncThemeToElements(theme, [existing], 'slide-1');

    const footer = result.find((element) => element.sourceThemeElementId === 'footer');
    expect((footer?.payload as { text: string }).text).toBe('Theme Footer');
  });

  it('removes only elements proven to originate from a removed theme element', () => {
    const title = textElement('title');
    const stale = textElement('stale');
    const theme = themeWith([title]);
    const existingTitle = materializedFrom(title, 'm-title', { payload: { ...title.payload, text: 'Authored Title' } });
    const existingStale = materializedFrom(stale, 'm-stale', { payload: { ...stale.payload, text: 'Stale Text' } });

    const result = syncThemeToElements(theme, [existingTitle, existingStale], 'slide-1');

    expect(result.map((element) => element.id)).toEqual(['m-title']);
  });

  it('replaces a matched element with a new ID when its source type changes', () => {
    const theme = themeWith([imageElement('logo')]);
    const existing = materializedFrom(textElement('logo'), 'm-logo', {
      payload: { text: 'Stale Text', fontFamily: 'Arial', fontSize: 32, color: '#FFFFFF', alignment: 'left' },
    });

    const result = syncThemeToElements(theme, [existing], 'slide-1');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('image');
    expect(result[0].id).not.toBe('m-logo');
    expect(result[0].sourceThemeElementId).toBe('logo');
    expect((result[0].payload as { src: string }).src).toBe('asset://logo');
  });

  it('preserves user-created elements in their original relative order', () => {
    const themeElement = textElement('title', { zIndex: 10 });
    const theme = themeWith([themeElement]);
    const existing = materializedFrom(themeElement, 'm-title', { zIndex: 10 });
    const u1 = userElement('u1', { zIndex: 5 });
    const u2 = userElement('u2', { zIndex: 5 });

    const result = syncThemeToElements(theme, [u1, existing, u2], 'slide-1');

    expect(result.map((element) => element.id)).toEqual(['m-title', 'u1', 'u2']);
  });

  it('keeps equal-z user elements stable across repeated merges', () => {
    const themeElement = textElement('title', { zIndex: 10 });
    const theme = themeWith([themeElement]);
    const existing = materializedFrom(themeElement, 'm-title');
    const u1 = userElement('u1', { zIndex: 5 });
    const u2 = userElement('u2', { zIndex: 5 });

    const first = syncThemeToElements(theme, [u1, existing, u2], 'slide-1');
    const second = syncThemeToElements(theme, first, 'slide-1');

    expect(second.map((element) => element.id)).toEqual(['m-title', 'u1', 'u2']);
  });

  it('preserves user-created children inside a matched group', () => {
    const themeChild = textElement('c1');
    const group = groupElement('g', [themeChild]);
    const theme = themeWith([group]);
    const existingChild = materializedFrom(themeChild, 'm-c1', { payload: { ...themeChild.payload, text: 'Authored Child' } });
    const localChild = baseElement('u-child', 'image', { payload: { src: 'asset://local' } });
    const existingGroup = materializedFrom(group, 'm-g', {
      payload: { children: [existingChild, localChild] },
    });

    const result = syncThemeToElements(theme, [existingGroup], 'slide-1');

    const groupPayload = result[0].payload as { children: SlideElement[] };
    expect(groupPayload.children.map((child) => child.id)).toEqual(['m-c1', 'u-child']);
    expect((groupPayload.children[0].payload as { text: string }).text).toBe('Authored Child');
  });

  it('merges nested group children recursively', () => {
    const innerText = textElement('inner');
    const innerGroup = groupElement('g2', [innerText]);
    const outerGroup = groupElement('g1', [innerGroup]);
    const theme = themeWith([outerGroup]);

    const existingInner = materializedFrom(innerText, 'm-inner', { payload: { ...innerText.payload, text: 'Authored Inner' } });
    const localChild = baseElement('u-inner', 'image', { payload: { src: 'asset://local' } });
    const existingInnerGroup = materializedFrom(innerGroup, 'm-g2', { payload: { children: [existingInner, localChild] } });
    const existingOuterGroup = materializedFrom(outerGroup, 'm-g1', { payload: { children: [existingInnerGroup] } });

    const result = syncThemeToElements(theme, [existingOuterGroup], 'slide-1');

    const g2Children = ((result[0].payload as { children: SlideElement[] }).children[0].payload as { children: SlideElement[] }).children;
    expect(g2Children.map((child) => child.id)).toEqual(['m-inner', 'u-inner']);
    expect((g2Children[0].payload as { text: string }).text).toBe('Authored Inner');
  });

  it('adds and removes theme children inside a group while keeping local children', () => {
    const kept = textElement('kept');
    const removed = textElement('removed');
    const group = groupElement('g', [kept, removed]);
    const theme = themeWith([groupElement('g', [kept])]);

    const existingKept = materializedFrom(kept, 'm-kept');
    const existingRemoved = materializedFrom(removed, 'm-removed');
    const localChild = baseElement('u-child', 'image', { payload: { src: 'asset://local' } });
    const existingGroup = materializedFrom(group, 'm-g', {
      payload: { children: [existingKept, existingRemoved, localChild] },
    });

    const result = syncThemeToElements(theme, [existingGroup], 'slide-1');

    const children = (result[0].payload as { children: SlideElement[] }).children;
    expect(children.map((child) => child.id)).toEqual(['m-kept', 'u-child']);
  });

  it('replaces a type-changed group child with a new ID', () => {
    const themeChild = textElement('c1');
    const group = groupElement('g', [imageElement('c1')]);
    const theme = themeWith([group]);
    const existingChild = materializedFrom(themeChild, 'm-c1', {
      payload: { text: 'Stale', fontFamily: 'Arial', fontSize: 32, color: '#FFFFFF', alignment: 'left' },
    });
    const existingGroup = materializedFrom(groupElement('g', [themeChild]), 'm-g', { payload: { children: [existingChild] } });

    const result = syncThemeToElements(theme, [existingGroup], 'slide-1');

    const children = (result[0].payload as { children: SlideElement[] }).children;
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe('image');
    expect(children[0].id).not.toBe('m-c1');
    expect(children[0].sourceThemeElementId).toBe('c1');
  });

  it('materializes a brand-new group with its theme-authored children', () => {
    const innerText = textElement('new-text', { payload: { text: 'Default Line', fontFamily: 'Arial', fontSize: 32, color: '#FFFFFF', alignment: 'left' } });
    const theme = themeWith([groupElement('new-group', [innerText])]);

    const result = syncThemeToElements(theme, [], 'slide-1');

    expect(result).toHaveLength(1);
    expect(result[0].sourceThemeElementId).toBe('new-group');
    const children = (result[0].payload as { children: SlideElement[] }).children;
    expect(children).toHaveLength(1);
    expect(children[0].sourceThemeElementId).toBe('new-text');
    expect((children[0].payload as { text: string }).text).toBe('Default Line');
  });

  it('is idempotent when repeated with identical inputs', () => {
    const themeElement = textElement('title', { payload: { text: 'Theme Title', fontFamily: 'Arial', fontSize: 32, color: '#FFFFFF', alignment: 'left' }, zIndex: 10 });
    const theme = themeWith([themeElement, textElement('footer', { payload: { text: 'Footer', fontFamily: 'Arial', fontSize: 20, color: '#FFFFFF', alignment: 'left' } })]);
    const existing = materializedFrom(themeElement, 'm-title', { payload: { ...themeElement.payload, text: 'Authored Title' } });
    const user = userElement('u1', { zIndex: 5 });

    const first = syncThemeToElements(theme, [user, existing], 'slide-1');
    const second = syncThemeToElements(theme, first, 'slide-1');

    expect(withoutUpdatedAt(second)).toEqual(withoutUpdatedAt(first));
  });

  it('is idempotent for nested group content when repeated with identical inputs', () => {
    const innerText = textElement('inner', { payload: { text: 'Theme Inner', fontFamily: 'Arial', fontSize: 20, color: '#FFFFFF', alignment: 'left' } });
    const group = groupElement('g', [innerText]);
    const theme = themeWith([group]);
    const existingInner = materializedFrom(innerText, 'm-inner', { payload: { ...innerText.payload, text: 'Authored Inner' } });
    const localChild = baseElement('u-child', 'image', { payload: { src: 'asset://local' } });
    const existingGroup = materializedFrom(group, 'm-g', { payload: { children: [existingInner, localChild] } });

    const first = syncThemeToElements(theme, [existingGroup], 'slide-1');
    const second = syncThemeToElements(theme, first, 'slide-1');

    expect(withoutUpdatedAt(second)).toEqual(withoutUpdatedAt(first));
  });

  it('treats an explicit null sourceThemeElementId as user-created', () => {
    const theme = themeWith([textElement('title')]);
    const explicitlyLocal = userElement('u1', { sourceThemeElementId: null });

    const result = syncThemeToElements(theme, [explicitlyLocal], 'slide-1');

    expect(result.map((element) => element.id)).toEqual([expect.any(String), 'u1']);
    expect(result[1]).toEqual(explicitlyLocal);
  });

  it('materializes a brand-new top-level element with theme default text and a collision-free ID', () => {
    const theme = themeWith([textElement('title', { payload: { text: 'Theme Title', fontFamily: 'Arial', fontSize: 32, color: '#FFFFFF', alignment: 'left' } })]);

    const result = syncThemeToElements(theme, [], 'slide-1');

    expect(result).toHaveLength(1);
    expect(result[0].sourceThemeElementId).toBe('title');
    expect(result[0].id).not.toBe('title');
    expect((result[0].payload as { text: string }).text).toBe('Theme Title');
  });

  it('removes all theme-owned elements when the theme has none, preserving user-created elements', () => {
    const theme = themeWith([]);
    const stale = materializedFrom(textElement('title'), 'm-title');
    const user = userElement('u1');

    const result = syncThemeToElements(theme, [stale, user], 'slide-1');

    expect(result.map((element) => element.id)).toEqual(['u1']);
  });

  it('produces an empty result for an empty theme and no content elements', () => {
    const theme = themeWith([]);

    const result = syncThemeToElements(theme, [], 'slide-1');

    expect(result).toEqual([]);
  });
});
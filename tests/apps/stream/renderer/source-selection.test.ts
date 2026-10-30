import { describe, expect, it } from 'vitest';
import {
  canResizeSourceTree,
  isSourceTransformableInTree,
  selectedSourceRoots,
  translateSourceSelection,
  visibleSelectedSourceRoots,
} from '../../../../apps/stream/renderer/source-selection';
import type { StreamSource } from '../../../../apps/stream/shared/desktop-api';

function source(id: string, x: number, overrides: Partial<StreamSource> = {}): StreamSource {
  return {
    id,
    name: id,
    kind: 'display',
    visible: true,
    muted: false,
    volume: 1,
    transform: { x, y: 10, width: 20, height: 20 },
    ...overrides,
  };
}

describe('source selection transforms', () => {
  it('moves selected sources and selected groups by the same pointer delta', () => {
    const first = source('first', 0);
    const second = source('second', 40);
    const next = translateSourceSelection([first, second], ['first', 'second'], 12, -4);

    expect(next.map((item) => [item.transform.x, item.transform.y])).toEqual([[12, 6], [52, 6]]);

    const group: StreamSource = source('group', 0, {
      kind: 'group',
      children: [first, second],
      transform: { x: 0, y: 10, width: 60, height: 20 },
    });
    const movedGroup = translateSourceSelection([group], ['group'], 12, -4)[0]!;
    expect(movedGroup.transform).toMatchObject({ x: 12, y: 6 });
    expect(movedGroup.children?.map((item) => item.transform.x)).toEqual([12, 52]);
  });

  it('does not transform locked, hidden, or protected descendants', () => {
    const locked = source('locked', 40, { locked: true });
    const hidden = source('hidden', 80, { visible: false });
    const movable = source('movable', 0);
    const group = source('group', 0, {
      kind: 'group',
      children: [movable, locked, hidden],
      transform: { x: 0, y: 10, width: 100, height: 20 },
    });
    const next = translateSourceSelection([group], ['group'], 10, 5)[0]!;

    expect(next.children?.map((item) => item.transform.x)).toEqual([10, 40, 80]);
    expect(next.children?.map((item) => item.transform.y)).toEqual([15, 10, 10]);
    expect(isSourceTransformableInTree([source('locked-parent', 0, { kind: 'group', locked: true, children: [movable] })], 'movable')).toBe(false);
    expect(canResizeSourceTree(group)).toBe(false);
    expect(translateSourceSelection([source('parent', 0, { kind: 'group', visible: false, children: [movable] })], ['movable'], 10, 5)[0]?.children?.[0]?.transform.x).toBe(0);
  });

  it('removes selected descendants when a selected group already owns them', () => {
    const child = source('child', 10);
    const group = source('group', 10, { kind: 'group', children: [child] });
    const sibling = source('sibling', 50);

    expect(selectedSourceRoots([group, sibling], ['child', 'group', 'sibling']).map((item) => item.id)).toEqual(['group', 'sibling']);
  });

  it('shows only visible selected roots and hides child frames when their group is selected', () => {
    const child = source('child', 10);
    const hiddenChild = source('hidden-child', 50, { visible: false });
    const group = source('group', 10, { kind: 'group', children: [child, hiddenChild] });

    expect(visibleSelectedSourceRoots([group], ['group', 'child', 'hidden-child']).map((item) => item.id)).toEqual(['group']);
    expect(visibleSelectedSourceRoots([source('hidden-parent', 0, { kind: 'group', visible: false, children: [child] })], ['child'])).toEqual([]);
  });
});

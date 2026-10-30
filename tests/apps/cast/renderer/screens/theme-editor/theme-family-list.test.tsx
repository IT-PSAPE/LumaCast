import { fireEvent, render, screen } from '@testing-library/react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeOwnerType } from '@lumacast/composition';
import { ThemeFamilyList } from '../../../../../../apps/cast/renderer/screens/theme-editor/theme-family-list';

const mocks = vi.hoisted(() => ({
  selectTheme: vi.fn(),
  sortableOptions: null as null | { selectedIds: ReadonlySet<string> },
}));

vi.mock('@renderer/contexts/asset-editor/asset-editor-context', () => ({
  useThemeEditor: () => ({ reorderTheme: vi.fn() }),
}));

vi.mock('../../../../../../apps/cast/renderer/screens/theme-editor/screen-context', () => ({
  useThemeEditorScreen: () => ({
    state: { currentThemeId: 'theme-a' },
    actions: { selectTheme: mocks.selectTheme },
  }),
}));

vi.mock('@renderer/components/layout/sortable-list', () => ({
  SortableList: { Root: ({ children }: { children: ReactNode }) => <>{children}</> },
  useSortableOrder: (options: { items: unknown[]; selectedIds: ReadonlySet<string> }) => {
    mocks.sortableOptions = options;
    return {
      items: options.items,
      dnd: { ids: [], activeId: null, disabled: false, onKeyboardMoveToIndex: vi.fn(), onDragStart: vi.fn(), onDragEnd: vi.fn(), onDragCancel: vi.fn() },
    };
  },
}));

vi.mock('../../../../../../apps/cast/renderer/screens/theme-editor/theme-list-item', () => ({
  ThemeListItem: (props: {
    theme: { id: string; name: string };
    selection: { selectedIds: ReadonlySet<string> };
    onSelect: (event: ReactMouseEvent<HTMLElement>) => void;
  }) => (
    <button
      type="button"
      data-testid={`theme-${props.theme.id}`}
      data-selected={props.selection.selectedIds.has(props.theme.id) ? 'true' : 'false'}
      onClick={props.onSelect}
    >
      {props.theme.name}
    </button>
  ),
}));

const themes = [
  { id: 'theme-a', name: 'Theme A' },
  { id: 'theme-b', name: 'Theme B' },
  { id: 'theme-c', name: 'Theme C' },
  { id: 'theme-d', name: 'Theme D' },
] as never[];

beforeEach(() => {
  mocks.sortableOptions = null;
  vi.clearAllMocks();
});

describe('ThemeFamilyList selection', () => {
  it('toggles a selection without changing the active editor context', () => {
    render(<ThemeFamilyList themeType={'presentation' as ThemeOwnerType} themes={themes} />);

    fireEvent.click(screen.getByTestId('theme-theme-a'));
    fireEvent.click(screen.getByTestId('theme-theme-b'), { metaKey: true });

    expect(mocks.selectTheme).toHaveBeenCalledOnce();
    expect(mocks.selectTheme).toHaveBeenCalledWith('presentation', 'theme-a');
    expect(screen.getByTestId('theme-theme-a').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('theme-theme-b').getAttribute('data-selected')).toBe('true');
    expect(mocks.sortableOptions?.selectedIds).toEqual(new Set(['theme-a', 'theme-b']));
  });

  it('keeps select-all and clear-selection shortcuts inside the resource list', () => {
    const parentKeyDown = vi.fn();
    render(<div onKeyDown={parentKeyDown}><ThemeFamilyList themeType={'presentation' as ThemeOwnerType} themes={themes} /></div>);

    fireEvent.keyDown(screen.getByTestId('theme-theme-a'), { key: 'a', ctrlKey: true });

    expect(screen.getByRole('grid').getAttribute('data-shortcuts-scope')).toBe('ignore');
    expect(mocks.sortableOptions?.selectedIds).toEqual(new Set(['theme-a', 'theme-b', 'theme-c', 'theme-d']));
    expect(parentKeyDown).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByTestId('theme-theme-a'), { key: 'Escape' });

    expect(mocks.sortableOptions?.selectedIds).toEqual(new Set());
    expect(parentKeyDown).not.toHaveBeenCalled();
  });
});

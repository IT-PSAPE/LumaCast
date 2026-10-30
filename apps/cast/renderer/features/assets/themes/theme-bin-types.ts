import type { ThemeOwnerType } from '@lumacast/composition';
import type { EditorThemeSource } from '@lumacast/canvas';
import type { Id } from '@lumacast/kernel';
import type { SelectionModifiers } from '@lumacast/selection';

export interface ThemeItemProps {
  theme: EditorThemeSource;
  themeType: ThemeOwnerType;
  onApply: (theme: EditorThemeSource) => void;
  isResourceSelected?: boolean;
  onSelectionClick?: (id: Id, modifiers: SelectionModifiers) => boolean;
  onContextMenuTarget?: (id: Id) => void;
  onDeleteResource?: (theme: EditorThemeSource) => Promise<void> | void;
  onDuplicateResource?: (theme: EditorThemeSource) => Promise<void> | void;
}

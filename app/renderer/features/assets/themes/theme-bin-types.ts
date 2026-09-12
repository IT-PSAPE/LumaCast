import type { ThemeOwnerType } from '@lumacast/composition';
import type { EditorThemeSource } from '@lumacast/canvas';

export interface ThemeItemProps {
  theme: EditorThemeSource;
  index: number;
  themeType: ThemeOwnerType;
  onApply: (theme: EditorThemeSource) => void;
}

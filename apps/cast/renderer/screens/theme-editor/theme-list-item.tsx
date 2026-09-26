import { ContextMenu } from '@renderer/components/overlays/context-menu';
import type { ThemeOwnerType } from '@lumacast/composition';
import { useThemeEditorScreen } from './screen-context';
import { ThemeListItemBody } from './theme-list-item-body';

export function ThemeListItem(props: {
  theme: ReturnType<typeof useThemeEditorScreen>['state']['themes'][number];
  themeType: ThemeOwnerType;
  index: number;
  isActive: boolean;
}) {
  return (
    <ContextMenu.Root>
      <ThemeListItemBody {...props} />
    </ContextMenu.Root>
  );
}

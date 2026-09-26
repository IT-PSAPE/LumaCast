import { useRef } from 'react';
import { SelectableRow } from '../../../components/display/selectable-row';
import { RenameField, type RenameFieldHandle } from '../../../components/form/rename-field';
import { useContextMenuTrigger } from '../../../components/overlays/context-menu';
import { useThemeEditor } from '../../../contexts/asset-editor/asset-editor-context';
import type { ThemeItemProps } from './theme-bin-types';
import { ThemeContextMenuItems } from './theme-context-menu-items';
import { useDeleteTheme } from './use-delete-theme';

export function ThemeRowBody({ theme, index, themeType, onApply }: ThemeItemProps) {
  const { renameTheme } = useThemeEditor();
  const renameRef = useRef<RenameFieldHandle>(null);
  const handleDelete = useDeleteTheme(theme);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ onDelete: () => { void handleDelete(); } });

  function handleClick() {
    onApply(theme);
  }

  function handleRename(next: string) {
    renameTheme(theme.id, next);
  }

  return (
    <>
      <SelectableRow.Root
        {...triggerHandlers}
        ref={triggerRef}
        selected={false}
        onClick={handleClick}
        className="h-9 focus-visible:ring-2 focus-visible:ring-brand"
      >
        <SelectableRow.Leading>
          <span className="text-xs font-semibold tabular-nums text-tertiary">{index + 1}</span>
        </SelectableRow.Leading>
        <SelectableRow.Label>
          <RenameField ref={renameRef} value={theme.name} onValueChange={handleRename} className="label-xs" />
        </SelectableRow.Label>
      </SelectableRow.Root>
      <ThemeContextMenuItems theme={theme} themeType={themeType} renameRef={renameRef} onDelete={() => { void handleDelete(); }} />
    </>
  );
}

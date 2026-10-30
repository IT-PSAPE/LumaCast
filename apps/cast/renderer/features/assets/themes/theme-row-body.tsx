import { useRef } from 'react';
import { SelectableRow } from '../../../components/display/selectable-row';
import { RenameField, type RenameFieldHandle } from '../../../components/form/rename-field';
import { useContextMenuTrigger } from '@lumacast/ui';
import { useThemeEditor } from '../../../contexts/asset-editor/asset-editor-context';
import type { ThemeItemProps } from './theme-bin-types';
import { ThemeContextMenuItems } from './theme-context-menu-items';
import { useDeleteTheme } from './use-delete-theme';

export function ThemeRowBody(props: ThemeItemProps) {
  const { theme, themeType, onApply, isResourceSelected, onSelectionClick, onContextMenuTarget, onDeleteResource, onDuplicateResource } = props;
  const { renameTheme, duplicateTheme } = useThemeEditor();
  const renameRef = useRef<RenameFieldHandle>(null);
  const deleteTheme = useDeleteTheme(theme);
  const handleDelete = () => onDeleteResource ? Promise.resolve(onDeleteResource(theme)) : deleteTheme();
  const handleDuplicate = () => onDuplicateResource ? Promise.resolve(onDuplicateResource(theme)) : Promise.resolve(duplicateTheme(theme.id));
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ onDelete: () => { void handleDelete().catch(() => undefined); } });

  function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    const modifiers = { shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey };
    if (onSelectionClick?.(theme.id, modifiers)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onApply(theme);
  }

  function handleRename(next: string) {
    renameTheme(theme.id, next);
  }

  return (
    <>
      <SelectableRow.Root
        {...triggerHandlers}
        onContextMenuCapture={() => onContextMenuTarget?.(theme.id)}
        onKeyDownCapture={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) onContextMenuTarget?.(theme.id);
        }}
        onTouchStartCapture={() => onContextMenuTarget?.(theme.id)}
        ref={triggerRef}
        selected={Boolean(isResourceSelected)}
        onClick={handleClick}
        className="h-9 focus-visible:ring-2 focus-visible:ring-brand"
      >
        <SelectableRow.Label>
          <RenameField ref={renameRef} value={theme.name} onValueChange={handleRename} className="label-xs" />
        </SelectableRow.Label>
      </SelectableRow.Root>
      <ThemeContextMenuItems
        theme={theme}
        themeType={themeType}
        renameRef={renameRef}
        onDelete={() => { void handleDelete().catch(() => undefined); }}
        onDuplicate={() => { void handleDuplicate().catch(() => undefined); }}
      />
    </>
  );
}

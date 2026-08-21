import { useEffect, useRef, useState } from 'react';
import type { SlideElement, TextElementPayload } from '@lumacast/composition';
import { Eye, EyeOff, Lock, LockOpen } from 'lucide-react';
import { SelectableRow, selectableRowStyles } from '@renderer/components/display/selectable-row';
import { useSortableItem } from '@renderer/components/layout/sortable-list';
import { cn } from '@renderer/utils/cn';
import { compactText } from '@renderer/utils/slides';
import { ElementTypeIcon } from './element-type-icon';

export function SortableLayerRow({
  element,
  isSelected,
  onSelect,
  onRename,
  onToggleVisibility,
  onToggleLock,
}: {
  element: SlideElement;
  isSelected: boolean;
  onSelect: (element: SlideElement) => void;
  onRename: (id: SlideElement['id'], name: string) => void | Promise<void>;
  onToggleVisibility: (id: SlideElement['id'], visible: boolean) => void | Promise<void>;
  onToggleLock: (id: SlideElement['id'], locked: boolean) => void | Promise<void>;
}) {
  const [isEditing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const isHidden = element.payload.visible === false;
  const isLocked = element.payload.locked === true;
  // Editing suspends dragging outright: the name field lives inside the drag
  // activator, so a text selection would otherwise lift the row.
  const { containerRef, containerStyle, handleProps } = useSortableItem(element.id, isEditing);

  useEffect(() => {
    if (!isEditing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [isEditing]);

  function startEditing() {
    setDraftName(element.payload.name ?? '');
    setEditing(true);
  }

  function commitEditing() {
    setEditing(false);
    if (draftName !== (element.payload.name ?? '')) void onRename(element.id, draftName);
  }

  // Rendered as a div with role=button (not a real <button>) so the trailing
  // lock/hide controls — which are actual <button>s — aren't nested inside
  // another <button>, which would be invalid HTML.
  return (
    <div ref={containerRef} style={containerStyle} className="group">
      <div
        {...handleProps}
        aria-pressed={isSelected}
        onClick={() => { if (!isEditing) onSelect(element); }}
        onKeyDown={(event) => {
          if (isEditing) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(element);
          }
        }}
        className={cn(
          selectableRowStyles({ selected: isSelected }),
          'w-full',
          !isEditing && 'cursor-grab active:cursor-grabbing',
          isHidden && 'opacity-50',
        )}
      >
        <SelectableRow.Leading className="flex items-center gap-1.5">
          <ElementTypeIcon type={element.type} />
        </SelectableRow.Leading>
        {isEditing ? (
          <input
            ref={inputRef}
            value={draftName}
            placeholder={defaultTitle(element)}
            onChange={(event) => setDraftName(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onBlur={commitEditing}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); commitEditing(); }
              if (event.key === 'Escape') { event.preventDefault(); setEditing(false); }
            }}
            className="min-w-0 flex-1 rounded bg-tertiary px-1 py-0.5 text-sm text-primary outline-none focus:ring-1 focus:ring-brand"
          />
        ) : (
          <SelectableRow.Label onDoubleClick={startEditing}>{elementTitle(element)}</SelectableRow.Label>
        )}
        <SelectableRow.Trailing>
          <button
            type="button"
            aria-label={isLocked ? 'Unlock layer' : 'Lock layer'}
            className={cn(
              'text-tertiary hover:text-secondary',
              isLocked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            )}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); void onToggleLock(element.id, !isLocked); }}
          >
            {isLocked ? <Lock size={13} strokeWidth={2} /> : <LockOpen size={13} strokeWidth={2} />}
          </button>
          <button
            type="button"
            aria-label={isHidden ? 'Show layer' : 'Hide layer'}
            className={cn(
              'text-tertiary hover:text-secondary',
              isHidden ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            )}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); void onToggleVisibility(element.id, isHidden); }}
          >
            {isHidden ? <EyeOff size={13} strokeWidth={2} /> : <Eye size={13} strokeWidth={2} />}
          </button>
        </SelectableRow.Trailing>
      </div>
    </div>
  );
}

function elementTitle(element: SlideElement): string {
  const custom = element.payload.name?.trim();
  if (custom) return compactText(custom, 32);
  return defaultTitle(element);
}

function defaultTitle(element: SlideElement): string {
  if (element.type !== 'text') return capitalize(element.type);
  const payload = element.payload as TextElementPayload;
  const rawText = String(payload.text ?? '').trim();
  if (!rawText) return 'Text';
  return compactText(rawText, 32);
}

function capitalize(value: string): string {
  if (!value) return value;
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

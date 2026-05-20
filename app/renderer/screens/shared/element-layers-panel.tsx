import { useEffect, useRef, useState } from 'react';
import type { SlideElement, TextElementPayload } from '@core/types';
import { Box, Eye, EyeOff, Film, Image, Lock, LockOpen, Square, Type } from 'lucide-react';
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { EmptyState } from '@renderer/components/display/empty-state';
import { SelectableRow, selectableRowStyles } from '@renderer/components/display/selectable-row';
import { useElements } from '@renderer/contexts/canvas/canvas-context';
import { useInspector } from '@renderer/features/inspector/inspector-context';
import { cn } from '@renderer/utils/cn';
import { compactText } from '@renderer/utils/slides';

export function ElementLayersPanel({ emptyMessage }: { emptyMessage: string }) {
  const { effectiveElements, selectedElementId, selectElement, reorderElements, renameElement, toggleElementVisibility, toggleElementLock } = useElements();
  const { setInspectorTab } = useInspector();

  // A 4px activation distance means a plain click never starts a drag, so the
  // whole row stays clickable for selection while still being draggable.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // Top of the list is front-most (highest layer, then highest zIndex).
  const orderedElements = effectiveElements
    .slice()
    .reverse();

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedElements.findIndex((el) => el.id === active.id);
    const newIndex = orderedElements.findIndex((el) => el.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const frontToBack = arrayMove(orderedElements, oldIndex, newIndex);
    // reorderElements expects back→front order.
    void reorderElements(frontToBack.map((el) => el.id).reverse());
  }

  function handleSelect(element: SlideElement) {
    selectElement(element.id);
    setInspectorTab(element.type === 'text' ? 'text' : element.type === 'video' ? 'video' : 'shape');
  }

  if (orderedElements.length === 0) {
    return (
      <EmptyState.Root data-ui-region="object-list-panel">
        <EmptyState.Title>{emptyMessage}</EmptyState.Title>
      </EmptyState.Root>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={orderedElements.map((el) => el.id)} strategy={verticalListSortingStrategy}>
        <div data-ui-region="object-list-panel" className="flex w-full flex-col gap-1.5">
          {orderedElements.map((element) => (
            <SortableLayerRow
              key={element.id}
              element={element}
              isSelected={element.id === selectedElementId}
              onSelect={handleSelect}
              onRename={renameElement}
              onToggleVisibility={toggleElementVisibility}
              onToggleLock={toggleElementLock}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableLayerRow({
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: element.id });
  const [isEditing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const isHidden = element.payload.visible === false;
  const isLocked = element.payload.locked === true;

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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
  };

  // Rendered as a div with role=button (not a real <button>) so the trailing
  // lock/hide controls — which are actual <button>s — aren't nested inside
  // another <button>, which would be invalid HTML.
  return (
    <div ref={setNodeRef} style={style} className="group">
      <div
        {...attributes}
        {...(isEditing ? {} : listeners)}
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

function ElementTypeIcon({ type }: { type: SlideElement['type'] }) {
  const className = 'text-tertiary';
  if (type === 'text') return <Type size={12} strokeWidth={2} className={className} />;
  if (type === 'shape') return <Square size={12} strokeWidth={2} className={className} />;
  if (type === 'image') return <Image size={12} strokeWidth={2} className={className} />;
  if (type === 'video') return <Film size={12} strokeWidth={2} className={className} />;
  return <Box size={12} strokeWidth={2} className={className} />;
}

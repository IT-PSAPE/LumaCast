import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, FolderClosed, FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Collection } from '@core/types';
import { cn } from '@renderer/utils/cn';
import { Popover } from '../../components/overlays/popover';
import { useConfirm } from '../../components/overlays/confirm-dialog';
import type { BinCollectionsApi } from './use-bin-collections';

interface CollectionPickerProps {
  api: BinCollectionsApi;
  className?: string;
}

export function CollectionPicker({ api, className }: CollectionPickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const activeName = api.activeCollection?.name ?? 'All collections';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex h-7 items-center gap-1.5 rounded bg-tertiary px-2 text-sm text-secondary transition-colors hover:bg-tertiary/60 hover:text-primary',
          open && 'bg-tertiary/60 text-primary',
          className,
        )}
        title="Collections"
      >
        {api.activeCollection ? (
          <FolderOpen size={12} strokeWidth={1.75} className="shrink-0 text-tertiary" />
        ) : (
          <FolderClosed size={12} strokeWidth={1.75} className="shrink-0 text-tertiary" />
        )}
        <span className="max-w-[140px] truncate">{activeName}</span>
        <ChevronDown size={12} strokeWidth={1.75} className="shrink-0 text-tertiary" />
      </button>
      <Popover anchor={triggerRef.current} open={open} onClose={() => setOpen(false)} placement="top-start" offset={6}>
        <CollectionPickerPopover api={api} onClose={() => setOpen(false)} />
      </Popover>
    </>
  );
}

interface PopoverContentProps {
  api: BinCollectionsApi;
  onClose: () => void;
}

function CollectionPickerPopover({ api, onClose }: PopoverContentProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return api.collections;
    return api.collections.filter((collection) => collection.name.toLowerCase().includes(q));
  }, [api.collections, query]);

  const exactMatch = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return api.collections.find((collection) => collection.name.toLowerCase() === q) ?? null;
  }, [api.collections, query]);

  const showCreateOption = query.trim().length > 0 && !exactMatch;

  async function handleCreate() {
    const name = query.trim();
    if (!name) return;
    const id = await api.createCollection(name);
    if (id) {
      setQuery('');
      onClose();
    }
  }

  function handleSelect(collection: Collection) {
    api.setActiveCollectionId(collection.id);
    onClose();
  }

  function handleStartRename(collection: Collection) {
    setRenamingId(collection.id);
    setRenameDraft(collection.name);
  }

  async function commitRename(collection: Collection) {
    const next = renameDraft.trim();
    setRenamingId(null);
    if (!next || next === collection.name) return;
    await api.renameCollection(collection.id, next);
  }

  async function handleDelete(collection: Collection) {
    const ok = await confirm({
      title: `Delete "${collection.name}"?`,
      description: 'Items in this collection will move to the default collection.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await api.deleteCollection(collection.id);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (showCreateOption) {
        void handleCreate();
      } else if (filtered.length === 1) {
        handleSelect(filtered[0]);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <div className="flex w-64 flex-col gap-1 rounded-md border border-secondary bg-background-secondary/95 p-1.5 shadow-lg backdrop-blur">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search or create…"
        className="rounded bg-tertiary px-2 py-1.5 text-sm text-primary outline-none placeholder:text-tertiary focus:bg-tertiary/60"
      />
      <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
        {filtered.length === 0 && !showCreateOption ? (
          <div className="px-2 py-2 text-center text-xs text-tertiary">No collections</div>
        ) : null}
        {filtered.map((collection) => {
          const isActive = api.activeCollection?.id === collection.id;
          const isRenaming = renamingId === collection.id;
          return (
            <div
              key={collection.id}
              className={cn(
                'group flex h-7 min-w-0 items-center gap-1.5 rounded px-1.5 transition-colors',
                isActive ? 'bg-active text-primary' : 'text-secondary hover:bg-tertiary/55',
              )}
            >
              {isActive ? (
                <FolderOpen size={12} strokeWidth={1.75} className="shrink-0 text-tertiary" />
              ) : (
                <FolderClosed size={12} strokeWidth={1.75} className="shrink-0 text-tertiary" />
              )}
              {isRenaming ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onBlur={() => { void commitRename(collection); }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); void commitRename(collection); }
                    else if (event.key === 'Escape') { event.preventDefault(); setRenamingId(null); }
                  }}
                  className="min-w-0 flex-1 rounded bg-tertiary px-1 text-sm text-primary outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => handleSelect(collection)}
                  className="min-w-0 flex-1 truncate text-left text-sm font-medium"
                  title={collection.name}
                >
                  {collection.name}
                  {collection.isDefault ? <span className="ml-1 text-xs text-tertiary">· default</span> : null}
                </button>
              )}
              {!collection.isDefault && !isRenaming ? (
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => handleStartRename(collection)}
                    className="rounded-sm p-0.5 text-tertiary hover:bg-quaternary hover:text-primary"
                    title="Rename"
                  >
                    <Pencil size={11} strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    onClick={() => { void handleDelete(collection); }}
                    className="rounded-sm p-0.5 text-tertiary hover:bg-quaternary hover:text-destructive"
                    title="Delete"
                  >
                    <Trash2 size={11} strokeWidth={1.75} />
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
        {showCreateOption ? (
          <button
            type="button"
            onClick={() => { void handleCreate(); }}
            className="flex h-7 items-center gap-1.5 rounded px-1.5 text-left text-sm text-secondary transition-colors hover:bg-tertiary/55 hover:text-primary"
          >
            <Plus size={12} strokeWidth={1.75} className="shrink-0 text-tertiary" />
            <span className="min-w-0 flex-1 truncate">
              Create &ldquo;<span className="text-primary">{query.trim()}</span>&rdquo;
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

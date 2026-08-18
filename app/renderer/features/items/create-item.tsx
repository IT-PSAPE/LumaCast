import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Id } from '@lumacast/kernel';
import type { ItemType, PlaylistRow } from '@lumacast/composition';
import { getPlaylistEntryItemRef } from '@lumacast/composition';
import { ReacstButton } from '@renderer/components/controls/button';
import { Dialog } from '../../components/overlays/dialog';
import { FieldSelect } from '../../components/form/field';
import { useCast } from '../../contexts/app-context';
import { useProjectContent } from '../../contexts/use-project-content';
import { useNavigation } from '../../contexts/navigation-context';
import { useLyricEditor } from './lyric-editor';

interface CreateItemContextValue {
  open: (type: ItemType) => void;
  close: () => void;
}

const CreateItemContext = createContext<CreateItemContextValue | null>(null);

export function useCreateItem(): CreateItemContextValue {
  const ctx = useContext(CreateItemContext);
  if (!ctx) throw new Error('useCreateItem must be used within CreateItemProvider');
  return ctx;
}

export function CreateItemProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; type: ItemType }>({
    open: false,
    type: 'presentation',
  });

  const open = useCallback((type: ItemType) => setState({ open: true, type }), []);
  const close = useCallback(() => setState((prev) => ({ ...prev, open: false })), []);

  const value = useMemo<CreateItemContextValue>(() => ({ open, close }), [open, close]);

  return (
    <CreateItemContext.Provider value={value}>
      {children}
      <CreateItemDialog isOpen={state.open} type={state.type} onClose={close} />
    </CreateItemContext.Provider>
  );
}

interface CreateItemDialogProps {
  isOpen: boolean;
  type: ItemType;
  onClose: () => void;
}

interface SelectOption {
  value: string;
  label: string;
}

// #219 item-model refactor decision D9: there is no group tier any more, so
// "where in the playlist" collapses to a position within that playlist's own
// flat row list — one option per existing row (insert before it) plus a
// trailing "end of playlist" option, built straight from the same rows the
// playlist panel renders.
function buildPositionOptions(rows: PlaylistRow[], resolveItemRef: ReturnType<typeof useProjectContent>['resolveItemRef']): SelectOption[] {
  const options = rows.map((row, index) => ({
    value: String(index),
    label: row.kind === 'separator'
      ? `Before separator "${row.label}"`
      : `Before "${resolveItemRef(getPlaylistEntryItemRef(row))?.title ?? 'item'}"`,
  }));
  options.push({ value: String(rows.length), label: 'At the end' });
  return options;
}

function CreateItemDialog({ isOpen, type, onClose }: CreateItemDialogProps) {
  const { snapshot } = useCast();
  const { presentationThemes, lyricThemes, talkThemes, resolveItemRef } = useProjectContent();
  const { createItem } = useNavigation();
  const { open: openLyricEditor } = useLyricEditor();

  const [name, setName] = useState('');
  const [themeId, setThemeId] = useState<string>('');
  const [playlistId, setPlaylistId] = useState<string>('');
  const [position, setPosition] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset form whenever the dialog reopens.
  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setThemeId('');
    setPlaylistId('');
    setPosition('');
    setBusy(false);
    // Focus after the Dialog content takes focus on mount.
    const handle = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(handle);
  }, [isOpen]);

  const compatibleThemes = type === 'presentation' ? presentationThemes : type === 'lyric' ? lyricThemes : talkThemes;

  const playlistOptions = useMemo(() => (snapshot?.playlists ?? []).map((playlist) => ({
    value: playlist.id,
    label: playlist.name,
  })), [snapshot]);

  const selectedPlaylistRows = useMemo(() => {
    if (!playlistId || !snapshot) return [];
    return snapshot.playlistEntries
      .filter((row) => row.playlistId === playlistId)
      .slice()
      .sort((left, right) => left.order - right.order);
  }, [playlistId, snapshot]);

  const positionOptions = useMemo(
    () => buildPositionOptions(selectedPlaylistRows, resolveItemRef),
    [selectedPlaylistRows, resolveItemRef],
  );

  function handlePlaylistChange(nextPlaylistId: string) {
    setPlaylistId(nextPlaylistId);
    setPosition('');
  }

  async function handleCreate({ thenOpenEditor = false }: { thenOpenEditor?: boolean } = {}) {
    if (busy) return;
    setBusy(true);
    try {
      await createItem({
        type,
        name,
        themeId: themeId ? (themeId as Id) : undefined,
        playlistId: playlistId ? (playlistId as Id) : undefined,
        position: playlistId && position ? Number(position) : undefined,
      });
      onClose();
      if (thenOpenEditor) openLyricEditor();
    } catch {
      setBusy(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void handleCreate();
    }
  }

  if (!isOpen) return null;

  const title = type === 'lyric' ? 'New lyric' : type === 'talk' ? 'New talk' : 'New presentation';
  const placeholder = type === 'lyric' ? 'New Lyric' : type === 'talk' ? 'New Talk' : 'New Presentation';

  return (
    <Dialog.Root open onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-ui-region="create-item-dialog" className="w-full max-w-md">
            <Dialog.Header>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.CloseButton />
            </Dialog.Header>
            <Dialog.Body className="flex flex-col gap-3 p-4">
              <label className="flex min-w-0 flex-col gap-0.5 text-sm text-secondary">
                <span className="truncate">Name</span>
                <input
                  ref={inputRef}
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={placeholder}
                  disabled={busy}
                  className="min-h-8 min-w-0 rounded bg-tertiary px-2 py-1 text-sm text-primary outline-none transition-colors focus:ring-1 focus:ring-brand"
                />
              </label>
              {compatibleThemes.length > 0 ? (
                <FieldSelect
                  label="Theme"
                  value={themeId}
                  onChange={setThemeId}
                  options={[
                    { value: '', label: 'No theme' },
                    ...compatibleThemes.map((theme) => ({ value: theme.id, label: theme.name })),
                  ]}
                />
              ) : null}
              {playlistOptions.length > 0 ? (
                <FieldSelect
                  label="Add to playlist"
                  value={playlistId}
                  onChange={handlePlaylistChange}
                  options={[
                    { value: '', label: "Don't add to a playlist" },
                    ...playlistOptions,
                  ]}
                />
              ) : null}
              {playlistId && positionOptions.length > 0 ? (
                <FieldSelect
                  label="Position"
                  value={position || String(selectedPlaylistRows.length)}
                  onChange={setPosition}
                  options={positionOptions}
                />
              ) : null}
            </Dialog.Body>
            <Dialog.Footer className={type === 'lyric' ? undefined : 'justify-end gap-2'}>
              <ReacstButton variant="ghost" onClick={onClose} disabled={busy}>Close</ReacstButton>
              {type === 'lyric' ? (
                <div className="flex items-center gap-2">
                  <ReacstButton variant="take" onClick={() => handleCreate()} disabled={busy}>
                    {busy ? 'Saving…' : 'Save'}
                  </ReacstButton>
                  <ReacstButton variant="take" onClick={() => handleCreate({ thenOpenEditor: true })} disabled={busy}>
                    {busy ? 'Saving…' : 'Save and edit'}
                  </ReacstButton>
                </div>
              ) : (
                <ReacstButton variant="take" onClick={() => handleCreate()} disabled={busy}>
                  {busy ? 'Creating…' : 'New'}
                </ReacstButton>
              )}
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

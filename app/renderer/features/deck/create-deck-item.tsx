import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Id } from '@core/types';
import { isThemeCompatibleWithDeckItem } from '@core/themes';
import { ReacstButton } from '@renderer/components/controls/button';
import { Dialog } from '../../components/overlays/dialog';
import { FieldSelect } from '../../components/form/field';
import { useThemeEditor } from '../../contexts/asset-editor/asset-editor-context';
import { useNavigation } from '../../contexts/navigation-context';
import { useLyricEditor } from './lyric-editor';

type DeckItemKind = 'presentation' | 'lyric';

interface CreateDeckItemContextValue {
  open: (kind: DeckItemKind) => void;
  close: () => void;
}

const CreateDeckItemContext = createContext<CreateDeckItemContextValue | null>(null);

export function useCreateDeckItem(): CreateDeckItemContextValue {
  const ctx = useContext(CreateDeckItemContext);
  if (!ctx) throw new Error('useCreateDeckItem must be used within CreateDeckItemProvider');
  return ctx;
}

export function CreateDeckItemProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; kind: DeckItemKind }>({
    open: false,
    kind: 'presentation',
  });

  const open = useCallback((kind: DeckItemKind) => setState({ open: true, kind }), []);
  const close = useCallback(() => setState((prev) => ({ ...prev, open: false })), []);

  const value = useMemo<CreateDeckItemContextValue>(() => ({ open, close }), [open, close]);

  return (
    <CreateDeckItemContext.Provider value={value}>
      {children}
      <CreateDeckItemDialog isOpen={state.open} kind={state.kind} onClose={close} />
    </CreateDeckItemContext.Provider>
  );
}

interface CreateDeckItemDialogProps {
  isOpen: boolean;
  kind: DeckItemKind;
  onClose: () => void;
}

function CreateDeckItemDialog({ isOpen, kind, onClose }: CreateDeckItemDialogProps) {
  const { themes } = useThemeEditor();
  const { currentLibraryBundle, createDeckItem } = useNavigation();
  const { open: openLyricEditor } = useLyricEditor();

  const [name, setName] = useState('');
  const [themeId, setThemeId] = useState<string>('');
  const [segmentId, setSegmentId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset form whenever the dialog reopens.
  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setThemeId('');
    setSegmentId('');
    setBusy(false);
    // Focus after the Dialog content takes focus on mount.
    const handle = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(handle);
  }, [isOpen]);

  const compatibleThemes = useMemo(
    () => themes.filter((theme) => isThemeCompatibleWithDeckItem(theme, kind)),
    [themes, kind],
  );

  const segmentOptions = useMemo(() => {
    if (!currentLibraryBundle) return [];
    return currentLibraryBundle.playlists.flatMap((tree) => (
      tree.segments.map((segment) => ({
        value: segment.segment.id,
        label: `${tree.playlist.name} › ${segment.segment.name}`,
      }))
    ));
  }, [currentLibraryBundle]);

  async function handleCreate({ thenOpenEditor = false }: { thenOpenEditor?: boolean } = {}) {
    if (busy) return;
    setBusy(true);
    try {
      await createDeckItem({
        kind,
        name,
        themeId: themeId ? (themeId as Id) : undefined,
        segmentId: segmentId ? (segmentId as Id) : undefined,
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

  const title = kind === 'lyric' ? 'New lyric' : 'New presentation';
  const placeholder = kind === 'lyric' ? 'New Lyric' : 'New Presentation';

  return (
    <Dialog.Root open onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-ui-region="create-deck-item-dialog" className="w-full max-w-md">
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
              {segmentOptions.length > 0 ? (
                <FieldSelect
                  label="Add to playlist"
                  value={segmentId}
                  onChange={setSegmentId}
                  options={[
                    { value: '', label: "Don't add to a playlist" },
                    ...segmentOptions,
                  ]}
                />
              ) : null}
            </Dialog.Body>
            <Dialog.Footer className={kind === 'lyric' ? undefined : 'justify-end gap-2'}>
              <ReacstButton variant="ghost" onClick={onClose} disabled={busy}>Close</ReacstButton>
              {kind === 'lyric' ? (
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

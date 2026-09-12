import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SlideTag, SlideTagColorKey } from '@lumacast/composition';
import { ReacstButton } from '@renderer/components/controls/button';
import { FieldInput } from '@renderer/components/form/field';
import { Dialog } from '@renderer/components/overlays/dialog';
import { useConfirm } from '@renderer/components/overlays/confirm-dialog';
import { useCast } from '@renderer/contexts/app-context';
import { LABEL_COLOR_OPTIONS } from '@renderer/utils/label-colors';
import { cn } from '@renderer/utils/cn';

interface EditorState {
  mode: 'create' | 'rename';
  tag: SlideTag | null;
}

interface SlideTagManagerValue {
  openCreate: () => void;
  openRename: (tag: SlideTag) => void;
  recolor: (tag: SlideTag, colorKey: SlideTagColorKey) => Promise<void>;
  remove: (tag: SlideTag) => Promise<void>;
}

const SlideTagManagerContext = createContext<SlideTagManagerValue | null>(null);

export function SlideTagManagerProvider({ children }: { children: ReactNode }) {
  const { mutatePatch, setStatusText } = useCast();
  const confirm = useConfirm();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [name, setName] = useState('');
  const [colorKey, setColorKey] = useState<SlideTagColorKey>('blue');
  const [busy, setBusy] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editor) return;
    setName(editor.tag?.name ?? '');
    setColorKey(editor.tag?.colorKey ?? 'blue');
    setBusy(false);
    const handle = setTimeout(() => nameInputRef.current?.focus(), 0);
    return () => clearTimeout(handle);
  }, [editor]);

  async function save() {
    const trimmedName = name.trim();
    if (!editor || !trimmedName || busy) return;
    setBusy(true);
    try {
      if (editor.mode === 'create') {
        await mutatePatch(() => window.castApi.createSlideTag({ name: trimmedName, colorKey }));
        setStatusText('Created slide tag');
      } else {
        const tag = editor.tag;
        if (!tag) return;
        await mutatePatch(() => window.castApi.updateSlideTag({ id: tag.id, name: trimmedName }));
        setStatusText('Renamed slide tag');
      }
      setEditor(null);
    } catch {
      setBusy(false);
    }
  }

  const value = useMemo<SlideTagManagerValue>(() => ({
    openCreate: () => setEditor({ mode: 'create', tag: null }),
    openRename: (tag) => setEditor({ mode: 'rename', tag }),
    recolor: async (tag, nextColorKey) => {
      await mutatePatch(() => window.castApi.updateSlideTag({ id: tag.id, colorKey: nextColorKey }));
      setStatusText('Updated slide tag color');
    },
    remove: async (tag) => {
      const ok = await confirm({
        title: `Delete “${tag.name}”?`,
        description: 'The tag will be removed from every slide that uses it.',
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!ok) return;
      await mutatePatch(() => window.castApi.deleteSlideTag(tag.id));
      setStatusText('Deleted slide tag');
    },
  }), [confirm, mutatePatch, setStatusText]);

  return (
    <SlideTagManagerContext.Provider value={value}>
      {children}
      {editor ? (
        <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) setEditor(null); }}>
          <Dialog.Portal>
            <Dialog.Backdrop />
            <Dialog.Positioner>
              <Dialog.Content className="max-w-sm">
                <Dialog.Header>
                  <Dialog.Title>{editor.mode === 'create' ? 'New slide tag' : 'Rename slide tag'}</Dialog.Title>
                  <Dialog.CloseButton disabled={busy} />
                </Dialog.Header>
                <Dialog.Body className="flex flex-col gap-4 p-4">
                  <FieldInput
                    label="Name"
                    value={name}
                    onChange={setName}
                    inputRef={nameInputRef}
                    disabled={busy}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      void save();
                    }}
                  />
                  {editor.mode === 'create' ? (
                    <fieldset className="grid grid-cols-8 gap-2">
                      <legend className="mb-2 text-sm text-secondary">Color</legend>
                      {LABEL_COLOR_OPTIONS.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          aria-label={option.label}
                          aria-pressed={colorKey === option.key}
                          disabled={busy}
                          className={cn(
                            'size-7 cursor-pointer rounded-full border-2 border-transparent outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-brand',
                            colorKey === option.key && 'ring-2 ring-brand ring-offset-2 ring-offset-primary',
                          )}
                          style={{ backgroundColor: option.swatch }}
                          onClick={() => setColorKey(option.key)}
                        />
                      ))}
                    </fieldset>
                  ) : null}
                </Dialog.Body>
                <Dialog.Footer className="justify-end gap-2">
                  <ReacstButton variant="ghost" disabled={busy} onClick={() => setEditor(null)}>Cancel</ReacstButton>
                  <ReacstButton variant="take" disabled={busy || !name.trim()} onClick={() => { void save(); }}>
                    {busy ? 'Saving…' : 'Save'}
                  </ReacstButton>
                </Dialog.Footer>
              </Dialog.Content>
            </Dialog.Positioner>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </SlideTagManagerContext.Provider>
  );
}

export function useSlideTagManager(): SlideTagManagerValue {
  const value = useContext(SlideTagManagerContext);
  if (!value) throw new Error('useSlideTagManager must be used within SlideTagManagerProvider');
  return value;
}

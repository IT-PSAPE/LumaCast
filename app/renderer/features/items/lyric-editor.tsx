import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { LyricEditorModal } from './lyric-editor-modal';

interface LyricEditorContextValue {
  open: () => void;
  close: () => void;
}

const LyricEditorContext = createContext<LyricEditorContextValue | null>(null);

export function useLyricEditor(): LyricEditorContextValue {
  const ctx = useContext(LyricEditorContext);
  if (!ctx) throw new Error('useLyricEditor must be used within LyricEditorProvider');
  return ctx;
}

// Owns the lyric-editor modal so it can be opened from anywhere in the app —
// both the deck-browser toolbar's "Open lyric editor" button and the
// create-item dialog's "Save and edit" button. The modal itself reads the
// current deck item from navigation context, so callers don't pass an id.
export function LyricEditorProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const value = useMemo<LyricEditorContextValue>(() => ({ open, close }), [open, close]);

  return (
    <LyricEditorContext.Provider value={value}>
      {children}
      <LyricEditorModal isOpen={isOpen} onClose={close} />
    </LyricEditorContext.Provider>
  );
}

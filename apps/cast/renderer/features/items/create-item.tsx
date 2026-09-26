import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ItemType } from '@lumacast/composition';
import { CreateItemDialog } from './create-item-dialog';

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

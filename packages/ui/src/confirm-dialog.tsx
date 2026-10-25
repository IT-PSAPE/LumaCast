import { createContext, useCallback, useContext, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { ReacstButton } from './button';
import { Modal } from './modal';

export interface ConfirmOptions {
  title: string;
  description?: string;
  /** Defaults to 'Confirm'. */
  confirmLabel?: string;
  /** Defaults to 'Cancel'. */
  cancelLabel?: string;
  /** `danger` styles the confirm action destructively. */
  tone?: 'default' | 'danger';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

const ConfirmContext = createContext<ConfirmFn | null>(null);

// Requests made while a confirm is open are queued (FIFO) and shown one at a
// time, so every caller's promise settles with its own answer.
export function ConfirmProvider({ children }: { children: ReactNode }): ReactElement {
  const [current, setCurrent] = useState<PendingConfirm | null>(null);
  const queue = useRef<PendingConfirm[]>([]);

  const confirm = useCallback<ConfirmFn>((options) => new Promise<boolean>((resolve) => {
    const entry: PendingConfirm = { options, resolve };
    setCurrent((active) => {
      if (active) {
        queue.current.push(entry);
        return active;
      }
      return entry;
    });
  }), []);

  function settle(confirmed: boolean) {
    if (!current) return;
    current.resolve(confirmed);
    setCurrent(queue.current.shift() ?? null);
  }

  const options = current?.options;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={current !== null}
        onClose={() => settle(false)}
        title={options?.title ?? ''}
        description={options?.description}
        size="sm"
        role="alertdialog"
        footer={
          <>
            <ReacstButton variant="ghost" onClick={() => settle(false)}>
              {options?.cancelLabel ?? 'Cancel'}
            </ReacstButton>
            <ReacstButton variant={options?.tone === 'danger' ? 'danger' : 'default'} onClick={() => settle(true)}>
              {options?.confirmLabel ?? 'Confirm'}
            </ReacstButton>
          </>
        }
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used within a ConfirmProvider');
  return confirm;
}

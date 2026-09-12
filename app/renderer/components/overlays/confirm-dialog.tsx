import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { ReacstButton } from '@renderer/components/controls/button';
import { cn } from '@renderer/utils/cn';
import { X } from 'lucide-react';
import { useOverlayContainer, useOverlayStackEntry } from './overlay-primitives';

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

// Both footer actions are real buttons, so the answer is reachable and visible
// by keyboard alone — the destructive one most of all.
const ACTION_FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // Used to ignore the dialog's onOpenChange(false) once we've already
  // resolved (clicking confirm/cancel) — prevents a double-resolve.
  const resolvedRef = useRef(false);
  const container = useOverlayContainer();

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      resolvedRef.current = false;
      setPending({ ...options, resolve });
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    if (!pending || resolvedRef.current) return;
    resolvedRef.current = true;
    pending.resolve(value);
    setPending(null);
  }, [pending]);

  const isOpen = pending !== null;
  const { isTopmost, zIndex } = useOverlayStackEntry(isOpen);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {/* An AlertDialog, not a Dialog: a question that must be answered never
          dismisses on an outside press, and its popup is announced as an alert. */}
      <AlertDialog.Root
        open={isOpen}
        onOpenChange={(nextOpen, details) => {
          if (nextOpen) return;
          // Escape belongs to whichever overlay is on top of the workbench
          // stack; a popover opened from inside the dialog gets it first.
          if (details.reason === 'escape-key' && !isTopmost) return details.cancel();
          settle(false);
        }}
      >
        <AlertDialog.Portal container={container} className="pointer-events-none fixed inset-0" style={{ zIndex }}>
          <AlertDialog.Backdrop className="pointer-events-auto fixed inset-0 bg-black/60 backdrop-blur-sm" />
          <AlertDialog.Viewport className="pointer-events-none fixed inset-0 flex items-center justify-center p-4">
            <AlertDialog.Popup
              aria-modal="true"
              data-shortcuts-scope="ignore"
              className="pointer-events-auto flex w-full max-w-md max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-lg border border-primary bg-primary shadow-2xl outline-none"
            >
              <div className="flex items-center justify-between gap-3 border-b border-primary px-4 py-3">
                <AlertDialog.Title className="m-0 text-lg font-semibold text-primary">
                  {pending?.title ?? ''}
                </AlertDialog.Title>
                <AlertDialog.Close
                  render={(
                    <ReacstButton.Icon label="Close" variant="ghost" className={cn('shrink-0', ACTION_FOCUS_RING)}>
                      <X/>
                    </ReacstButton.Icon>
                  )}
                />
              </div>
              {pending?.description ? (
                <div className="min-h-0 flex-1 px-4 py-3">
                  <AlertDialog.Description className="text-sm text-secondary">
                    {pending.description}
                  </AlertDialog.Description>
                </div>
              ) : null}
              <div className="flex items-center justify-end gap-2 border-t border-primary px-4 py-3">
                <ReacstButton variant="ghost" className={ACTION_FOCUS_RING} onClick={() => settle(false)}>
                  {pending?.cancelLabel ?? 'Cancel'}
                </ReacstButton>
                <ReacstButton
                  variant={pending?.destructive ? 'danger' : 'take'}
                  className={ACTION_FOCUS_RING}
                  onClick={() => settle(true)}
                >
                  {pending?.confirmLabel ?? 'Confirm'}
                </ReacstButton>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Viewport>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}

// Convenience wrapper for the common "delete X?" case.
export function useConfirmDelete() {
  const confirm = useConfirm();
  return useCallback(
    (target: string, description?: ReactNode) => confirm({
      title: `Delete ${target}?`,
      description: description ?? `This action cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    }),
    [confirm],
  );
}

// An imperative, promise-based confirm dialog: `confirmChoice` resolves once
// the user (or `import-flows.ts`, which is plain `.ts` and cannot render a
// modal itself) picks one of a small set of named choices, or `null` if they
// dismiss it. `ConfirmHost` (mounted once, in `App.tsx`) renders whichever
// request is pending.
import { create } from 'zustand';
import { Modal, ReacstButton, type ButtonVariant } from '@lumacast/ui';

export interface ConfirmChoice {
  value: string;
  label: string;
  variant?: ButtonVariant;
}

export interface ConfirmOptions {
  /** Cancels only this request, including when another prompt has replaced it. */
  signal?: AbortSignal;
}

interface PendingConfirm {
  title: string;
  message?: string;
  choices: ConfirmChoice[];
  resolve: (value: string | null) => void;
}

interface ConfirmStoreState {
  pending: PendingConfirm | null;
}

const useConfirmStore = create<ConfirmStoreState>(() => ({ pending: null }));

function settle(request: PendingConfirm, value: string | null): void {
  if (useConfirmStore.getState().pending !== request) return;
  useConfirmStore.setState({ pending: null });
  request.resolve(value);
}

/** Resolves with the chosen `value`, or `null` if the dialog is dismissed. */
export function confirmChoice(title: string, choices: ConfirmChoice[], message?: string, options: ConfirmOptions = {}): Promise<string | null> {
  return new Promise((resolve) => {
    if (options.signal?.aborted) { resolve(null); return; }
    let settled = false;
    const cancel = () => settle(request, null);
    const request: PendingConfirm = {
      title, message, choices,
      resolve: (value) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', cancel);
        resolve(value);
      },
    };
    const previous = useConfirmStore.getState().pending;
    options.signal?.addEventListener('abort', cancel, { once: true });
    useConfirmStore.setState({ pending: request });
    previous?.resolve(null);
  });
}

export function ConfirmHost() {
  const pending = useConfirmStore((state) => state.pending);

  if (!pending) return null;

  return (
    <Modal
      open
      onClose={() => settle(pending, null)}
      title={pending.title}
      description={pending.message}
      size="sm"
      footer={pending.choices.map((choice) => (
        <ReacstButton key={choice.value} variant={choice.variant ?? 'default'} onClick={() => settle(pending, choice.value)}>
          {choice.label}
        </ReacstButton>
      ))}
    />
  );
}

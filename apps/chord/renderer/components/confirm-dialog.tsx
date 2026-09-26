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

/** Resolves with the chosen `value`, or `null` if the dialog is dismissed. */
export function confirmChoice(title: string, choices: ConfirmChoice[], message?: string): Promise<string | null> {
  return new Promise((resolve) => {
    useConfirmStore.setState({ pending: { title, message, choices, resolve } });
  });
}

export function ConfirmHost() {
  const pending = useConfirmStore((state) => state.pending);

  function settle(value: string | null) {
    pending?.resolve(value);
    useConfirmStore.setState({ pending: null });
  }

  if (!pending) return null;

  return (
    <Modal open onClose={() => settle(null)} title={pending.title}>
      {pending.message ? <p className="paragraph-sm mb-4 text-secondary">{pending.message}</p> : null}
      <div className="flex justify-end gap-2">
        {pending.choices.map((choice) => (
          <ReacstButton key={choice.value} variant={choice.variant ?? 'default'} onClick={() => settle(choice.value)}>
            {choice.label}
          </ReacstButton>
        ))}
      </div>
    </Modal>
  );
}

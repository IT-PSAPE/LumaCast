import { useId, type ReactElement, type ReactNode } from 'react';
import { cn } from './cn';
import { cv } from './cv';

export type FieldLabelPlacement = 'top' | 'inline' | 'hidden';

export interface FieldProps {
  label?: string;
  labelPlacement?: FieldLabelPlacement;
  /** Id of the control the label names. Error and hint ids derive from it (see `useFieldIds`). */
  htmlFor?: string;
  /** When set: renders the message below the control and suppresses `hint`. */
  error?: string;
  /** Helper text, hidden while `error` is set. */
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export interface FieldIds {
  id: string;
  errorId: string;
  hintId: string;
  /** `errorId` when error, else `hintId` when hint, else undefined. */
  describedBy: string | undefined;
}

/**
 * Stable ids for a control and its Field. Pass the same `explicitId` to the
 * control (`id`) and to `Field` (`htmlFor`). The optional `state` says which
 * message is present so `describedBy` can be resolved; omit it and
 * `describedBy` is undefined.
 */
export function useFieldIds(explicitId?: string, state?: { error?: string; hint?: string }): FieldIds {
  const generated = useId();
  const id = explicitId ?? generated;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = state?.error ? errorId : state?.hint ? hintId : undefined;
  return { id, errorId, hintId, describedBy };
}

const rootVariants = cv({
  base: 'flex min-w-0',
  variants: {
    placement: {
      top: 'flex-col gap-1',
      inline: 'flex-col gap-1',
      hidden: 'flex-col gap-1',
    },
  },
  defaultVariants: { placement: 'top' },
});

const bodyVariants = cv({
  base: 'flex min-w-0',
  variants: {
    placement: {
      top: 'flex-col gap-1',
      inline: 'flex-row items-center gap-2',
      hidden: 'flex-col',
    },
  },
  defaultVariants: { placement: 'top' },
});

export function Field({ label, labelPlacement = 'top', htmlFor, error, hint, required, disabled, className, children }: FieldProps): ReactElement {
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;
  const showHint = Boolean(hint) && !error;

  return (
    <div data-disabled={disabled ? '' : undefined} data-invalid={error ? '' : undefined} className={cn(rootVariants({ placement: labelPlacement }), className)}>
      <div className={bodyVariants({ placement: labelPlacement })}>
        {label ? (
          <label
            htmlFor={htmlFor}
            className={cn(
              'label-xs text-secondary',
              labelPlacement === 'inline' && 'shrink-0',
              labelPlacement === 'hidden' && 'sr-only',
              disabled && 'opacity-50',
            )}
          >
            {label}
            {required ? (
              <span aria-hidden="true" className="ml-0.5 text-error">
                *
              </span>
            ) : null}
          </label>
        ) : null}
        <div className={cn('min-w-0', labelPlacement === 'inline' ? 'flex-1' : 'w-full')}>{children}</div>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="label-xs text-error">
          {error}
        </p>
      ) : showHint ? (
        <p id={hintId} className={cn('label-xs text-tertiary', disabled && 'opacity-50')}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

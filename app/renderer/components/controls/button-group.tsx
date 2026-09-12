import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@renderer/utils/cn';
import { cv } from '@renderer/utils/cv';

// Floating-pill button group used for in-context tool clusters (e.g. the
// add-text / add-shape / add-media toolbar that hovers above the canvas).
// Distinct from `IconGroup` which renders chunky, connected segments — this
// one keeps each button visually independent inside one rounded chrome.
//
// `Item` and `Icon` render as `<div>` by default. Set `native` to render an
// actual `<button>` — useful when you need form-element semantics (keyboard
// activation, `disabled`, submit/reset types). The default `<div>` form is
// handy when the cluster wraps non-button content (links, custom triggers).

const buttonGroupRootStyles = cv({
  base: 'flex items-center gap-0.5 rounded-lg border border-primary bg-tertiary/90 p-1 shadow-lg backdrop-blur-sm',
  variants: {
    fill: {
      true: 'w-full',
      false: 'w-fit',
    },
  },
  defaultVariants: {
    fill: false,
  },
});

const buttonGroupItemStyles = cv({
  base: 'flex cursor-pointer items-center justify-center rounded-sm bg-transparent text-secondary transition-colors hover:bg-tertiary hover:text-primary disabled:pointer-events-none disabled:opacity-50',
  variants: {
    active: {
      true: 'bg-tertiary text-primary',
      false: '',
    },
    size: {
      icon: 'p-1.5 [&>svg]:size-[18px]',
      label: 'px-2.5 py-1.5 text-sm',
    },
    disabled: {
      true: 'pointer-events-none opacity-50',
      false: '',
    },
  },
  defaultVariants: {
    active: false,
    size: 'label',
    disabled: false,
  },
});

interface ButtonGroupRootProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode;
  fill?: boolean;
  className?: string;
}

function Root({ children, className, fill, ...rest }: ButtonGroupRootProps) {
  return (
    <div {...rest} className={cn(buttonGroupRootStyles({ fill }), className)}>
      {children}
    </div>
  );
}

interface ButtonGroupItemProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  children: ReactNode;
  active?: boolean;
  /** Accessible label that doubles as the hover tooltip. */
  label?: string;
  /** Render an actual `<button>` instead of a `<div>`. Defaults to `<div>`. */
  native?: boolean;
  /** Forwarded to the underlying `<button>` when `native` is true. */
  type?: ButtonHTMLAttributes<HTMLButtonElement>['type'];
  /**
   * On the native `<button>`, applied via the `disabled` attribute. On the
   * default `<div>`, gates pointer events and dims via styling, and exposes
   * `data-disabled=""` so consumers can target it from CSS.
   */
  disabled?: boolean;
}

function renderItem(size: 'icon' | 'label', { children, className, active, label, native, type, disabled, ...rest }: ButtonGroupItemProps) {
  const styles = cn(buttonGroupItemStyles({ active, size, disabled }), className);

  if (native) {
    return (
      <button
        type={type ?? 'button'}
        aria-label={label}
        title={label}
        disabled={disabled}
        className={styles}
        {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {children}
      </button>
    );
  }

  return (
    <div
      aria-label={label}
      title={label}
      data-disabled={disabled ? '' : undefined}
      className={styles}
      {...(rest as HTMLAttributes<HTMLDivElement>)}
    >
      {children}
    </div>
  );
}

function Item(props: ButtonGroupItemProps) {
  return renderItem('label', props);
}

function Icon(props: ButtonGroupItemProps) {
  return renderItem('icon', props);
}

export const ReacstButtonGroup = {
  Root,
  Item,
  Icon,
};

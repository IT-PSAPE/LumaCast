import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { Toolbar } from '@base-ui/react/toolbar';
import { cn } from '@renderer/utils/cn';
import { cv } from '@renderer/utils/cv';

// Floating-pill button group used for in-context tool clusters (e.g. the
// add-text / add-shape / add-media toolbar that hovers above the canvas).
// Distinct from `IconGroup` which renders chunky, connected segments — this
// one keeps each button visually independent inside one rounded chrome.
//
// Backed by Base UI's Toolbar: the cluster's buttons are independent actions
// (not an exclusive/toggled selection), so Toolbar's roving-tabindex group is
// the right primitive — arrow keys move focus among the icons, Home/End jump
// to the ends, and disabled items stay focusable per Toolbar's convention.
//
// `Item` and `Icon` render as a `<div>` by default (via Toolbar.Button's
// `render` composition, so they still get roving focus). Set `native` to
// render an actual `<button>` — useful when you need form-element semantics
// (keyboard activation, `disabled`, submit/reset types). The default `<div>`
// form is handy when the cluster wraps non-button content (links, custom
// triggers).

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
  base: 'flex cursor-pointer items-center justify-center rounded-sm bg-transparent text-secondary transition-colors hover:bg-tertiary hover:text-primary data-disabled:pointer-events-none data-disabled:opacity-50',
  variants: {
    active: {
      true: 'bg-tertiary text-primary',
      false: '',
    },
    size: {
      icon: 'p-1.5 [&>svg]:size-[18px]',
      label: 'px-2.5 py-1.5 text-sm',
    },
  },
  defaultVariants: {
    active: false,
    size: 'label',
  },
});

interface ButtonGroupRootProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode;
  fill?: boolean;
  className?: string;
}

function Root({ children, className, fill, ...rest }: ButtonGroupRootProps) {
  return (
    <Toolbar.Root {...rest} className={cn(buttonGroupRootStyles({ fill }), className)}>
      {children}
    </Toolbar.Root>
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
   * Gates keyboard activation and dims via styling; Toolbar keeps the item
   * focusable (and exposes `data-disabled`) so keyboard users can still find
   * it while navigating the group.
   */
  disabled?: boolean;
}

function renderItem(size: 'icon' | 'label', { children, className, active, label, native, type, disabled, ...rest }: ButtonGroupItemProps) {
  const styles = cn(buttonGroupItemStyles({ active, size }), className);

  if (native) {
    return (
      <Toolbar.Button
        type={type ?? 'button'}
        aria-label={label}
        title={label}
        disabled={disabled}
        className={styles}
        {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {children}
      </Toolbar.Button>
    );
  }

  return (
    <Toolbar.Button
      render={<div />}
      nativeButton={false}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={styles}
      {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {children}
    </Toolbar.Button>
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

import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { createContext, useContext, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@renderer/utils/cn';
import { cv } from '@renderer/utils/cv';

type SelectionMode = 'single' | 'multiple';
type Value = string | string[];

const rootStyles = cv({
  base: 'flex items-center gap-px rounded-md bg-tertiary/40 p-0.5',
  variants: {
    fill: { true: 'w-full', false: 'w-fit' },
  },
  defaultVariants: { fill: false },
});

const itemStyles = cv({
  base: 'inline-flex items-center justify-center rounded-sm transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  variants: {
    active: {
      true: 'bg-primary text-primary',
      false: 'text-tertiary hover:text-secondary',
    },
    fill: { true: 'w-full', false: 'w-fit' },
    variant: {
      icon: 'p-1',
      label: 'px-3 py-1 label-xs',
    },
  },
  defaultVariants: { active: false, fill: false, variant: 'label' },
});

// The only bit of our own state Base UI's ToggleGroup/Toggle don't carry —
// pressed/group membership come straight from their own context.
const FillContext = createContext(false);

function normalizeToArray(value: Value | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : value ? [value] : [];
}

interface RootProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onChange'> {
  children: ReactNode;
  value?: Value;
  defaultValue?: Value;
  onValueChange?: (value: Value) => void;
  selectionMode?: SelectionMode;
  fill?: boolean;
  label?: string;
}

interface ItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick' | 'value'> {
  children: ReactNode;
  value: string;
  fill?: boolean;
  onClick?: () => void;
}

function Root({ children, value, defaultValue, onValueChange, selectionMode = 'single', fill = false, label, className, 'aria-label': ariaLabelProp, ...rest }: RootProps) {
  return (
    <FillContext.Provider value={fill}>
      <ToggleGroup
        {...rest}
        aria-label={ariaLabelProp ?? label}
        multiple={selectionMode === 'multiple'}
        value={normalizeToArray(value)}
        defaultValue={normalizeToArray(defaultValue)}
        onValueChange={(nextValues) => onValueChange?.(selectionMode === 'multiple' ? nextValues : (nextValues[0] ?? ''))}
        className={cn(rootStyles({ fill }), className)}
      >
        {children}
      </ToggleGroup>
    </FillContext.Provider>
  );
}

function Item({ children, value, fill, onClick, className, disabled, variant, ...rest }: ItemProps & { variant: 'icon' | 'label' }) {
  const contextFill = useContext(FillContext);

  return (
    <Toggle
      {...rest}
      value={value}
      disabled={disabled}
      onPressedChange={() => onClick?.()}
      className={(state) => cn(itemStyles({ active: state.pressed, fill: fill ?? contextFill, variant }), className)}
    >
      {children}
    </Toggle>
  );
}

function Label(props: ItemProps) {
  return <Item {...props} variant="label" />;
}

function Icon(props: ItemProps) {
  return <Item {...props} variant="icon" />;
}

export const SegmentedControl = Object.assign(Root, { Label, Icon });

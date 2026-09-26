import { cn } from './cn';

type ClassValue = string | string[] | null | false | undefined;
type VariantKey = string | boolean | number;
type VariantDefinitions = Record<string, Record<string, ClassValue>>;

type InferVariantProp<V extends Record<string, ClassValue>> =
  keyof V extends 'true' | 'false'
    ? boolean
    : keyof V extends `${number}`
      ? number | (keyof V & string)
      : keyof V extends string
        ? keyof V
        : never;

type VariantProps<V extends VariantDefinitions> = {
  [K in keyof V]?: InferVariantProp<V[K]>;
} & {
  className?: string;
};

type CompoundVariant<V extends VariantDefinitions> = {
  class?: ClassValue;
  className?: ClassValue;
} & {
  [K in keyof V]?: VariantKey | VariantKey[];
};

type VariantConfig<V extends VariantDefinitions> = {
  base?: ClassValue;
  variants?: V;
  defaultVariants?: { [K in keyof V]?: VariantKey };
  compoundVariants?: Array<CompoundVariant<V>>;
};

function normalizeClasses(value: ClassValue): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) as string[] : [value];
}

function resolveVariantKey(value: unknown): string | undefined {
  return value == null ? undefined : String(value);
}

function matchesCompoundCondition(expected: VariantKey | VariantKey[], actual: unknown): boolean {
  if (Array.isArray(expected)) {
    return expected.some((item) => String(item) === String(actual));
  }
  return String(expected) === String(actual);
}

export function cv<V extends VariantDefinitions>(config: VariantConfig<V>) {
  return (props: VariantProps<V> = {}): string => {
    const { className, ...selected } = props as VariantProps<V> & Record<string, unknown>;
    const variants = config.variants ?? ({} as V);
    const defaultVariants = config.defaultVariants ?? ({} as Partial<Record<keyof V, VariantKey>>);
    const classes = [...normalizeClasses(config.base)];
    const resolved = {} as Record<keyof V, VariantKey | undefined>;

    for (const variantName in variants) {
      if (!Object.prototype.hasOwnProperty.call(variants, variantName)) continue;
      const typedVariantName = variantName as keyof V;
      const variantValue = selected[variantName] ?? defaultVariants[typedVariantName];
      resolved[typedVariantName] = variantValue as VariantKey | undefined;

      const lookupKey = resolveVariantKey(variantValue);
      if (!lookupKey) continue;
      classes.push(...normalizeClasses(variants[typedVariantName]?.[lookupKey]));
    }

    for (const compoundVariant of config.compoundVariants ?? []) {
      const { class: compoundClass, className: compoundClassName, ...conditions } = compoundVariant;
      const matches = Object.entries(conditions).every(([variantName, expectedValue]) => {
        return matchesCompoundCondition(expectedValue as VariantKey | VariantKey[], resolved[variantName as keyof V]);
      });
      if (!matches) continue;
      classes.push(...normalizeClasses(compoundClass));
      classes.push(...normalizeClasses(compoundClassName));
    }

    classes.push(...normalizeClasses(className));
    return cn(...classes);
  };
}

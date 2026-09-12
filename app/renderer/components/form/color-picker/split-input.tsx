import { Field } from '@base-ui/react/field';
import { NumberField } from '@base-ui/react/number-field';

interface SplitInputProps {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  label: string;
}

export function SplitInput({ value, onChange, min, max, label }: SplitInputProps) {
  function handleValueChange(next: number | null) {
    if (next !== null) onChange(next);
  }

  return (
    <Field.Root className="flex min-w-0 flex-1">
      <Field.Label className="sr-only">{label}</Field.Label>
      <NumberField.Root value={value} min={min} max={max} onValueChange={handleValueChange} className="min-w-0 flex-1">
        <NumberField.Input className="w-full min-w-0 bg-transparent px-1 py-1 text-center text-sm text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
      </NumberField.Root>
    </Field.Root>
  );
}

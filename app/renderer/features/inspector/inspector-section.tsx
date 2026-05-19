import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Checkbox } from '@renderer/components/form/checkbox';

function Root({ children }: { children: ReactNode }) {
  return (
    <div className="border-b border-secondary">
      {children}
    </div>
  );
}

function Header({ children }: { children: ReactNode }) {
  return (
    <div className="h-10 px-2 flex items-center text-lg font-medium">
      {children}
    </div>
  );
}

function Body({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 py-3 flex flex-col gap-2">
      {children}
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-1">
      {children}
    </div>
  );
}

interface CheckboxProps {
  checked?: boolean;
  className?: string;
  onChange: (checked: boolean) => void;
}

function CheckboxControl({ checked, className, onChange }: CheckboxProps) {
  return (
    <Checkbox.Root checked={checked} onCheckedChange={onChange} className={className}>
      <Checkbox.Indicator className="size-4">
        {checked ? <Check size={14} strokeWidth={3} aria-hidden="true" />: null}
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
}
export const Section = { Root, Header, Body, Row, Checkbox: CheckboxControl };

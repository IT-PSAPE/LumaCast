export function FilterChips<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`rounded px-2 py-0.5 text-xs ${value === option.id ? 'bg-active text-primary' : 'text-secondary hover:bg-tertiary/40'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

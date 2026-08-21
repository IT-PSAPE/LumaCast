export function SplitInput({ value, onChange }: { value: number; onChange: (v: string) => void }) {
  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    onChange(event.target.value);
  }

  return (
    <input
      type="number"
      value={value}
      onChange={handleChange}
      className="w-full min-w-0 bg-transparent px-1 py-1 text-center text-sm text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    />
  );
}

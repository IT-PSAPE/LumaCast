import { useState } from 'react';

export function HexInput({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const display = value.startsWith('#') ? value.slice(1).toUpperCase() : value.toUpperCase();

  function handleFocus() {
    setDraft(display);
    setEditing(true);
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    setDraft(event.target.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase());
  }

  function handleBlur() {
    setEditing(false);
    if (draft.length >= 6) onChange(`#${draft.slice(0, 8)}`);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
  }

  return (
    <input
      type="text"
      value={editing ? draft : display}
      onFocus={handleFocus}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      maxLength={8}
      className="min-w-0 w-full bg-transparent py-1 pr-2 outline-none font-mono text-sm"
    />
  );
}

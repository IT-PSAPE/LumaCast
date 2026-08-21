import { useEffect, useState } from 'react';

export function MiniHexInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const display = value.startsWith('#') ? value.slice(1).toUpperCase() : value.toUpperCase();
  const [draft, setDraft] = useState(display);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(display);
  }, [display, editing]);

  function handleFocus() {
    setEditing(true);
    setDraft(display);
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    setDraft(event.target.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase());
  }

  function handleBlur() {
    setEditing(false);
    if (draft.length >= 6) onCommit(draft);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
  }

  return (
    <div className="flex min-w-0 flex-1 items-center bg-tertiary">
      <input
        type="text"
        value={editing ? draft : display}
        onFocus={handleFocus}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        maxLength={8}
        className="w-full min-w-0 bg-transparent px-1.5 py-1 text-center font-mono text-sm text-primary outline-none"
      />
    </div>
  );
}

import { useCallback, useState } from 'react';

export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  parse: (raw: string) => T | null,
  serialize: (value: T) => string = String as (value: T) => string,
): [T, (value: T) => void] {
  const [value, setValueRaw] = useState<T>(() => {
    const stored = window.localStorage.getItem(key);
    if (stored === null) return defaultValue;
    return parse(stored) ?? defaultValue;
  });

  const setValue = useCallback((next: T) => {
    setValueRaw(next);
    window.localStorage.setItem(key, serialize(next));
  }, [key, serialize]);

  return [value, setValue];
}

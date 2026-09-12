const SIZE_CLASS_NAMES = {
  16: 'bg-[length:16px_16px]',
  24: 'bg-[length:24px_24px]',
} as const;

export function CheckerboardBackdrop({ size = 24 }: { size?: keyof typeof SIZE_CLASS_NAMES }) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 bg-[repeating-conic-gradient(var(--background-color-secondary)_0%_25%,var(--background-color-tertiary)_0%_50%)] ${SIZE_CLASS_NAMES[size]}`}
    />
  );
}

import type { ThemeOwnerType } from '@lumacast/composition';
import { Plus } from 'lucide-react';

export function CreateThemeDropZone({ themeType, onActivate }: { themeType: ThemeOwnerType; onActivate: () => void }) {
  const label = `Create ${themeType} theme`;
  return (
    <button
      type="button"
      onClick={onActivate}
      aria-label={label}
      className="flex w-full items-center justify-center gap-1.5 rounded-xs border border-dashed border-tertiary/70 px-2 py-2.5 text-tertiary transition-colors hover:border-secondary hover:text-secondary focus-visible:ring-2 focus-visible:ring-brand"
    >
      <Plus size={14} strokeWidth={1.75} />
      <span className="text-xs">{label}</span>
    </button>
  );
}

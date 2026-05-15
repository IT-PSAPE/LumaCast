import type { Id } from '@core/types';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { useAutomation } from './automation-context';
import { MACRO_ICON, getCueIcon } from './cue-icons';

export function SlideBindingsBadge({ slideId }: { slideId: Id }) {
  const {
    state: { cues, macros },
    actions: { getBindingsForSource },
  } = useAutomation();
  const { mediaAssets } = useProjectContent();

  const bindings = getBindingsForSource('slide.activate', slideId);
  if (bindings.length === 0) return null;

  const cueById = new Map(cues.map((cue) => [cue.id, cue]));
  const macroIds = new Set(macros.map((macro) => macro.id));

  return (
    <span className="inline-flex items-center gap-1.5 rounded-[2px] bg-primary p-1 shadow-sm">
      {bindings.map((binding) => {
        if (binding.targetType === 'macro') {
          if (!macroIds.has(binding.targetId)) return null;
          const Icon = MACRO_ICON;
          return <Icon key={binding.id} size={16} strokeWidth={1.9} className="text-secondary" />;
        }
        const cue = cueById.get(binding.targetId);
        if (!cue) return null;
        const Icon = getCueIcon(cue, mediaAssets);
        return <Icon key={binding.id} size={16} strokeWidth={1.9} className="text-secondary" />;
      })}
    </span>
  );
}

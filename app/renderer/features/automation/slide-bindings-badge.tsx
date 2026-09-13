import type { Id } from '@lumacast/kernel';
import type { MediaAsset } from '@lumacast/composition';
import type { Cue, TriggerBinding } from '@lumacast/automation';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { useAutomation } from './automation-context';
import { CueIcon, MacroIcon } from './cue-icons';

export function SlideBindingsBadge({ slideId }: { slideId: Id }) {
  const {
    state: { cues, macros },
    actions: { getBindingsForSourceTriggers },
  } = useAutomation();
  const { mediaAssets } = useProjectContent();

  const bindings = getBindingsForSourceTriggers(['slide.activate', 'slide.take'], slideId);
  if (bindings.length === 0) return null;

  const cueById = new Map(cues.map((cue) => [cue.id, cue]));
  const macroIds = new Set(macros.map((macro) => macro.id));

  return (
    <span className="inline-flex items-center gap-1.5 rounded-[2px] bg-primary p-1 shadow-sm">
      {bindings.map((binding) => (
        <SlideBindingBadgeIcon
          key={binding.id}
          binding={binding}
          cue={cueById.get(binding.targetId)}
          macroExists={macroIds.has(binding.targetId)}
          mediaAssets={mediaAssets}
        />
      ))}
    </span>
  );
}

function SlideBindingBadgeIcon({ binding, cue, macroExists, mediaAssets }: {
  binding: TriggerBinding;
  cue: Cue | undefined;
  macroExists: boolean;
  mediaAssets: Pick<MediaAsset, 'id' | 'type'>[];
}) {
  if (binding.targetType === 'macro') {
    return macroExists ? <MacroIcon size={16} strokeWidth={1.9} className="text-secondary" /> : null;
  }
  if (!cue) return null;
  return <CueIcon cue={cue} mediaAssets={mediaAssets} size={16} strokeWidth={1.9} className="text-secondary" />;
}

import { X } from 'lucide-react';
import { EmptyState } from '@renderer/components/display/empty-state';
import { Label } from '@renderer/components/display/text';
import { Section } from '@renderer/features/inspector/inspector-section';
import { useSlides } from '@renderer/contexts/slide-context';
import { useAutomation } from '@renderer/features/automation/automation-context';
import { useMacroEditorScreen } from './screen-context';

export function TriggersInspector() {
  const { state: { currentMacro } } = useMacroEditorScreen();
  const { actions: { getBindingsForMacro, deleteBinding } } = useAutomation();
  const slidesContext = useSlides();
  if (!currentMacro) return null;
  const triggerBindings = getBindingsForMacro(currentMacro.id);

  if (triggerBindings.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState.Root>
          <EmptyState.Title>No triggers attached</EmptyState.Title>
          <EmptyState.Description>Right-click a slide and choose Automation → Macros to bind this macro to a slide, or right-click the macro in the bin and toggle Run on startup.</EmptyState.Description>
        </EmptyState.Root>
      </div>
    );
  }

  return (
    <Section.Root>
      <Section.Header><Label.xs>Triggered by</Label.xs></Section.Header>
      <Section.Body>
        {triggerBindings.map((binding) => {
          let label: string;
          let triggerLabel: string;
          if (binding.triggerType === 'app.startup') {
            label = 'App';
            triggerLabel = 'on Startup';
          } else {
            const sourceSlide = binding.sourceId ? slidesContext.slides.find((slide) => slide.id === binding.sourceId) ?? null : null;
            label = sourceSlide ? `Slide ${slidesContext.slides.indexOf(sourceSlide) + 1}` : 'Slide';
            triggerLabel = binding.triggerType === 'slide.take' ? 'on Take' : 'on Activate';
          }
          return (
            <div key={binding.id} className="flex items-center justify-between gap-2 rounded border border-primary bg-secondary/40 px-2 py-1.5 text-sm text-primary">
              <div className="min-w-0">
                <div className="truncate font-medium">{label}</div>
                <div className="text-xs text-tertiary">{triggerLabel}</div>
              </div>
              <button
                type="button"
                aria-label="Remove trigger"
                onClick={() => { void deleteBinding(binding.id); }}
                className="shrink-0 rounded p-1 text-tertiary hover:bg-tertiary hover:text-primary"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </Section.Body>
    </Section.Root>
  );
}

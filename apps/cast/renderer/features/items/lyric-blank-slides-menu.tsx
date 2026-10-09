import { Check } from 'lucide-react';
import type { Id } from '@lumacast/kernel';
import type { LyricBlankSlideMode } from '@lumacast/composition';
import { Dropdown } from '../../components/form/dropdown';
import { FieldSelect } from '../../components/form/field';
import { ContextMenu } from '../../components/overlays/context-menu';
import { useCast } from '../../contexts/app-context';

const BLANK_SLIDE_OPTIONS: Array<{ value: LyricBlankSlideMode; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'start', label: 'At beginning' },
  { value: 'end', label: 'At end' },
  { value: 'both', label: 'Beginning and end' },
];

export function LyricBlankSlidesField({ value, onChange }: {
  value: LyricBlankSlideMode;
  onChange: (mode: LyricBlankSlideMode) => void;
}) {
  return <FieldSelect label="Blank slides" value={value} onChange={(mode) => onChange(mode as LyricBlankSlideMode)} options={BLANK_SLIDE_OPTIONS} />;
}

export function LyricBlankSlidesMenu({ mode, onChange, surface = 'context' }: {
  mode: LyricBlankSlideMode;
  onChange: (mode: LyricBlankSlideMode) => void;
  surface?: 'context' | 'dropdown';
}) {
  const Submenu = surface === 'dropdown' ? Dropdown.Submenu : ContextMenu.Submenu;
  return (
    <Submenu label="Blank slides">
      {BLANK_SLIDE_OPTIONS.map((option) => {
        const label = <>
          <Check aria-hidden className={`size-3.5 shrink-0 ${mode === option.value ? '' : 'invisible'}`} />
          {option.label}
          {mode === option.value ? <>{' '}<span className="sr-only">Selected</span></> : null}
        </>;
        return surface === 'dropdown'
          ? <Dropdown.Item key={option.value} onClick={() => onChange(option.value)}>{label}</Dropdown.Item>
          : <ContextMenu.Item key={option.value} onSelect={() => onChange(option.value)}>{label}</ContextMenu.Item>;
      })}
    </Submenu>
  );
}

// Item menus target their own lyric, independently of the current selection.
export function LyricItemBlankSlidesMenu({ lyricId }: { lyricId: Id }) {
  const { snapshot, mutatePatch, runOperation, setStatusText } = useCast();
  const mode = snapshot?.lyrics.find((lyric) => lyric.id === lyricId)?.blankSlideMode ?? 'none';

  async function updateMode(nextMode: LyricBlankSlideMode) {
    try {
      await runOperation('Updating blank slides...', async () => {
        await mutatePatch(() => window.castApi.setLyricBlankSlides({ lyricId, mode: nextMode }));
        setStatusText('Updated blank slides');
      });
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Failed to update blank slides.');
    }
  }

  return <LyricBlankSlidesMenu mode={mode} onChange={(nextMode) => { void updateMode(nextMode); }} />;
}

import type { Id } from '@lumacast/kernel';
import type { SlideTagColorKey } from '@lumacast/composition';
import { ContextMenu } from '@renderer/components/overlays/context-menu';
import { useCast } from '@renderer/contexts/app-context';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { LABEL_COLOR_OPTIONS } from '@renderer/utils/label-colors';
import { useSlideTagManager } from './slide-tag-manager';

export function SlideTagMenu({ slideIds }: { slideIds: Id[] }) {
  const { mutatePatch, setStatusText } = useCast();
  const { slideTags } = useProjectContent();
  const manager = useSlideTagManager();

  async function assign(tagId: Id | null) {
    await mutatePatch(() => window.castApi.assignSlideTags({ slideIds, tagId }));
    setStatusText(tagId ? `Tagged ${slideIds.length === 1 ? 'slide' : `${slideIds.length} slides`}` : 'Cleared slide tag');
  }

  return (
    <ContextMenu.Submenu label="Tag">
      {slideTags.map((tag) => (
        <ContextMenu.Item key={tag.id} onSelect={() => { void assign(tag.id); }}>
          <span className="mr-2 inline-block size-2.5 rounded-full" style={{ backgroundColor: LABEL_COLOR_OPTIONS.find((option) => option.key === tag.colorKey)?.swatch }} />
          {tag.name}
        </ContextMenu.Item>
      ))}
      {slideTags.length > 0 ? (
        <ContextMenu.Item onSelect={() => { void assign(null); }}>None</ContextMenu.Item>
      ) : null}
      <ContextMenu.Separator />
      <ContextMenu.Item onSelect={manager.openCreate}>Add tag…</ContextMenu.Item>
      <ContextMenu.Submenu label="Manage tags" disabled={slideTags.length === 0}>
        {slideTags.map((tag) => (
          <ContextMenu.Submenu key={tag.id} label={tag.name}>
            <ContextMenu.Item onSelect={() => manager.openRename(tag)}>Rename…</ContextMenu.Item>
            <ContextMenu.Submenu label="Color">
              {LABEL_COLOR_OPTIONS.map((option) => (
                <ContextMenu.Item
                  key={option.key}
                  onSelect={() => { void manager.recolor(tag, option.key as SlideTagColorKey); }}
                >
                  <span className="mr-2 inline-block size-2.5 rounded-full" style={{ backgroundColor: option.swatch }} />
                  {option.label}
                </ContextMenu.Item>
              ))}
            </ContextMenu.Submenu>
            <ContextMenu.Separator />
            <ContextMenu.Item variant="destructive" onSelect={() => { void manager.remove(tag); }}>Delete</ContextMenu.Item>
          </ContextMenu.Submenu>
        ))}
      </ContextMenu.Submenu>
    </ContextMenu.Submenu>
  );
}

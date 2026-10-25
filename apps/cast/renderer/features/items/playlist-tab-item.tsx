import { useNavigation } from '../../contexts/navigation-context';
import { useSlides } from '../../contexts/slide-context';
import type { PlaylistDeckSequenceItem } from './use-playlist-deck-sequence';
import { Tabs } from '@lumacast/ui';

export function PlaylistTabItem({ items }: { items: PlaylistDeckSequenceItem[] }) {
  const { currentPlaylistEntryId } = useNavigation();
  const { selectPlaylistEntry } = useSlides();

  function getLabel(item: PlaylistDeckSequenceItem) {
    const duplicateSuffix = item.occurrenceIndex > 1 ? ` (${item.occurrenceIndex})` : '';
    return `${item.item.title}${duplicateSuffix}`;
  }

  return (
    <Tabs value={currentPlaylistEntryId ?? ''} variant="plain" className="contents" onValueChange={selectPlaylistEntry}>
      <Tabs.List aria-label="Playlist items" className="min-w-0 overflow-x-auto [&>*]:shrink-0">
        {items.map((item) => <Tabs.Tab key={item.entryId} value={item.entryId}>{getLabel(item)}</Tabs.Tab>)}
      </Tabs.List>
    </Tabs>
  );
}

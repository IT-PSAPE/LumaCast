import { Folder, Layers2, LayoutTemplate, ListMusic, Monitor, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Id, Library, LibraryPlaylistBundle, MediaAsset, Overlay, Playlist, Stage, Theme } from '@core/types';
import { Dialog } from '@renderer/components/overlays/dialog';
import { DeckItemIcon, MediaAssetIcon } from '@renderer/components/display/entity-icon';
import { useCast } from '@renderer/contexts/app-context';
import { useNavigation } from '@renderer/contexts/navigation-context';
import { useWorkbench } from '@renderer/contexts/workbench-context';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { useAudio, usePresentationMediaLayer, useVideo } from '@renderer/contexts/playback/playback-context';
import {
  useOverlayEditor,
  useStageEditor,
  useThemeEditor,
} from '@renderer/contexts/asset-editor/asset-editor-context';
import { cn } from '@renderer/utils/cn';
import { useCommandPalette } from './command-palette-context';

type ResultKind =
  | 'library'
  | 'playlist'
  | 'deckItem'
  | 'overlay'
  | 'theme'
  | 'stage'
  | 'media'
  | 'audio';

interface ResultItem {
  id: string;
  kind: ResultKind;
  label: string;
  subtitle?: string;
  icon: ReactNode;
  onSelect: () => void;
}

const SECTION_ORDER: Array<{ kind: ResultKind; title: string }> = [
  { kind: 'library', title: 'Libraries' },
  { kind: 'playlist', title: 'Playlists' },
  { kind: 'deckItem', title: 'Deck items' },
  { kind: 'overlay', title: 'Overlays' },
  { kind: 'theme', title: 'Themes' },
  { kind: 'stage', title: 'Stages' },
  { kind: 'media', title: 'Media' },
  { kind: 'audio', title: 'Audio' },
];

const SECTION_BY_KIND = new Map(SECTION_ORDER.map((entry, index) => [entry.kind, { ...entry, order: index }]));

const RESULT_LIMIT = 50;

export function CommandPalette() {
  const { isOpen, close } = useCommandPalette();
  const { snapshot } = useCast();
  const { deckItems, mediaAssets } = useProjectContent();
  const navigation = useNavigation();
  const { actions: workbenchActions } = useWorkbench();
  const overlayEditor = useOverlayEditor();
  const themeEditor = useThemeEditor();
  const stageEditor = useStageEditor();
  const { setMediaLayerAsset } = usePresentationMediaLayer();
  const video = useVideo();
  const audio = useAudio();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setActiveIndex(0);
      return;
    }
    queueMicrotask(() => {
      inputRef.current?.focus();
    });
  }, [isOpen]);

  const results = useMemo<ResultItem[]>(() => {
    if (!snapshot) return [];

    const libraryById = new Map<Id, Library>(snapshot.libraries.map((library) => [library.id, library]));

    const libraryItems: ResultItem[] = snapshot.libraries.map((library) => ({
      id: `library:${library.id}`,
      kind: 'library',
      label: library.name,
      subtitle: 'Library',
      icon: <Folder size={16} />,
      onSelect: () => {
        navigation.selectLibrary(library.id);
        workbenchActions.setWorkbenchMode('show');
      },
    }));

    const playlistItems: ResultItem[] = flattenPlaylists(snapshot.libraryBundles, libraryById).map(({ playlist, library }) => ({
      id: `playlist:${playlist.id}`,
      kind: 'playlist',
      label: playlist.name,
      subtitle: `Playlist · ${library.name}`,
      icon: <ListMusic size={16} />,
      onSelect: () => {
        navigation.selectLibrary(library.id);
        navigation.setCurrentPlaylistId(playlist.id);
        workbenchActions.setWorkbenchMode('show');
      },
    }));

    const deckItemResults: ResultItem[] = deckItems.map((item) => ({
      id: `deckItem:${item.id}`,
      kind: 'deckItem',
      label: item.title,
      subtitle: item.type === 'lyric' ? 'Lyric' : 'Presentation',
      icon: <DeckItemIcon entity={item} size={16} />,
      onSelect: () => {
        navigation.browseDeckItem(item.id);
        workbenchActions.setWorkbenchMode('deck-editor');
      },
    }));

    const overlayResults: ResultItem[] = overlayEditor.overlays.map((overlay: Overlay) => ({
      id: `overlay:${overlay.id}`,
      kind: 'overlay',
      label: overlay.name,
      subtitle: 'Overlay',
      icon: <Layers2 size={16} />,
      onSelect: () => {
        overlayEditor.setCurrentOverlayId(overlay.id);
        workbenchActions.setWorkbenchMode('overlay-editor');
      },
    }));

    const themeResults: ResultItem[] = themeEditor.themes.map((theme: Theme) => ({
      id: `theme:${theme.id}`,
      kind: 'theme',
      label: theme.name,
      subtitle: `Theme · ${theme.kind}`,
      icon: <LayoutTemplate size={16} />,
      onSelect: () => {
        themeEditor.openThemeEditor(theme.id);
        workbenchActions.setWorkbenchMode('theme-editor');
      },
    }));

    const stageResults: ResultItem[] = stageEditor.stages.map((stage: Stage) => ({
      id: `stage:${stage.id}`,
      kind: 'stage',
      label: stage.name,
      subtitle: 'Stage layout',
      icon: <Monitor size={16} />,
      onSelect: () => {
        stageEditor.setCurrentStageId(stage.id);
        workbenchActions.setWorkbenchMode('stage-editor');
      },
    }));

    const mediaResults: ResultItem[] = mediaAssets
      .filter((asset: MediaAsset) => asset.type !== 'audio')
      .map((asset) => ({
        id: `media:${asset.id}`,
        kind: 'media',
        label: asset.name,
        subtitle: `Media · ${asset.type}`,
        icon: <MediaAssetIcon asset={asset} size={16} />,
        onSelect: () => {
          // Behaves like clicking the asset in its bin: arms the relevant
          // layer. Image assets live in the resource drawer; video assets
          // should arm the video transport and begin playback immediately.
          if (asset.type === 'video') {
            video.armVideo(asset.id);
            return;
          }
          workbenchActions.setDrawerTab('image');
          setMediaLayerAsset(asset.id);
        },
      }));

    const audioResults: ResultItem[] = mediaAssets
      .filter((asset: MediaAsset) => asset.type === 'audio')
      .map((asset) => ({
        id: `audio:${asset.id}`,
        kind: 'audio',
        label: asset.name,
        subtitle: 'Audio',
        icon: <MediaAssetIcon asset={asset} size={16} />,
        onSelect: () => {
          // Same behavior as clicking an audio row in the audio bin: arm it
          // for playback. Don't switch screens — the user is presenting.
          audio.armAudio(asset.id);
        },
      }));

    const all: ResultItem[] = [
      ...libraryItems,
      ...playlistItems,
      ...deckItemResults,
      ...overlayResults,
      ...themeResults,
      ...stageResults,
      ...mediaResults,
      ...audioResults,
    ];

    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return all.slice(0, RESULT_LIMIT);
    }

    return all
      .map((item) => ({ item, score: scoreMatch(item, trimmed) }))
      .filter((scored) => scored.score > 0)
      .sort((left, right) => right.score - left.score || left.item.label.localeCompare(right.item.label))
      .map(({ item }) => item)
      .slice(0, RESULT_LIMIT);
  }, [snapshot, deckItems, mediaAssets, overlayEditor, themeEditor, stageEditor, audio, setMediaLayerAsset, video, query, navigation, workbenchActions]);

  const sectionedResults = useMemo(() => groupBySection(results), [results]);

  useEffect(() => {
    if (activeIndex >= results.length) setActiveIndex(0);
  }, [results, activeIndex]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => (results.length === 0 ? 0 : (prev + 1) % results.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => (results.length === 0 ? 0 : (prev - 1 + results.length) % results.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = results[activeIndex];
      if (!target) return;
      target.onSelect();
      close();
    }
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={(next) => { if (!next) close(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner className="items-start pt-[15vh]">
          <Dialog.Content className="w-full max-w-xl">
            <div className="flex items-center gap-2 border-b border-primary px-4 py-3">
              <Search size={16} className="text-secondary shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
                onKeyDown={handleKeyDown}
                placeholder="Search libraries, playlists, decks, overlays, themes, stages, media…"
                className="w-full bg-transparent text-sm text-primary placeholder:text-tertiary outline-none"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <Dialog.Body className="overflow-y-auto px-1 py-1 max-h-[50vh]">
              {results.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-secondary">
                  {snapshot ? 'No matches' : 'Loading…'}
                </div>
              ) : (
                <div role="listbox" className="flex flex-col">
                  {sectionedResults.map(({ kind, title, items }) => (
                    <section key={kind} className="flex flex-col">
                      <h3 className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-tertiary">
                        {title}
                      </h3>
                      <ul className="flex flex-col">
                        {items.map((item) => {
                          const flatIndex = results.indexOf(item);
                          const isActive = flatIndex === activeIndex;
                          return (
                            <li key={item.id}>
                              <button
                                type="button"
                                role="option"
                                aria-selected={isActive}
                                onMouseEnter={() => setActiveIndex(flatIndex)}
                                onClick={() => { item.onSelect(); close(); }}
                                className={cn(
                                  'w-full flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm',
                                  isActive ? 'bg-secondary text-primary' : 'text-primary',
                                )}
                              >
                                <span className="text-secondary shrink-0">{item.icon}</span>
                                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                {item.subtitle && (
                                  <span className="text-xs text-tertiary shrink-0">{item.subtitle}</span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function flattenPlaylists(bundles: LibraryPlaylistBundle[], libraryById: Map<Id, Library>): Array<{ playlist: Playlist; library: Library }> {
  const out: Array<{ playlist: Playlist; library: Library }> = [];
  for (const bundle of bundles) {
    for (const tree of bundle.playlists) {
      const library = libraryById.get(tree.playlist.libraryId);
      if (!library) continue;
      out.push({ playlist: tree.playlist, library });
    }
  }
  return out;
}

function groupBySection(items: ResultItem[]): Array<{ kind: ResultKind; title: string; items: ResultItem[] }> {
  const groups = new Map<ResultKind, ResultItem[]>();
  for (const item of items) {
    const list = groups.get(item.kind) ?? [];
    list.push(item);
    groups.set(item.kind, list);
  }
  return [...groups.entries()]
    .map(([kind, sectionItems]) => {
      const meta = SECTION_BY_KIND.get(kind);
      return { kind, title: meta?.title ?? kind, order: meta?.order ?? Number.MAX_SAFE_INTEGER, items: sectionItems };
    })
    .sort((left, right) => left.order - right.order);
}

function scoreMatch(item: ResultItem, query: string): number {
  const haystack = `${item.label} ${item.subtitle ?? ''}`.toLowerCase();
  const labelLower = item.label.toLowerCase();
  if (labelLower === query) return 1000;
  if (labelLower.startsWith(query)) return 500;
  if (labelLower.includes(query)) return 100;
  if (haystack.includes(query)) return 10;
  return 0;
}

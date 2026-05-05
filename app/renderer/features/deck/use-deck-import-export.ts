import { useEffect, useMemo, useState } from 'react';
import type {
  DeckBundleBrokenReferenceAction,
  DeckBundleBrokenReferenceDecision,
  DeckBundleExportOptions,
  DeckBundleInspection,
  DeckItem,
  Id,
  Playlist,
} from '@core/types';
import { useCast } from '../../contexts/app-context';
import { useProjectContent } from '../../contexts/use-project-content';

interface ImportDecisionState {
  action: DeckBundleBrokenReferenceAction;
  replacementPath: string | null;
}

interface ExtraIncludeFlags {
  includeAllThemes: boolean;
  includeOverlays: boolean;
  includeStages: boolean;
}

interface ImportExportSettingsState {
  deckItems: DeckItem[];
  filterText: string;
  selectedItemIds: Set<Id>;
  selectedPlaylistIds: Set<Id>;
  selectedCount: number;
  exportInFlight: boolean;
  importInFlight: boolean;
  importPath: string | null;
  inspection: DeckBundleInspection | null;
  decisionMap: ReadonlyMap<string, ImportDecisionState>;
  blockedImportReasons: string[];
  message: string | null;
  extras: ExtraIncludeFlags;
}

interface ImportExportSettingsActions {
  setFilterText: (value: string) => void;
  toggleItemId: (id: Id) => void;
  togglePlaylistId: (id: Id) => void;
  clearSelection: () => void;
  setExtraFlag: (flag: keyof ExtraIncludeFlags, value: boolean) => void;
  exportSelected: () => Promise<void>;
  exportPlaylist: (playlist: Playlist) => Promise<void>;
  exportDeckItem: (item: DeckItem) => Promise<void>;
  exportWorkspace: () => Promise<void>;
  chooseImportBundle: () => Promise<void>;
  clearImportReview: () => void;
  setBrokenReferenceAction: (source: string, action: DeckBundleBrokenReferenceAction) => void;
  chooseReplacementPath: (source: string) => Promise<void>;
  finalizeImport: () => Promise<void>;
}

export function useDeckImportExport(): { state: ImportExportSettingsState; actions: ImportExportSettingsActions } {
  const { deckItems } = useProjectContent();
  const { snapshot, mutate, setStatusText } = useCast();
  const [filterText, setFilterText] = useState('');
  const [selectedItemIds, setSelectedItemIds] = useState<Set<Id>>(new Set());
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<Set<Id>>(new Set());
  const [exportInFlight, setExportInFlight] = useState(false);
  const [importInFlight, setImportInFlight] = useState(false);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [inspection, setInspection] = useState<DeckBundleInspection | null>(null);
  const [decisionMap, setDecisionMap] = useState<Map<string, ImportDecisionState>>(new Map());
  const [message, setMessage] = useState<string | null>(null);
  const [extras, setExtras] = useState<ExtraIncludeFlags>({
    includeAllThemes: false,
    includeOverlays: false,
    includeStages: false,
  });

  function buildExportOptions(playlistIds: Id[] = []): DeckBundleExportOptions {
    return {
      includeAllThemes: extras.includeAllThemes,
      includeOverlays: extras.includeOverlays,
      includeStages: extras.includeStages,
      playlistIds,
    };
  }

  const normalizedFilterText = filterText.trim().toLowerCase();
  const filteredItems = useMemo(() => {
    return deckItems.filter((item) => {
      if (!normalizedFilterText) return true;
      return item.title.toLowerCase().includes(normalizedFilterText) || item.type.toLowerCase().includes(normalizedFilterText);
    });
  }, [deckItems, normalizedFilterText]);

  useEffect(() => {
    const contentIds = new Set(deckItems.map((item) => item.id));
    setSelectedItemIds((current) => {
      const next = new Set(Array.from(current).filter((id) => contentIds.has(id)));
      if (next.size === current.size) return current;
      return next;
    });
  }, [deckItems]);

  useEffect(() => {
    const playlistIds = new Set(
      (snapshot?.libraryBundles ?? []).flatMap((bundle) => bundle.playlists.map((tree) => tree.playlist.id)),
    );
    setSelectedPlaylistIds((current) => {
      const next = new Set(Array.from(current).filter((id) => playlistIds.has(id)));
      if (next.size === current.size) return current;
      return next;
    });
  }, [snapshot]);

  const blockedImportReasons = useMemo(() => {
    if (!inspection) return [];
    return inspection.brokenReferences.flatMap((reference) => {
      const decision = decisionMap.get(reference.source);
      if (!decision) return [`Choose an action for ${reference.source}`];
      if (decision.action === 'replace' && !decision.replacementPath) {
        return [`Choose a replacement file for ${reference.source}`];
      }
      return [];
    });
  }, [decisionMap, inspection]);

  function updateMessage(nextMessage: string | null) {
    setMessage(nextMessage);
    if (nextMessage) {
      setStatusText(nextMessage);
    }
  }

  function handleToggleItemId(id: Id) {
    setSelectedItemIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleTogglePlaylistId(id: Id) {
    setSelectedPlaylistIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleClearSelection() {
    setSelectedItemIds(new Set());
    setSelectedPlaylistIds(new Set());
  }

  function buildSuggestedBundleName(): string {
    const itemCount = selectedItemIds.size;
    const playlistCount = selectedPlaylistIds.size;

    if (itemCount === 1 && playlistCount === 0) {
      const only = deckItems.find((item) => selectedItemIds.has(item.id));
      if (only) return only.title;
    }
    if (itemCount === 0 && playlistCount === 1) {
      const tree = (snapshot?.libraryBundles ?? [])
        .flatMap((bundle) => bundle.playlists)
        .find((entry) => selectedPlaylistIds.has(entry.playlist.id));
      if (tree) return `cast-playlist-${tree.playlist.name.trim() || 'playlist'}`;
    }

    const total = itemCount + playlistCount;
    return total > 0 ? `cast-bundle-${total}` : 'cast-bundle';
  }

  async function runExport(itemIds: Id[], playlistIds: Id[], suggestedName: string, options: DeckBundleExportOptions) {
    const hasItems = itemIds.length > 0;
    const hasPlaylists = playlistIds.length > 0;
    const hasExtras = Boolean(options.includeAllThemes || options.includeOverlays || options.includeStages);
    if ((!hasItems && !hasPlaylists && !hasExtras) || exportInFlight) return;
    setExportInFlight(true);
    updateMessage(null);
    try {
      const filePath = await window.castApi.chooseDeckBundleExportPath(suggestedName);
      if (!filePath) return;
      const result = await window.castApi.exportDeckBundle(itemIds, filePath, options);
      const summary: string[] = [];
      summary.push(`${result.itemCount} item${result.itemCount === 1 ? '' : 's'}`);
      if (hasPlaylists) summary.push(`${playlistIds.length} playlist${playlistIds.length === 1 ? '' : 's'}`);
      const extrasNote = describeExtras(options);
      if (extrasNote) summary.push(extrasNote);
      updateMessage(`Exported ${summary.join(', ')}.`);
    } catch (error) {
      updateMessage((error as Error).message);
    } finally {
      setExportInFlight(false);
    }
  }

  async function handleExportSelected() {
    if (selectedItemIds.size === 0 && selectedPlaylistIds.size === 0) return;
    const playlistIds = Array.from(selectedPlaylistIds);
    await runExport(Array.from(selectedItemIds), playlistIds, buildSuggestedBundleName(), buildExportOptions(playlistIds));
  }

  async function handleExportPlaylist(playlist: Playlist) {
    const slug = playlist.name.trim() || 'playlist';
    await runExport([], [playlist.id], `cast-playlist-${slug}`, buildExportOptions([playlist.id]));
  }

  async function handleExportDeckItem(item: DeckItem) {
    await runExport([item.id], [], item.title, buildExportOptions());
  }

  async function handleExportWorkspace() {
    const allItemIds = deckItems.map((item) => item.id);
    const allPlaylistIds = (snapshot?.libraryBundles ?? []).flatMap((bundle) =>
      bundle.playlists.map((tree) => tree.playlist.id),
    );
    await runExport(allItemIds, allPlaylistIds, 'cast-workspace', {
      includeAllThemes: true,
      includeOverlays: true,
      includeStages: true,
      playlistIds: allPlaylistIds,
    });
  }

  async function inspectBundle(filePath: string) {
    const nextInspection = await window.castApi.inspectImportBundle(filePath);
    setImportPath(filePath);
    setInspection(nextInspection);
    setDecisionMap(new Map());
    updateMessage(`Loaded bundle with ${nextInspection.itemCount} item${nextInspection.itemCount === 1 ? '' : 's'}.`);
  }

  async function handleChooseImportBundle() {
    if (importInFlight) return;
    setImportInFlight(true);
    updateMessage(null);
    try {
      const filePath = await window.castApi.chooseDeckBundleImportPath();
      if (!filePath) return;
      await inspectBundle(filePath);
    } catch (error) {
      updateMessage((error as Error).message);
    } finally {
      setImportInFlight(false);
    }
  }

  function handleClearImportReview() {
    setImportPath(null);
    setInspection(null);
    setDecisionMap(new Map());
    updateMessage(null);
  }

  function handleSetBrokenReferenceAction(source: string, action: DeckBundleBrokenReferenceAction) {
    setDecisionMap((current) => {
      const next = new Map(current);
      const existing = next.get(source);
      next.set(source, {
        action,
        replacementPath: action === 'replace' ? existing?.replacementPath ?? null : null,
      });
      return next;
    });
  }

  async function handleChooseReplacementPath(source: string) {
    const filePath = await window.castApi.chooseImportReplacementMediaPath();
    if (!filePath) return;
    setDecisionMap((current) => {
      const next = new Map(current);
      next.set(source, { action: 'replace', replacementPath: filePath });
      return next;
    });
  }

  function buildFinalizeDecisions(): DeckBundleBrokenReferenceDecision[] {
    if (!inspection) return [];
    return inspection.brokenReferences.map((reference) => {
      const decision = decisionMap.get(reference.source);
      if (!decision) {
        throw new Error(`Missing decision for ${reference.source}`);
      }
      return {
        source: reference.source,
        action: decision.action,
        replacementPath: decision.replacementPath ?? undefined,
      };
    });
  }

  async function handleFinalizeImport() {
    if (!importPath || !inspection || blockedImportReasons.length > 0 || importInFlight) return;
    setImportInFlight(true);
    updateMessage(null);
    try {
      await mutate(() => window.castApi.finalizeImportBundle(importPath, buildFinalizeDecisions()));
      updateMessage(`Imported ${inspection.itemCount} item${inspection.itemCount === 1 ? '' : 's'}.`);
      setInspection(null);
      setImportPath(null);
      setDecisionMap(new Map());
    } catch (error) {
      updateMessage((error as Error).message);
    } finally {
      setImportInFlight(false);
    }
  }

  function handleSetExtraFlag(flag: keyof ExtraIncludeFlags, value: boolean) {
    setExtras((current) => ({ ...current, [flag]: value }));
  }

  function handleFilterTextChange(value: string) {
    setFilterText(value);
  }

  return {
    state: {
      deckItems: filteredItems,
      filterText,
      selectedItemIds,
      selectedPlaylistIds,
      selectedCount: selectedItemIds.size + selectedPlaylistIds.size,
      exportInFlight,
      importInFlight,
      importPath,
      inspection,
      decisionMap,
      blockedImportReasons,
      message,
      extras,
    },
    actions: {
      setFilterText: handleFilterTextChange,
      toggleItemId: handleToggleItemId,
      togglePlaylistId: handleTogglePlaylistId,
      clearSelection: handleClearSelection,
      setExtraFlag: handleSetExtraFlag,
      exportSelected: handleExportSelected,
      exportPlaylist: handleExportPlaylist,
      exportDeckItem: handleExportDeckItem,
      exportWorkspace: handleExportWorkspace,
      chooseImportBundle: handleChooseImportBundle,
      clearImportReview: handleClearImportReview,
      setBrokenReferenceAction: handleSetBrokenReferenceAction,
      chooseReplacementPath: handleChooseReplacementPath,
      finalizeImport: handleFinalizeImport,
    },
  };
}

function describeExtras(options: DeckBundleExportOptions): string {
  const parts: string[] = [];
  if (options.includeAllThemes) parts.push('all themes');
  if (options.includeOverlays) parts.push('overlays');
  if (options.includeStages) parts.push('page layouts');
  return parts.join(', ');
}

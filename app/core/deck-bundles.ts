import type {
  DeckBundleItem,
  DeckBundleManifest,
  DeckBundleMediaReference,
  DeckBundleOverlay,
  DeckBundleStage,
  DeckBundleTheme,
  SlideElement,
} from './types';

interface MediaReferenceAccumulator {
  elementTypes: Set<'image' | 'video'>;
  occurrenceCount: number;
}

export function cloneDeckBundleManifest(manifest: DeckBundleManifest): DeckBundleManifest {
  return JSON.parse(JSON.stringify(manifest)) as DeckBundleManifest;
}

export function readElementMediaReference(element: SlideElement): { source: string; elementType: 'image' | 'video' } | null {
  if (element.type !== 'image' && element.type !== 'video') return null;
  const source = typeof (element.payload as { src?: string })?.src === 'string'
    ? (element.payload as { src: string }).src
    : '';
  if (!source) return null;
  return { source, elementType: element.type };
}

export function collectDeckBundleMediaReferences(
  items: DeckBundleItem[],
  themes: DeckBundleTheme[],
  overlays: DeckBundleOverlay[] = [],
  stages: DeckBundleStage[] = [],
): DeckBundleMediaReference[] {
  const references = new Map<string, MediaReferenceAccumulator>();

  function collect(elements: SlideElement[]) {
    for (const element of elements) {
      const reference = readElementMediaReference(element);
      if (!reference) continue;
      const current = references.get(reference.source) ?? {
        elementTypes: new Set<'image' | 'video'>(),
        occurrenceCount: 0,
      };
      current.elementTypes.add(reference.elementType);
      current.occurrenceCount += 1;
      references.set(reference.source, current);
    }
  }

  for (const item of items) {
    for (const slide of item.slides) {
      collect(slide.elements);
    }
  }

  for (const theme of themes) {
    collect(theme.elements);
  }

  for (const overlay of overlays) {
    collect(overlay.elements);
  }

  for (const stage of stages) {
    collect(stage.elements);
  }

  return Array.from(references.entries())
    .map(([source, reference]) => ({
      source,
      elementTypes: Array.from(reference.elementTypes).sort(),
      occurrenceCount: reference.occurrenceCount,
    }))
    .sort((left, right) => left.source.localeCompare(right.source));
}

export function normalizeDeckBundleManifest(manifest: DeckBundleManifest): DeckBundleManifest {
  return {
    ...manifest,
    mediaReferences: collectDeckBundleMediaReferences(
      manifest.items,
      manifest.themes,
      manifest.overlays ?? [],
      manifest.stages ?? [],
    ),
  };
}

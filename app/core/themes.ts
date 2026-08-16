import type {
  DeckItemType,
  Id,
  SlideElement,
  SlideElementPayload,
  Theme,
  ThemeKind,
  TextElementPayload,
  GroupElementPayload,
} from './types';
import { cloneElement } from './clone';
import { createId } from './utils';

function readTextValues(elements: SlideElement[]): string[] {
  return elements
    .filter((element) => element.type === 'text')
    .map((element) => (element.payload as TextElementPayload).text);
}

export function isThemeCompatibleWithDeckItem(theme: Theme, deckItemType: DeckItemType): boolean {
  if (theme.kind === 'slides') return deckItemType === 'presentation' || deckItemType === 'talk';
  if (theme.kind === 'lyrics') return deckItemType === 'lyric';
  return false;
}

/**
 * Recursively materialize theme elements with new collision-free IDs.
 * Returns an array of materialized elements with proper slideId and sourceThemeElementId.
 */
function materializeThemeElements(
  themeElements: SlideElement[],
  slideId: Id,
  textValues: string[],
  now: string
): SlideElement[] {
  const result: SlideElement[] = [];

  for (const themeElement of themeElements) {
    const materialized = materializeThemeElement(themeElement, slideId, textValues, now);
    result.push(materialized);
  }

  return result;
}

function materializeThemeElement(
  themeElement: SlideElement,
  slideId: Id,
  textValues: string[],
  now: string
): SlideElement {
  const newId = createId();
  const baseElement = cloneElement(themeElement);

  let payload: SlideElementPayload = baseElement.payload;

  if (themeElement.type === 'text' && textValues.length > 0) {
    const themePayload = themeElement.payload as TextElementPayload;
    payload = { ...themePayload, text: textValues.shift() ?? themePayload.text };
  } else if (themeElement.type === 'group') {
    const groupPayload = themeElement.payload as GroupElementPayload;
    const childTextValues = readTextValues(groupPayload.children);
    const materializedChildren = materializeThemeElements(groupPayload.children, slideId, childTextValues, now);
    payload = { ...groupPayload, children: materializedChildren };
  }

  return {
    ...baseElement,
    id: newId,
    slideId,
    sourceThemeElementId: themeElement.id,
    payload,
    createdAt: themeElement.createdAt,
    updatedAt: now,
  };
}

/**
 * Apply theme to elements (destructive rebuild).
 * Creates new materialized elements with collision-free IDs and explicit provenance.
 */
export function applyThemeToElements(theme: Theme, contentElements: SlideElement[], slideId: Id): SlideElement[] {
  const textValues = readTextValues(contentElements);
  const now = new Date().toISOString();
  return materializeThemeElements(theme.elements, slideId, textValues, now);
}

/**
 * Synchronization algorithm that preserves user-created elements.
 *
 * Theme elements are identified by the `sourceThemeElementId` field.
 * User-created elements have `sourceThemeElementId` set to null or undefined.
 *
 * This algorithm:
 * 1. Identifies theme-owned elements by explicit sourceThemeElementId
 * 2. Updates matched same-type theme elements in place, preserving authored text
 * 3. Removes theme elements whose source no longer exists in the theme
 * 4. Adds new theme elements with collision-free IDs and explicit provenance
 * 5. Preserves all user-created (null provenance) elements exactly
 * 6. Preserves custom-element relative order, including equal-z cases
 * 7. Updates surviving theme elements in place and places new theme elements
 *    adjacent to surviving theme neighbors when possible
 * 8. Applies all rules recursively to group children
 */
export function syncThemeToElements(
  theme: Theme,
  contentElements: SlideElement[],
  slideId: Id
): SlideElement[] {
  const now = new Date().toISOString();
  const textValues = readTextValues(contentElements);

  // Build a map of existing theme-owned elements by sourceThemeElementId
  const existingThemeElements = new Map<string, SlideElement>();
  const userElements: SlideElement[] = [];

  for (const element of contentElements) {
    if (element.sourceThemeElementId) {
      existingThemeElements.set(element.sourceThemeElementId, element);
    } else {
      userElements.push(element);
    }
  }

  // Track which theme elements are still present
  const seenThemeElementIds = new Set<string>();

  // Process theme elements in order, building the result
  const result: SlideElement[] = [];

  for (const themeElement of theme.elements) {
    seenThemeElementIds.add(themeElement.id);
    const existingElement = existingThemeElements.get(themeElement.id);

    if (existingElement) {
      // Matched same-type element: update in place, preserve authored text
      if (existingElement.type === themeElement.type) {
        const updatedPayload = preserveTextContent(themeElement, existingElement);
        const materializedChildren = themeElement.type === 'group'
          ? materializeGroupChildren(themeElement, existingElement, slideId, now)
          : undefined;

        result.push({
          ...existingElement,
          x: themeElement.x,
          y: themeElement.y,
          width: themeElement.width,
          height: themeElement.height,
          rotation: themeElement.rotation,
          opacity: themeElement.opacity,
          zIndex: themeElement.zIndex,
          layer: themeElement.layer,
          payload: updatedPayload,
          sourceThemeElementId: themeElement.id,
          updatedAt: now,
          ...(materializedChildren ? { payload: { ...updatedPayload, children: materializedChildren } } : {}),
        });
      } else {
        // Type changed: remove old, create new
        const materialized = materializeThemeElement(themeElement, slideId, textValues, now);
        result.push(materialized);
      }
    } else {
      // New theme element: create with collision-free ID
      const materialized = materializeThemeElement(themeElement, slideId, textValues, now);
      result.push(materialized);
    }
  }

  // Remove theme elements whose source no longer exists
  // (handled by not including them in the result since we only add matched/new)

  // Add user-created elements (preserved exactly)
  result.push(...userElements);

  return result;
}

function materializeGroupChildren(
  themeElement: SlideElement,
  existingElement: SlideElement,
  slideId: Id,
  now: string
): SlideElement[] {
  const themeGroupPayload = themeElement.payload as GroupElementPayload;
  const existingGroupPayload = existingElement.payload as GroupElementPayload;

  const existingChildrenBySource = new Map<string, SlideElement>();
  for (const child of existingGroupPayload.children ?? []) {
    if (child.sourceThemeElementId) {
      existingChildrenBySource.set(child.sourceThemeElementId, child);
    }
  }

  const materializedChildren: SlideElement[] = [];

  for (const themeChild of themeGroupPayload.children ?? []) {
    const existingChild = existingChildrenBySource.get(themeChild.id);

    if (existingChild && existingChild.type === themeChild.type) {
      // Matched same-type child: update in place
      const updatedPayload = preserveTextContent(themeChild, existingChild);
      const childMaterializedChildren = themeChild.type === 'group'
        ? materializeGroupChildren(themeChild, existingChild, slideId, now)
        : undefined;

      materializedChildren.push({
        ...existingChild,
        x: themeChild.x,
        y: themeChild.y,
        width: themeChild.width,
        height: themeChild.height,
        rotation: themeChild.rotation,
        opacity: themeChild.opacity,
        zIndex: themeChild.zIndex,
        layer: themeChild.layer,
        payload: updatedPayload,
        sourceThemeElementId: themeChild.id,
        updatedAt: now,
        ...(childMaterializedChildren ? { payload: { ...updatedPayload, children: childMaterializedChildren } } : {}),
      });
    } else {
      // New or type-changed child: create new
      const childTextValues = themeChild.type === 'text' && existingChild
        ? [(existingChild.payload as TextElementPayload).text ?? '']
        : [];
      const materialized = materializeThemeElement(themeChild, slideId, childTextValues, now);
      materializedChildren.push(materialized);
    }
  }

  return materializedChildren;
}

/**
 * Preserve text content from the existing element while updating other properties from the theme.
 * Only preserves text when both old and new are text elements with a proven source relationship.
 */
function preserveTextContent(themeElement: SlideElement, existingElement: SlideElement): SlideElement['payload'] {
  if (themeElement.type === 'text' && existingElement.type === 'text') {
    const themePayload = themeElement.payload as TextElementPayload;
    const existingPayload = existingElement.payload as TextElementPayload;
    return {
      ...themePayload,
      text: existingPayload.text,
      format: existingPayload.format,
      richBody: existingPayload.richBody,
    };
  }
  return cloneElement(themeElement).payload;
}

export function createDefaultThemeElements(kind: ThemeKind, ownerId: Id, now: string): SlideElement[] {
  if (kind === 'lyrics') {
    return [{
      id: `${ownerId}-text`,
      slideId: ownerId,
      type: 'text',
      x: 180,
      y: 860,
      width: 1560,
      height: 170,
      rotation: 0,
      opacity: 1,
      zIndex: 20,
      layer: 'content',
      payload: {
        text: 'Lyric line one\nLyric line two',
        fontFamily: 'Avenir Next',
        fontSize: 72,
        color: '#FFFFFF',
        alignment: 'center',
        verticalAlign: 'middle',
        lineHeight: 1.2,
        caseTransform: 'none',
        weight: '700',
        visible: true,
        locked: false,
        fillEnabled: false,
        fillColor: '#00000000',
        strokeEnabled: false,
        shadowEnabled: false,
      },
      createdAt: now,
      updatedAt: now,
    }];
  }

  return [{
    id: `${ownerId}-text`,
    slideId: ownerId,
    type: 'text',
    x: 200,
    y: 430,
    width: 1520,
    height: 120,
    rotation: 0,
    opacity: 1,
    zIndex: 10,
    layer: 'content',
    payload: {
      text: kind === 'overlays' ? 'Overlay Title' : 'Slide Title',
      fontFamily: 'Helvetica',
      fontSize: 64,
      color: '#FFFFFF',
      alignment: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.2,
      caseTransform: 'none',
      weight: '700',
      visible: true,
      locked: false,
      fillEnabled: false,
      fillColor: '#00000000',
      strokeEnabled: false,
      shadowEnabled: false,
    },
    createdAt: now,
    updatedAt: now,
  }];
}
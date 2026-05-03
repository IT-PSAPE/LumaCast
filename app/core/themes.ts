import type {
  DeckItemType,
  Id,
  SlideElement,
  Theme,
  ThemeKind,
  TextElementPayload,
} from './types';
import { cloneElement } from './clone';

function readTextValues(elements: SlideElement[]): string[] {
  return elements
    .filter((element) => element.type === 'text')
    .map((element) => (element.payload as TextElementPayload).text);
}

function applyTextValue(themeElement: SlideElement, textValues: string[]): SlideElement['payload'] {
  if (themeElement.type === 'text' && textValues.length > 0) {
    const themePayload = themeElement.payload as TextElementPayload;
    return { ...themePayload, text: textValues.shift() ?? themePayload.text };
  }
  return cloneElement(themeElement).payload;
}

export function isThemeCompatibleWithDeckItem(theme: Theme, deckItemType: DeckItemType): boolean {
  if (theme.kind === 'slides') return deckItemType === 'presentation';
  if (theme.kind === 'lyrics') return deckItemType === 'lyric';
  return false;
}

export function applyThemeToElements(theme: Theme, contentElements: SlideElement[], slideId: Id): SlideElement[] {
  const textValues = readTextValues(contentElements);

  return theme.elements.map((themeElement) => {
    return {
      ...cloneElement(themeElement),
      id: `${slideId}:${themeElement.id}`,
      slideId,
      payload: applyTextValue(themeElement, textValues),
      createdAt: themeElement.createdAt,
      updatedAt: themeElement.updatedAt,
    };
  });
}

export function syncThemeToElements(theme: Theme, contentElements: SlideElement[], slideId: Id): SlideElement[] {
  return applyThemeToElements(theme, contentElements, slideId);
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

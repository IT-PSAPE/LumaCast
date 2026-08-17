import type { SlideElement } from './domain/slide-elements';

export function cloneElement(element: SlideElement): SlideElement {
  return JSON.parse(JSON.stringify(element)) as SlideElement;
}

export function cloneElements(elements: SlideElement[]): SlideElement[] {
  return elements.map(cloneElement);
}

import type { SlideElement } from '@core/types';

export { cloneElement, cloneElements } from '@lumacast/composition';

export function collectionSignature<T>(items: T[], sigFn: (item: T) => string): string {
  return JSON.stringify(items.map(sigFn));
}

export function slideElementsSignature(elements: SlideElement[]): string {
  return JSON.stringify(elements);
}

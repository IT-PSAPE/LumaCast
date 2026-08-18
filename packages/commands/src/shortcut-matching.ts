import type { ShortcutDefinition } from './shortcuts';

export type ShortcutMatch = false | true | string;

export function matchesShortcut(event: KeyboardEvent, def: ShortcutDefinition): ShortcutMatch {
  const modifiers = def.modifiers ?? {};
  const metaPressed = event.metaKey || event.ctrlKey;
  if (modifiers.meta !== undefined && modifiers.meta !== metaPressed) return false;
  if (modifiers.shift !== undefined && modifiers.shift !== event.shiftKey) return false;
  if (modifiers.alt !== undefined && modifiers.alt !== event.altKey) return false;
  return matchesKey(event.key, def.key);
}

function matchesKey(eventKey: string, pattern: string): ShortcutMatch {
  const rangeMatch = /^(\d)-(\d)$/.exec(pattern);
  if (rangeMatch) {
    if (!/^\d$/.test(eventKey)) return false;
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);
    const n = Number(eventKey);
    return n >= min && n <= max ? eventKey : false;
  }

  if (pattern.includes('|')) {
    return pattern.split('|').some((alt) => literalKeyMatches(eventKey, alt));
  }

  return literalKeyMatches(eventKey, pattern);
}

function literalKeyMatches(eventKey: string, pattern: string): boolean {
  if (pattern === 'Space') return eventKey === ' ';
  return eventKey.toLowerCase() === pattern.toLowerCase();
}

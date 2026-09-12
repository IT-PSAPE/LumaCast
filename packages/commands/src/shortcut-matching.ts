import type { ShortcutDefinition } from './shortcuts';

export type ShortcutMatch = false | true | string;

export function matchesShortcut(event: KeyboardEvent, def: ShortcutDefinition): ShortcutMatch {
  const modifiers = def.modifiers ?? {};
  const metaPressed = event.metaKey || event.ctrlKey;
  if (!modifierMatches(modifiers.meta, metaPressed)) return false;
  if (!modifierMatches(modifiers.shift, event.shiftKey)) return false;
  if (!modifierMatches(modifiers.alt, event.altKey)) return false;
  return matchesKey(event.key, def.key);
}

function modifierMatches(
  expected: boolean | 'any' | undefined,
  actual: boolean,
): boolean {
  if (expected === 'any') return true;
  // Omitted (undefined) means the modifier must NOT be pressed — exact-match
  // contract. Shortcuts that intentionally ignore a modifier must declare
  // `shift: 'any'` (etc.) explicitly. See ShortcutModifiers docs.
  const want = expected ?? false;
  return want === actual;
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

// @vitest-environment node
//
// Guards the radius and spacing scales declared in packages/ui/src/theme.css.
//
// Why a test rather than a lint rule: `@theme { --radius-*: initial }` deletes
// Tailwind's stock radius namespace, so `rounded`, `rounded-sm`, `rounded-md`,
// `rounded-lg`, `rounded-xl` and `rounded-2xl` stop compiling — they emit NO
// border-radius at all rather than erroring. The failure is invisible in a
// build, in tsc and in a screenshot of a square-cornered box nobody looks at
// twice. This is what makes it visible.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The only radius names that survive `--radius-*: initial`. */
const RADIUS_NAMES = new Set(['hairline', 'control', 'container', 'surface', 'full', 'none']);
/** Tailwind's per-corner and logical-property segments, which sit before the name. */
const SIDES = new Set(['t', 'b', 'l', 'r', 'tl', 'tr', 'bl', 'br', 's', 'e', 'ss', 'se', 'es', 'ee']);

/** border-radius values that are a shape, not a step on the scale. */
const SHAPE_RADII = /^(0|50%|9999px|var\(--radius-[a-z]+\))$/;

const SPACING_PROPERTY = /\b(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left))?\s*:([^;}]*)/g;
/** An inline waiver. Section C of the adoption spec allows a literal only for a
 *  1px optical nudge or a fixed-size box, and only when it says so on the line. */
const WAIVER = /\/\*\s*off-grid:/;

function sourceFiles(extensions: readonly string[]): string[] {
  const found: string[] = [];
  const skip = new Set(['node_modules', 'out', 'dist', 'build', '.git', 'coverage', 'release']);
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (extensions.some((e) => entry.name.endsWith(e))) found.push(path.relative(ROOT, full));
    }
  };
  for (const top of ['apps', 'packages']) walk(path.join(ROOT, top));
  return found;
}

/** Comments and identifiers both contain the English word "rounded" (`const
 *  rounded =`, "Milliseconds are rounded…"), so only class strings are read. */
function classStrings(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  return [...withoutComments.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/gs)].map((m) => m[2]);
}

function deadRadiusClasses(source: string): string[] {
  const dead: string[] = [];
  for (const text of classStrings(source)) {
    for (const [token] of text.matchAll(/\brounded(?:-[a-z0-9[\]%.]+)*\b/g)) {
      const parts = token.split('-').slice(1);
      const name = (SIDES.has(parts[0]) ? parts.slice(1) : parts).join('-');
      if (!RADIUS_NAMES.has(name)) dead.push(token);
    }
  }
  return dead;
}

describe('radius scale', () => {
  it('no component uses a radius class that stopped compiling', () => {
    const offenders = sourceFiles(['.ts', '.tsx'])
      .map((file) => [file, deadRadiusClasses(fs.readFileSync(path.join(ROOT, file), 'utf8'))] as const)
      .filter(([, dead]) => dead.length > 0)
      .map(([file, dead]) => `${file}: ${[...new Set(dead)].join(', ')}`);
    expect(offenders, 'use rounded-{hairline,control,container,surface,full,none}').toEqual([]);
  });

  it('no stylesheet hardcodes a border-radius off the scale', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(['.css'])) {
      const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const [, value] of line.matchAll(/(?:^|[;{\s])border-radius\s*:([^;}]*)/g)) {
          const trimmed = value.trim();
          if (!SHAPE_RADII.test(trimmed)) offenders.push(`${file}:${index + 1} ${trimmed}`);
        }
      });
    }
    expect(offenders, 'use var(--radius-*)').toEqual([]);
  });
});

describe('spacing scale', () => {
  it('no stylesheet hardcodes padding, margin or gap in pixels', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(['.css'])) {
      const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (WAIVER.test(line)) return;
        for (const match of line.matchAll(SPACING_PROPERTY)) {
          if (/\d+px/.test(match[4])) offenders.push(`${file}:${index + 1} ${match[0].trim()}`);
        }
      });
    }
    expect(offenders, 'use var(--space-*), or waive the line with /* off-grid: why */').toEqual([]);
  });

  it('the scale and the radius steps are declared exactly once, in the theme', () => {
    const theme = fs.readFileSync(path.join(ROOT, 'packages/ui/src/theme.css'), 'utf8');
    const declared = (name: string) => new RegExp(`^\\s*--${name}:`, 'm').test(theme);
    for (const step of ['space-0-5', 'space-1', 'space-1-5', 'space-2', 'space-3', 'space-4', 'space-5', 'space-6', 'space-8', 'space-12']) {
      expect(declared(step), `--${step} missing`).toBe(true);
    }
    for (const step of ['radius-hairline', 'radius-control', 'radius-container', 'radius-surface', 'radius-full']) {
      expect(declared(step), `--${step} missing`).toBe(true);
    }
    // The flip itself. Without it the stock scale is still live and every
    // class the first test rejects would silently keep working.
    expect(theme).toMatch(/--radius-\*:\s*initial;/);
  });
});

#!/usr/bin/env node

// Deterministic import/command-boundary checker for the committed Electron
// `app/` tree (parent issue #117, leaf #156).
//
// It parses static ES imports/exports only. Unsupported dynamic patterns
// (`import(<non-literal>)`, `require(<non-literal>)`) fail loudly instead of
// being guessed.
//
// Two severity tiers:
// - Hard errors (fail the check): every rule except the feature-boundary pair
//   below. Each hard-error violation must be covered by the frozen allow-list;
//   every allow-list entry must be in use, so the allow-list can only shrink.
// - Warnings (exit 0, "refactor debt"): feature-isolation and feature-cycle.
//   The current feature web is mid-refactor; these are reported and must not be
//   allow-listed. They flip to hard errors once the feature web is refactored.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, '..');
const FIXTURES_ROOT = path.join(TOOL_DIR, 'fixtures', 'electron-architecture');

const ALIASES = {
  '@renderer': 'app/renderer',
  '@rendering': 'app/rendering',
};

const NDI_HOST_COMMAND_EXPORTS = new Set(['NdiHostCommand', 'NdiHostEvent']);

// Packages allowed to import react/react-dom/konva/react-konva under
// package-purity (issue #219, W9). Only @lumacast/canvas is a rendering
// package — every other package stays headless. Electron stays banned for
// every package regardless of membership here.
const REACT_ALLOWED_PACKAGES = new Set(['canvas']);

// ---------------------------------------------------------------------------
// Package graph (issue #223, parent #219). npm workspace packages live under
// packages/*. No packages exist yet beyond packages/ndi-native (a native
// addon, exempt from this table — it never imports anything these rules
// govern). The table below is the dependency direction #219 recorded for the
// packages planned in the sweep; it is deliberately a default-deny allow
// list so a new package name with no entry starts with zero permitted
// dependencies rather than silently inheriting access.
// ---------------------------------------------------------------------------
const PACKAGE_DEPENDENCY_DIRECTIONS = {
  // Everything may depend on kernel; it depends on nothing.
  kernel: [],
  composition: ['kernel'],
  canvas: ['kernel', 'composition', 'protocol'],
  // Commands stays platform-independent at its core.
  commands: ['kernel'],
  automation: ['kernel', 'composition'],
  playback: ['kernel', 'composition', 'protocol'],
  protocol: ['kernel', 'composition', 'automation', 'commands'],
  // Persistence never depends on renderer packages (enforced separately by
  // the persistence-purity rule below, which is not expressible as a
  // package-name allow list).
  'persistence-sqlite': ['kernel', 'composition', 'automation', 'protocol'],
  // The native NDI addon (@lumacast/ndi-native) is not a dependency-direction
  // entry here — it is resolved via classifyExternal's 'native' kind, not a
  // pkg:* zone, and is governed by the engine-session rule below instead.
  // Listed for documentation parity with issue #219's target map.
  engine: ['kernel', 'composition', 'protocol', 'ndi-native'],
};

// Rules reported as warning-level "refactor debt" (exit 0) until the feature
// web is refactored, then flipped to hard errors. These are never allow-listed.
const WARNING_RULES = new Set(['feature-isolation', 'feature-cycle']);

const RULE_TITLES = {
  'core-purity':
    'Domain/core policy must not import Electron, React, the renderer, the database, main-process code, native modules, or feature code.',
  'contracts-purity':
    'app/contracts is the runtime decode boundary every zone may depend on; it must not import app/database, app/main, app/renderer, React, Electron, or the native module. It may import app/core.',
  'data-purity':
    'The database layer must not import renderer, feature, or React code.',
  'main-boundary':
    'Main is the process composition root and must not import renderer or feature code.',
  'renderer-isolation':
    'The renderer must not import Electron, main-process modules, or the database; it reaches main only through the typed castApi IPC contract in app/core.',
  'ui-purity':
    'UI/rendering primitives (components, utils, types) must not import feature implementations.',
  'feature-isolation':
    'A feature must not import another feature; allowed feature dependencies are directed and documented public edges only. (Currently warning-level refactor debt — flips to a hard error when the feature web is refactored.)',
  'feature-cycle':
    'Bidirectional feature dependencies are forbidden; cycles must be removed, not allow-listed. (Currently warning-level refactor debt — flips to a hard error when the feature web is refactored.)',
  'composition-boundary':
    'Features must not import screens or the application shell; screens and the shell are the composition boundaries.',
  'observability-port':
    'Observability is consumed through a port; only screens, the shell, and the observability feature itself may reference it directly.',
  'engine-session':
    'Only the NDI engine-session boundary (app/main/ndi and packages/engine) may touch the native module or reference raw NDI host commands; ndi-service-proxy.ts is the sole command writer.',
  'public-entry':
    'Feature imports must go through the feature public entry point when one exists; deep internal imports fail.',
  'allow-list':
    'The frozen architecture allow-list must not grow and every entry must be used.',
  'application-boundary':
    'app/application is the composition root: it may import any zone or package, but only the shell and screens may import app/application.',
  'package-app-boundary':
    'No package under packages/* may import application code under app/; packages may not depend on the application.',
  'package-purity':
    'A package must not import React, React DOM, Konva, React-Konva, or Electron; packages are headless domain/platform code, except @lumacast/canvas, which may import react/react-dom/konva/react-konva (never electron).',
  'persistence-purity':
    'A persistence package must not import renderer code; persistence is process/storage logic and must not depend on the renderer.',
  'package-public-entry':
    'Package imports must go through the package public entry point (src/index.ts or index.ts); deep internal imports fail.',
  'package-dependency-direction':
    'Packages may only depend on other packages in the direction recorded in issue #219; this edge is not on that list.',
  'package-cycle':
    'Cycles between packages are forbidden and must be removed, never allow-listed.',
};

// ---------------------------------------------------------------------------
// Allow-list (the "rule file"). Each entry is an exact edge that is currently
// permitted, why it exists, and who owns removing it. The checker fails if an
// entry is no longer exercised by the tree, forcing the list to shrink.
// ---------------------------------------------------------------------------
const DEFAULT_ALLOW_LIST = [
  {
    from: 'app/renderer/components/display/lazy-scene-stage.tsx',
    to: 'app/renderer/features/canvas/scene-stage.tsx',
    rules: ['ui-purity'],
    reason:
      'SceneStage is a canvas-feature render component consumed by a shared display primitive. Extract the render-only scene layer to shared rendering so shared display components need no feature dependency.',
    removedBy: 'shared scene-layer (plan 0.11, Atlas)',
  },
  {
    from: 'app/renderer/components/form/doc-sortable-block.tsx',
    to: 'app/renderer/features/items/lyric-text-utils.ts',
    rules: ['ui-purity'],
    reason:
      'Lyric import text parsing lives in the items feature but is used by a shared doc-sortable form component. Move the parser to app/core so shared form components need no feature dependency.',
    removedBy: 'Atlas (move lyric import parser to app/core)',
  },
  {
    from: 'app/renderer/features/automation/automation-context.tsx',
    to: 'app/renderer/features/observability/metrics-store.ts',
    rules: ['feature-isolation', 'observability-port'],
    reason:
      'Automation records telemetry directly into the observability feature and crosses a feature boundary to do so. Route telemetry through an observability port before this can be removed.',
    removedBy: 'observability port (plan 1.3, Atlas)',
  },
  {
    from: 'app/renderer/contexts/app-context.tsx',
    to: 'app/renderer/features/observability/metrics-store.ts',
    rules: ['observability-port'],
    reason:
      'App shell wiring records telemetry directly into the observability feature. Route through an observability port before this can be removed.',
    removedBy: 'observability port (plan 1.3, Atlas)',
  },
  {
    from: 'app/renderer/contexts/app-store.ts',
    to: 'app/renderer/features/observability/metrics-store.ts',
    rules: ['observability-port'],
    reason:
      'The application store records telemetry directly into the observability feature. Route through an observability port before this can be removed.',
    removedBy: 'observability port (plan 1.3, Atlas)',
  },
  {
    from: 'app/renderer/contexts/playback/playback-context.tsx',
    to: 'app/renderer/features/observability/metrics-store.ts',
    rules: ['observability-port'],
    reason:
      'Playback wiring records telemetry directly into the observability feature. Route through an observability port before this can be removed.',
    removedBy: 'observability port (plan 1.3, Atlas)',
  },
];

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------
const RENDERER_ZONES = new Set(['screens', 'shell', 'ui', 'contexts', 'hooks', 'rendererOther']);

function isRendererZone(zone) {
  return zone != null && (RENDERER_ZONES.has(zone) || zone.startsWith('feature:'));
}

function zoneOf(rel) {
  const p = rel.split('/');
  if (p[0] === 'packages' && p.length >= 2) return 'pkg:' + p[1];
  if (p[0] !== 'app' || p.length < 2) return null;
  const sec = p[1];
  if (sec === 'core') return 'core';
  if (sec === 'contracts') return 'contracts';
  if (sec === 'database') return 'data';
  if (sec === 'application') return 'application';
  if (sec === 'main') return p[2] === 'ndi' ? 'mainNdi' : 'main';
  if (sec === 'renderer') {
    const third = p[2];
    if (third === 'features') return 'feature:' + p[3];
    if (third === 'screens') return 'screens';
    if (third === 'components' || third === 'utils' || third === 'types') return 'ui';
    if (third === 'contexts') return 'contexts';
    if (third === 'hooks') return 'hooks';
    if (third === 'App.tsx' || third === 'main.tsx' || third === 'workbench-screen-router.tsx') return 'shell';
    return 'rendererOther';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tokenizer + static import/export scanner
// ---------------------------------------------------------------------------
function tokenize(source) {
  const tokens = [];
  let i = 0;
  let line = 1;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    if (c === '\n') {
      line += 1;
      i += 1;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i += 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      const start = i;
      const quote = c;
      i += 1;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') i += 2;
        else {
          if (source[i] === '\n') line += 1;
          i += 1;
        }
      }
      i += 1;
      tokens.push({ type: 'string', value: source.slice(start, i), line });
      continue;
    }
    if (c === '`') {
      const start = i;
      i += 1;
      let depth = 0;
      while (i < n) {
        const ch = source[i];
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === '`') {
          if (depth === 0) {
            i += 1;
            break;
          }
          depth -= 1;
          i += 1;
          continue;
        }
        if (ch === '$' && source[i + 1] === '{') {
          depth += 1;
          i += 2;
          continue;
        }
        if (ch === '}' && depth > 0) {
          depth -= 1;
          i += 1;
          continue;
        }
        if (ch === '\n') line += 1;
        i += 1;
      }
      tokens.push({ type: 'template', value: source.slice(start, i), line });
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(source[j])) j += 1;
      tokens.push({ type: 'word', value: source.slice(i, j), line });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9A-Fa-fxXoObB._]/.test(source[j])) j += 1;
      tokens.push({ type: 'number', value: source.slice(i, j), line });
      i = j;
      continue;
    }
    tokens.push({ type: 'punct', value: c, line });
    i += 1;
  }
  return tokens;
}

function findMatchingParen(tokens, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type !== 'punct') continue;
    if (t.value === '(') depth += 1;
    else if (t.value === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function collectStatement(tokens, start) {
  const out = [];
  for (let i = start; i < tokens.length && out.length < 400; i += 1) {
    const t = tokens[i];
    if (t.type === 'punct' && t.value === ';') break;
    out.push(t);
  }
  return out;
}

function stripSpecifierQuotes(value) {
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function extractNames(tokens) {
  const clean = tokens.filter((t) => !(t.type === 'word' && (t.value === 'type' || t.value === 'default')));
  if (clean.some((t) => t.type === 'punct' && t.value === '*')) return ['*'];
  const openIdx = clean.findIndex((t) => t.type === 'punct' && t.value === '{');
  const closeIdx = clean.findIndex((t) => t.type === 'punct' && t.value === '}');
  if (openIdx >= 0 && closeIdx > openIdx) {
    return clean
      .slice(openIdx + 1, closeIdx)
      .filter((t) => t.type === 'word' && t.value !== 'as')
      .map((t) => t.value);
  }
  return clean.filter((t) => t.type === 'word' && t.value !== 'as').map((t) => t.value);
}

function parseImports(source) {
  const tokens = tokenize(source);
  const edges = [];
  const dynamicErrors = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type !== 'word') continue;
    const w = t.value;
    if (w === 'import' || w === 'require') {
      const next = tokens[i + 1];
      if (next && next.type === 'punct' && next.value === '(') {
        const closeIdx = findMatchingParen(tokens, i + 1);
        if (closeIdx === -1) {
          dynamicErrors.push({ kind: w, line: t.line, detail: 'unterminated call' });
          continue;
        }
        const inner = tokens.slice(i + 2, closeIdx);
        const literal = inner.length === 1 && inner[0].type === 'string' ? inner[0] : null;
        if (literal) {
          edges.push({ kind: w, specifier: stripSpecifierQuotes(literal.value), names: ['*'], line: t.line });
        } else {
          dynamicErrors.push({ kind: w, line: t.line, detail: 'non-literal argument' });
        }
        i = closeIdx;
        continue;
      }
      if (w === 'require') continue;
      if (next && next.type === 'string') {
        edges.push({ kind: 'import', specifier: stripSpecifierQuotes(next.value), names: ['*'], line: t.line });
        continue;
      }
      const stmt = collectStatement(tokens, i + 1);
      const fromIdx = stmt.findIndex((tk) => tk.type === 'word' && tk.value === 'from');
      const specTok = fromIdx >= 0 ? stmt[fromIdx + 1] : null;
      if (specTok && specTok.type === 'string') {
        edges.push({
          kind: 'import',
          specifier: stripSpecifierQuotes(specTok.value),
          names: extractNames(stmt.slice(0, fromIdx)),
          line: t.line,
        });
      }
      continue;
    }
    if (w === 'export') {
      const stmt = collectStatement(tokens, i + 1);
      const fromIdx = stmt.findIndex((tk) => tk.type === 'word' && tk.value === 'from');
      const specTok = fromIdx >= 0 ? stmt[fromIdx + 1] : null;
      if (specTok && specTok.type === 'string') {
        edges.push({
          kind: 'export',
          specifier: stripSpecifierQuotes(specTok.value),
          names: extractNames(stmt.slice(0, fromIdx)),
          line: t.line,
        });
      }
      continue;
    }
  }
  return { edges, dynamicErrors };
}

// ---------------------------------------------------------------------------
// Specifier resolution
// ---------------------------------------------------------------------------
function classifyExternal(spec) {
  if (spec.startsWith('node:')) return 'node';
  if (spec === 'electron') return 'electron';
  if (spec === 'react' || spec === 'react-dom' || spec === 'konva' || spec === 'react-konva') return 'react';
  if (spec === '@lumacast/ndi-native') return 'native';
  return 'other';
}

function findExisting(base) {
  const exts = ['', '.ts', '.tsx', '.mjs', '.js'];
  for (const ext of exts) {
    const cand = base + ext;
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  for (const idx of ['/index.ts', '/index.tsx', '/index.mjs', '/index.js']) {
    const cand = base + idx;
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

// Resolves a bare `@lumacast/<name>` specifier to a file inside
// packages/<name>, mirroring the fixed ALIASES map above but keyed off
// whatever package directories actually exist under packages/ (real or
// fixture). `@lumacast/ndi-native` is excluded: it is the native module,
// already governed by the engine-session rule via classifyExternal, and is
// never resolved to a file.
function resolvePackageAlias(specifier, root) {
  if (!specifier.startsWith('@lumacast/')) return null;
  const rest = specifier.slice('@lumacast/'.length);
  const slashIdx = rest.indexOf('/');
  const pkgName = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
  if (pkgName === 'ndi-native') return null;
  const subpath = slashIdx === -1 ? '' : rest.slice(slashIdx + 1);
  const pkgDir = path.join(root, 'packages', pkgName);
  if (!fs.existsSync(pkgDir)) return null;
  if (subpath === '') {
    const hit = findExisting(path.join(pkgDir, 'src', 'index')) ?? findExisting(path.join(pkgDir, 'index'));
    if (hit) return { type: /\.(ts|tsx|mjs)$/.test(hit) ? 'file' : 'asset', path: hit };
    return { type: 'unresolved', specifier };
  }
  const hit = findExisting(path.join(pkgDir, subpath));
  if (hit) return { type: /\.(ts|tsx|mjs)$/.test(hit) ? 'file' : 'asset', path: hit };
  return { type: 'unresolved', specifier };
}

function resolveSpecifier(specifier, fromAbs, root) {
  if (specifier.startsWith('.')) {
    const base = path.resolve(path.dirname(fromAbs), specifier);
    const hit = findExisting(base);
    if (hit) return { type: /\.(ts|tsx|mjs)$/.test(hit) ? 'file' : 'asset', path: hit };
    return { type: 'unresolved', specifier };
  }
  const alias = specifier.split('/')[0];
  const aliasBase = ALIASES[alias];
  if (aliasBase) {
    const rest = specifier.slice(alias.length + 1);
    const base = path.resolve(root, aliasBase, rest);
    const hit = findExisting(base);
    if (hit) return { type: /\.(ts|tsx|mjs)$/.test(hit) ? 'file' : 'asset', path: hit };
    return { type: 'unresolved', specifier };
  }
  const pkgResolved = resolvePackageAlias(specifier, root);
  if (pkgResolved) return pkgResolved;
  return { type: 'external', externalKind: classifyExternal(specifier) };
}

// ---------------------------------------------------------------------------
// Walk + check
// ---------------------------------------------------------------------------
function walkFiles(dir, root) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(full, root));
    else if (/\.(ts|tsx|mjs)$/.test(ent.name)) out.push(path.relative(root, full));
  }
  return out;
}

function isTestFile(rel) {
  return /\.(test|spec)\.(ts|tsx|mjs|js)$/.test(rel);
}

function normRel(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

export function check(options = {}) {
  const rootDir = options.rootDir ?? REPO_ROOT;
  const allowList = options.allowList ?? DEFAULT_ALLOW_LIST;
  const appDir = path.join(rootDir, 'app');
  const packagesDir = path.join(rootDir, 'packages');
  const errors = [];
  const stats = { files: 0, edges: 0, exceptionsUsed: 0 };

  const files = [...walkFiles(appDir, rootDir), ...walkFiles(packagesDir, rootDir)]
    .filter((rel) => (rel.startsWith('app/') && !rel.startsWith('app/e2e/')) || rel.startsWith('packages/'))
    .filter((rel) => !isTestFile(rel));

  const publicIndexes = new Set();
  const publicPackageIndexes = new Set();
  for (const rel of files) {
    if (/^app\/renderer\/features\/[^/]+\/index\.tsx?$/.test(rel)) {
      publicIndexes.add(rel.replace(/\/index\.tsx?$/, ''));
    }
    const pkgIndexMatch = rel.match(/^(packages\/[^/]+)\/(?:src\/)?index\.tsx?$/);
    if (pkgIndexMatch) {
      publicPackageIndexes.add(pkgIndexMatch[1]);
    }
  }

  const parsed = [];
  for (const rel of files) {
    const source = fs.readFileSync(path.join(rootDir, rel), 'utf8');
    stats.files += 1;
    const { edges, dynamicErrors } = parseImports(source);
    for (const d of dynamicErrors) {
      errors.push(
        `${rel}:${d.line} unsupported dynamic ${d.kind}() (${d.detail}) — this checker parses static ES imports/exports only; use a static specifier.`,
      );
    }
    for (const e of edges) parsed.push({ ...e, from: rel });
  }

  const resolvedEdges = [];
  for (const e of parsed) {
    const fromAbs = path.join(rootDir, e.from);
    stats.edges += 1;
    resolvedEdges.push({ ...e, res: resolveSpecifier(e.specifier, fromAbs, rootDir) });
  }

  const featurePairs = [];
  for (const e of resolvedEdges) {
    const fromZone = zoneOf(e.from);
    const toZone = e.res.type === 'file' ? zoneOf(normRel(rootDir, e.res.path)) : null;
    if (fromZone?.startsWith('feature:') && toZone?.startsWith('feature:') && fromZone !== toZone) {
      featurePairs.push(`${fromZone.slice(8)}->${toZone.slice(8)}`);
    }
  }
  const uniqueFeaturePairs = [...new Set(featurePairs)];
  const hasPair = new Set(uniqueFeaturePairs);

  const packagePairs = [];
  for (const e of resolvedEdges) {
    const fromZone = zoneOf(e.from);
    const toZone = e.res.type === 'file' ? zoneOf(normRel(rootDir, e.res.path)) : null;
    if (fromZone?.startsWith('pkg:') && toZone?.startsWith('pkg:') && fromZone !== toZone) {
      packagePairs.push(`${fromZone.slice(4)}->${toZone.slice(4)}`);
    }
  }
  const uniquePackagePairs = [...new Set(packagePairs)];
  const hasPkgPair = new Set(uniquePackagePairs);

  const violations = [];
  for (const e of resolvedEdges) {
    const fromRel = e.from;
    const fromZone = zoneOf(fromRel);
    const fromFeature = fromZone?.startsWith('feature:') ? fromZone.slice(8) : null;
    const res = e.res;
    const line = e.line;
    const toRel = res.type === 'file' ? normRel(rootDir, res.path) : null;
    const toZone = toRel ? zoneOf(toRel) : null;
    const toFeature = toZone?.startsWith('feature:') ? toZone.slice(8) : null;

    const add = (rule, detail) => violations.push({ rule, from: fromRel, line, to: toRel ?? e.specifier, detail });

    if (res.type === 'external') {
      const k = res.externalKind;
      if (fromZone === 'core' && (k === 'electron' || k === 'react' || k === 'native')) {
        add('core-purity', `imports ${e.specifier}`);
      }
      if (fromZone === 'contracts' && (k === 'electron' || k === 'react' || k === 'native')) {
        add('contracts-purity', `imports ${e.specifier}`);
      }
      if (fromZone === 'data' && k === 'react') {
        add('data-purity', `imports ${e.specifier}`);
      }
      if (isRendererZone(fromZone) && k === 'electron') {
        add('renderer-isolation', `imports ${e.specifier}`);
      }
      if (k === 'native' && fromZone !== 'mainNdi' && fromZone !== 'pkg:engine') {
        add('engine-session', `imports native module ${e.specifier} outside the NDI engine-session boundary (app/main/ndi or packages/engine)`);
      }
      if (fromZone?.startsWith('pkg:')) {
        const fromPkg = fromZone.slice(4);
        const reactAllowed = REACT_ALLOWED_PACKAGES.has(fromPkg);
        if (k === 'electron' || (k === 'react' && !reactAllowed)) {
          add('package-purity', `imports ${e.specifier}`);
        }
      }
      continue;
    }
    if (res.type !== 'file') continue;

    if (fromZone === 'core') {
      if (isRendererZone(toZone)) add('core-purity', `imports renderer code ${toRel}`);
      else if (toZone === 'data' || toZone === 'main' || toZone === 'mainNdi') {
        add('core-purity', `imports ${toZone} code ${toRel}`);
      }
    }
    if (fromZone === 'contracts') {
      if (isRendererZone(toZone)) add('contracts-purity', `imports renderer code ${toRel}`);
      else if (toZone === 'data' || toZone === 'main' || toZone === 'mainNdi') {
        add('contracts-purity', `imports ${toZone} code ${toRel}`);
      }
    }
    if (fromZone === 'data' && isRendererZone(toZone)) {
      add('data-purity', `imports renderer code ${toRel}`);
    }
    if ((fromZone === 'main' || fromZone === 'mainNdi') && isRendererZone(toZone)) {
      add('main-boundary', `imports renderer code ${toRel}`);
    }
    if (isRendererZone(fromZone)) {
      if (toZone === 'main' || toZone === 'mainNdi') add('renderer-isolation', `imports main-process code ${toRel}`);
      if (toZone === 'data') add('renderer-isolation', `imports database code ${toRel}`);
    }
    if (fromZone === 'ui' && toZone?.startsWith('feature:')) {
      add('ui-purity', `imports feature code ${toRel}`);
    }
    if (fromZone?.startsWith('feature:') && toZone?.startsWith('feature:') && fromFeature !== toFeature) {
      add('feature-isolation', `imports another feature ${toRel}`);
    }
    if (fromZone?.startsWith('feature:') && (toZone === 'screens' || toZone === 'shell')) {
      add('composition-boundary', `imports composition code ${toRel}`);
    }
    if (
      toRel &&
      toRel.startsWith('app/renderer/features/observability/') &&
      !fromRel.startsWith('app/renderer/features/observability/') &&
      fromZone !== 'screens' &&
      fromZone !== 'shell'
    ) {
      add('observability-port', `imports observability implementation ${toRel} outside a port`);
    }
    // NdiHostCommand/NdiHostEvent are the main<->utility-process wire
    // protocol. Historically this checked only the literal pre-extraction
    // path app/main/ndi/ndi-protocol.ts; now that the types live in
    // packages/engine (re-exported from its public index.ts), also catch
    // any import whose resolved target is inside that package — covering
    // both a deep import (blocked separately by package-public-entry) and
    // the normal barrel import `from '@lumacast/engine'`. Only the
    // app/main/ndi shims (ndi-host.ts, ndi-service-proxy.ts) and the
    // package's own internals may reference these names.
    if (
      (toRel === 'app/main/ndi/ndi-protocol.ts' || toZone === 'pkg:engine') &&
      fromZone !== 'mainNdi' &&
      fromZone !== 'pkg:engine'
    ) {
      const cmdNames = e.names.filter((n) => NDI_HOST_COMMAND_EXPORTS.has(n));
      if (cmdNames.length > 0) {
        add('engine-session', `references raw NDI host commands (${cmdNames.join(', ')}) outside the NDI engine-session boundary`);
      }
    }
    if (toZone?.startsWith('feature:')) {
      const featurePrefix = 'app/renderer/features/' + toFeature;
      const hasIndex = publicIndexes.has(featurePrefix);
      if (
        hasIndex &&
        toRel !== featurePrefix + '/index.ts' &&
        toRel !== featurePrefix + '/index.tsx' &&
        !fromRel.startsWith(featurePrefix + '/')
      ) {
        add('public-entry', `deep import into feature ${toRel} bypasses its public entry point ${featurePrefix}/index.ts`);
      }
    }

    // app/application is the composition root (issue #223): it may import
    // any zone or package freely (no purity check on its own imports below),
    // but nothing may import it except the shell and screens.
    if (toZone === 'application' && fromZone !== 'shell' && fromZone !== 'screens') {
      add('application-boundary', `imports the composition root ${toRel}`);
    }

    // No package may depend on the application (issue #223 / #219).
    if (fromZone?.startsWith('pkg:') && toZone && !toZone.startsWith('pkg:')) {
      add('package-app-boundary', `imports application code ${toRel}`);
    }

    // A persistence package must never depend on the renderer.
    if (fromZone?.startsWith('pkg:') && fromZone.slice(4).startsWith('persistence') && isRendererZone(toZone)) {
      add('persistence-purity', `imports renderer code ${toRel}`);
    }

    // Package-to-package dependency direction (issue #219). Default-deny: an
    // unlisted package name has zero permitted package dependencies.
    if (fromZone?.startsWith('pkg:') && toZone?.startsWith('pkg:') && fromZone !== toZone) {
      const fromPkg = fromZone.slice(4);
      const toPkg = toZone.slice(4);
      const allowed = PACKAGE_DEPENDENCY_DIRECTIONS[fromPkg] ?? [];
      if (!allowed.includes(toPkg)) {
        add('package-dependency-direction', `imports package ${toPkg}, which is not on ${fromPkg}'s allowed dependency list (see issue #219)`);
      }
    }

    // Package imports must go through the package's public entry point.
    if (toZone?.startsWith('pkg:')) {
      const toPkg = toZone.slice(4);
      const pkgPrefix = 'packages/' + toPkg;
      const hasPkgIndex = publicPackageIndexes.has(pkgPrefix);
      if (
        hasPkgIndex &&
        toRel !== pkgPrefix + '/index.ts' &&
        toRel !== pkgPrefix + '/index.tsx' &&
        toRel !== pkgPrefix + '/src/index.ts' &&
        toRel !== pkgPrefix + '/src/index.tsx' &&
        !fromRel.startsWith(pkgPrefix + '/')
      ) {
        add('package-public-entry', `deep import into package ${toRel} bypasses its public entry point`);
      }
    }
  }

  for (const key of uniqueFeaturePairs) {
    const [a, b] = key.split('->');
    if (hasPair.has(`${b}->${a}`)) {
      violations.push({
        rule: 'feature-cycle',
        from: 'app/renderer/features/' + a,
        line: 0,
        to: 'app/renderer/features/' + b,
        detail: `bidirectional feature dependency between features ${a} and ${b}`,
      });
    }
  }

  for (const key of uniquePackagePairs) {
    const [a, b] = key.split('->');
    if (hasPkgPair.has(`${b}->${a}`)) {
      violations.push({
        rule: 'package-cycle',
        from: 'packages/' + a,
        line: 0,
        to: 'packages/' + b,
        detail: `bidirectional package dependency between ${a} and ${b}`,
      });
    }
  }

  const used = new Set();
  const warnings = [];
  for (const v of violations) {
    if (WARNING_RULES.has(v.rule)) {
      const note =
        v.rule === 'feature-cycle'
          ? 'Bidirectional feature dependencies must be removed, not allow-listed. Land after refactor; these edges cannot be allow-listed.'
          : 'Cross-feature imports are reported but do not fail the check. Resolve the feature web before this can become a hard error. Land after refactor; do NOT allow-list this edge.';
      warnings.push(
        `${v.from}:${v.line} [${v.rule}] ${v.detail}\n    ${RULE_TITLES[v.rule]}\n    Refactor debt (warn-only): ${note}`,
      );
      continue;
    }
    const entry = allowList.find((en) => en.from === v.from && en.to === v.to && en.rules.includes(v.rule));
    if (entry) {
      used.add(entry);
      continue;
    }
    errors.push(
      `${v.from}:${v.line} [${v.rule}] ${v.detail}\n    ${RULE_TITLES[v.rule]}\n    Not covered by the frozen allow-list in tool/check_electron_architecture.mjs — add an entry with a reason and removal owner, or remove the import.`,
    );
  }
  for (const entry of allowList) {
    if (used.has(entry)) continue;
    errors.push(
      `[allow-list] unused exception ${entry.from} -> ${entry.to} (rules: ${entry.rules.join(', ')})\n    ${RULE_TITLES['allow-list']}\n    The tree no longer needs this entry; remove it from tool/check_electron_architecture.mjs.`,
    );
  }

  stats.exceptionsUsed = used.size;
  return { ok: errors.length === 0, errors, warnings, stats, violations, used };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  if (args.includes('--test')) {
    process.exitCode = runSelfTests() ? 0 : 1;
    return;
  }
  const rootArg = args.indexOf('--root');
  const rootDir = rootArg >= 0 && args[rootArg + 1] ? path.resolve(args[rootArg + 1]) : REPO_ROOT;
  const result = check({ rootDir });
  for (const e of result.errors) console.error(`${e}\n`);
  if (result.warnings.length > 0) {
    console.error(`\n${result.warnings.length} refactor-debt warning(s) (reported, not failures — flip to hard errors once the feature web is refactored):\n`);
    for (const w of result.warnings) console.error(`${w}\n`);
  }
  if (result.ok) {
    console.log(
      `Electron architecture check passed (${result.stats.files} files, ${result.stats.edges} import edges, ${result.stats.exceptionsUsed} frozen allow-list exceptions in use, ${result.warnings.length} warning(s)).`,
    );
  } else {
    console.error(`Electron architecture check failed with ${result.errors.length} problem(s).`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Self-tests (fixture graphs)
// ---------------------------------------------------------------------------
function runSelfTests() {
  const scenario = (name, dir, expect, opts = {}) => ({ name, dir, expect, ...opts });
  const scenarios = [
    scenario('allowed/basic', 'scenarios/allowed/basic', 'pass'),
    scenario('forbidden/misc', 'scenarios/forbidden/misc', 'fail', {
      rules: [
        'core-purity',
        'data-purity',
        'main-boundary',
        'renderer-isolation',
        'ui-purity',
        'composition-boundary',
        'observability-port',
        'engine-session',
      ],
      warnRules: ['feature-isolation'],
      dynamic: true,
    }),
    scenario('cycle', 'scenarios/cycle', 'pass', { warnRules: ['feature-cycle'] }),
    scenario('mixed/cycle-and-hard', 'scenarios/mixed/cycle-and-hard', 'fail', {
      rules: ['renderer-isolation'],
      warnRules: ['feature-cycle'],
    }),
    scenario('public-entry', 'scenarios/public-entry', 'fail', { rules: ['public-entry'] }),
    // Proves a permitted core -> contracts edge stays clean while a forbidden
    // contracts -> database edge is caught by contracts-purity.
    scenario('contracts', 'scenarios/contracts', 'fail', { rules: ['contracts-purity'] }),
    scenario('allowlist/covered', 'scenarios/allowlist/covered', 'pass', {
      allowList: [
        {
          from: 'app/renderer/contexts/app-context.tsx',
          to: 'app/renderer/features/observability/metrics-store.ts',
          rules: ['observability-port'],
          reason: 'fixture',
          removedBy: 'fixture',
        },
      ],
    }),
    scenario('allowlist/stale', 'scenarios/allowlist/stale', 'fail', {
      rules: ['allow-list'],
      allowList: [
        {
          from: 'app/renderer/contexts/app-context.tsx',
          to: 'app/renderer/features/observability/metrics-store.ts',
          rules: ['observability-port'],
          reason: 'fixture',
          removedBy: 'fixture',
        },
        {
          from: 'app/renderer/contexts/app-store.ts',
          to: 'app/renderer/features/observability/metrics-store.ts',
          rules: ['observability-port'],
          reason: 'fixture (intentionally unused)',
          removedBy: 'fixture',
        },
      ],
    }),
    // app/application zone (issue #223): composition root may import any
    // zone or package; only the shell and screens may import it back.
    scenario('application/allowed', 'scenarios/application/allowed', 'pass'),
    scenario('application/forbidden', 'scenarios/application/forbidden', 'fail', {
      rules: ['application-boundary'],
    }),
    // npm workspace package rules (issue #223, parent #219).
    scenario('packages/app-boundary', 'scenarios/packages/app-boundary', 'fail', {
      rules: ['package-app-boundary'],
    }),
    scenario('packages/headless-purity', 'scenarios/packages/headless-purity', 'fail', {
      rules: ['package-purity'],
    }),
    // canvas is the sole react/konva-allowed package (issue #219, W9).
    scenario('packages/canvas-react-allowed', 'scenarios/packages/canvas-react-allowed', 'pass'),
    scenario('packages/canvas-electron-still-banned', 'scenarios/packages/canvas-electron-still-banned', 'fail', {
      rules: ['package-purity'],
    }),
    scenario('packages/persistence-renderer', 'scenarios/packages/persistence-renderer', 'fail', {
      rules: ['persistence-purity'],
    }),
    scenario('packages/public-entry', 'scenarios/packages/public-entry', 'fail', {
      rules: ['package-public-entry'],
    }),
    scenario('packages/direction', 'scenarios/packages/direction', 'fail', {
      rules: ['package-dependency-direction'],
    }),
    scenario('packages/cycle', 'scenarios/packages/cycle', 'fail', {
      rules: ['package-cycle'],
    }),
    // Proves the direction table permits the documented edges (kernel <-
    // composition <- application) rather than rejecting everything.
    scenario('packages/allowed', 'scenarios/packages/allowed', 'pass'),
  ];

  let failed = 0;
  for (const s of scenarios) {
    const root = path.join(FIXTURES_ROOT, s.dir);
    const result = check({ rootDir: root, allowList: s.allowList ?? [] });
    const expectOk = s.expect === 'pass';
    const ok = result.ok === expectOk;
    const rulesOk = (s.rules ?? []).every((r) => result.errors.some((m) => m.includes(`[${r}]`)));
    const warnRulesOk = (s.warnRules ?? []).every((r) => result.warnings.some((m) => m.includes(`[${r}]`)));
    const dynamicOk = !s.dynamic || result.errors.some((m) => m.includes('unsupported dynamic'));
    if (ok && rulesOk && warnRulesOk && dynamicOk) {
      console.log(`ok   ${s.name}`);
    } else {
      failed += 1;
      console.error(`FAIL ${s.name}: expected=${s.expect} rules=[${(s.rules ?? []).join(',')}] warnRules=[${(s.warnRules ?? []).join(',')}] dynamic=${!!s.dynamic}`);
      for (const e of result.errors) console.error(`  err:   ${e.split('\n')[0]}`);
      for (const w of result.warnings) console.error(`  warn:  ${w.split('\n')[0]}`);
    }
  }
  if (failed === 0) {
    console.log(`\nAll ${scenarios.length} architecture scenarios passed.`);
  } else {
    console.error(`\n${failed}/${scenarios.length} architecture scenarios failed.`);
  }
  return failed === 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();

export { DEFAULT_ALLOW_LIST, parseImports, zoneOf };
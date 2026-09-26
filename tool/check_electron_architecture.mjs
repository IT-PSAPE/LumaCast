#!/usr/bin/env node

// Deterministic import/command-boundary checker for the committed monorepo
// tree: every application under `apps/<name>/`, the legacy single-app root
// `app/`, and every workspace package under `packages/<name>/` (parent issue
// #117, leaf #156, monorepo migration).
//
// It parses static ES imports/exports only. Unsupported dynamic patterns
// (`import(<non-literal>)`, `require(<non-literal>)`) fail loudly instead of
// being guessed. The file list comes from walking the working tree, so
// uncommitted source is checked too; build output and installed dependencies
// are skipped.
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

// Apps are never addressable as modules. `@renderer`/`@rendering` are
// app-scoped: they resolve to the *importing* app's own tree, so a renderer
// import can never silently reach a sibling app. Everything an app shares with
// another app must be reached through a package under `packages/*`.
const APP_SCOPED_ALIASES = {
  '@renderer': 'renderer',
  '@rendering': 'rendering',
};

// The NDI engine session belongs to the cast app alone. A different app may
// ship a `main/ndi/` directory, but that is ordinary main code: it may not
// touch the native module or the raw host command protocol. The legacy root
// app keeps its own session so migration-time and fixture trees stay covered.
const NDI_ENGINE_SESSION_ROOTS = ['apps/cast/main/ndi', 'app/main/ndi'];
const NDI_PROTOCOL_FILES = new Set([
  'apps/cast/main/ndi/ndi-protocol.ts',
  'app/main/ndi/ndi-protocol.ts',
]);

// Never walked: build output, installed dependencies, and the Playwright
// drivers under an app's `e2e/` (not app source).
const IGNORED_SOURCE_DIRS = new Set(['node_modules', 'out', 'dist', 'e2e']);

const NDI_HOST_COMMAND_EXPORTS = new Set(['NdiHostCommand', 'NdiHostEvent']);

// Packages allowed to import react/react-dom under package-purity (issue
// #219, W9). @lumacast/canvas renders the Konva scene; @lumacast/ui holds
// generic React controls and styling; every other package stays headless.
// konva/react-konva stays exclusive to @lumacast/canvas, and Electron stays
// banned for every package regardless of membership here.
const REACT_ALLOWED_PACKAGES = new Set(['canvas', 'ui']);
const KONVA_ALLOWED_PACKAGES = new Set(['canvas']);

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
  // Shared generic UI: React controls and styling, deliberately independent of
  // any one app's version and build. Kernel only, so the visual layer cannot
  // couple itself to a domain package.
  ui: ['kernel'],
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
    'Only the NDI engine-session boundary (apps/cast/main/ndi and packages/engine) may touch the native module or reference raw NDI host commands; ndi-service-proxy.ts is the sole command writer. No other app has an NDI engine session.',
  'public-entry':
    'Feature imports must go through the feature public entry point when one exists; deep internal imports fail.',
  'allow-list':
    'The frozen architecture allow-list must not grow and every entry must be used.',
  'app-isolation':
    'Apps are self-contained: no app may import another app, whether through a relative path, an app-scoped alias (@renderer, @rendering), or an app module specifier (@lumacast/<app>, @workspace/<app>/…). An app-scoped alias resolves only inside the importing app, and an alias that resolves nowhere is an error rather than a sibling-app fallback. Share code through a package under packages/* instead.',
  'application-boundary':
    'app/application is the composition root: it may import any zone or package, but only the shell and screens may import app/application.',
  'package-app-boundary':
    'No package under packages/* may import application code under apps/* or the legacy app/ root; packages may not depend on any app.',
  'package-purity':
    'A package must not import React, React DOM, Konva, React-Konva, or Electron; packages are headless domain/platform code, except @lumacast/canvas, which may import react/react-dom/konva/react-konva, and @lumacast/ui, which may import react/react-dom but never konva/react-konva (Electron stays banned for both).',
  'persistence-purity':
    'A persistence package must not import renderer code; persistence is process/storage logic and must not depend on the renderer.',
  'package-public-entry':
    'Package imports must go through the package public entry point: src/index.ts (or the index.ts at the package root), plus a stylesheet the export map names explicitly (e.g. @lumacast/ui/theme.css). Naming a second TypeScript file in the export map does not make it public, and no asset is importable from outside a package unless the export map declares it.',
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
    from: 'apps/cast/renderer/components/display/lazy-scene-stage.tsx',
    to: 'apps/cast/renderer/features/canvas/scene-stage.tsx',
    rules: ['ui-purity'],
    reason:
      'SceneStage is a canvas-feature render component consumed by a shared display primitive. Extract the render-only scene layer to shared rendering so shared display components need no feature dependency.',
    removedBy: 'shared scene-layer (plan 0.11, Atlas)',
  },
  {
    from: 'apps/cast/renderer/components/form/doc-sortable-block.tsx',
    to: 'apps/cast/renderer/features/items/lyric-text-utils.ts',
    rules: ['ui-purity'],
    reason:
      'Lyric import text parsing lives in the items feature but is used by a shared doc-sortable form component. Move the parser to app/core so shared form components need no feature dependency.',
    removedBy: 'Atlas (move lyric import parser to app/core)',
  },
  {
    from: 'apps/cast/renderer/features/automation/automation-context.tsx',
    to: 'apps/cast/renderer/features/observability/metrics-store.ts',
    rules: ['observability-port'],
    reason:
      'Automation records telemetry directly into the observability feature and crosses a feature boundary to do so. Route telemetry through an observability port before this can be removed.',
    removedBy: 'observability port (plan 1.3, Atlas)',
  },
  {
    from: 'apps/cast/renderer/contexts/app-context.tsx',
    to: 'apps/cast/renderer/features/observability/metrics-store.ts',
    rules: ['observability-port'],
    reason:
      'App shell wiring records telemetry directly into the observability feature. Route through an observability port before this can be removed.',
    removedBy: 'observability port (plan 1.3, Atlas)',
  },
  {
    from: 'apps/cast/renderer/contexts/app-store.ts',
    to: 'apps/cast/renderer/features/observability/metrics-store.ts',
    rules: ['observability-port'],
    reason:
      'The application store records telemetry directly into the observability feature. Route through an observability port before this can be removed.',
    removedBy: 'observability port (plan 1.3, Atlas)',
  },
  {
    from: 'apps/cast/renderer/contexts/playback/playback-context.tsx',
    to: 'apps/cast/renderer/features/observability/metrics-store.ts',
    rules: ['observability-port'],
    reason:
      'Playback wiring records telemetry directly into the observability feature. Route through an observability port before this can be removed.',
    removedBy: 'observability port (plan 1.3, Atlas)',
  },
];

// ---------------------------------------------------------------------------
// Zones
//
// A path belongs to exactly one app (`apps/<name>/…`, or the legacy root
// `app/…`) or to one package (`packages/<name>/…`), or to neither (repo
// tooling, configs, tests). `zoneOf` reports the within-app or within-package
// zone; `appOf` reports app ownership, which is what the app-isolation rule
// keys on.
// ---------------------------------------------------------------------------
// The legacy single-app root. `app/` is still checked so in-flight migration
// trees and the historical fixture graphs keep their coverage; it behaves
// exactly like an app named for its directory.
const LEGACY_APP_DIR = 'app';
const LEGACY_APP_ID = 'root';

const RENDERER_ZONES = new Set(['screens', 'shell', 'ui', 'contexts', 'hooks', 'rendererOther']);

function isRendererZone(zone) {
  return zone != null && (RENDERER_ZONES.has(zone) || zone.startsWith('feature:'));
}

function isNdiSessionPath(rel) {
  return NDI_ENGINE_SESSION_ROOTS.some((root) => rel === root || rel.startsWith(root + '/'));
}

// `apps/<name>/…` -> { dir: 'apps/<name>', id: '<name>' }; `app/…` -> the
// legacy root app. Returns null for anything that is not app source.
function appOfPath(rel) {
  const p = rel.split('/');
  if (p[0] === 'apps' && p.length >= 2) return { dir: `apps/${p[1]}`, id: p[1] };
  if (p[0] === LEGACY_APP_DIR && p.length >= 2) return { dir: LEGACY_APP_DIR, id: LEGACY_APP_ID };
  return null;
}

function packageOfPath(rel) {
  const p = rel.split('/');
  if (p[0] === 'packages' && p.length >= 2) return p[1];
  return null;
}

// The app id an app-scoped path belongs to, or null for packages and repo
// tooling.
function appOf(rel) {
  const app = appOfPath(rel);
  return app ? app.id : null;
}

function appPrefixOf(rel) {
  const app = appOfPath(rel);
  return app ? app.dir : null;
}

// The directory an app id refers to, for messages that name a whole app.
function appDirOfId(id) {
  return id === LEGACY_APP_ID ? 'app' : `apps/${id}`;
}

function zoneOf(rel) {
  const p = rel.split('/');
  if (p[0] === 'packages' && p.length >= 2) return 'pkg:' + p[1];
  const app = appOfPath(rel);
  if (!app) return null;
  const sec = p[app.dir === 'app' ? 1 : 2];
  if (sec === 'core') return 'core';
  if (sec === 'contracts') return 'contracts';
  if (sec === 'database') return 'data';
  if (sec === 'application') return 'application';
  // main/ndi is the NDI engine session only inside an app that owns one.
  if (sec === 'main') return isNdiSessionPath(rel) ? 'mainNdi' : 'main';
  if (sec === 'renderer') {
    const third = p[app.dir === 'app' ? 2 : 3];
    if (third === 'features') return 'feature:' + p[app.dir === 'app' ? 3 : 4];
    if (third === 'screens') return 'screens';
    if (third === 'components' || third === 'utils' || third === 'types') return 'ui';
    if (third === 'contexts') return 'contexts';
    if (third === 'hooks') return 'hooks';
    // The shell is the composition boundary, whichever extension it is written
    // in: compare the name, not the exact `.tsx` filename.
    if (['App', 'main', 'workbench-screen-router'].includes(third?.replace(/\.(ts|tsx|mjs|js|cjs)$/, ''))) {
      return 'shell';
    }
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
// Classifies a bare specifier by its package name, so a subpath import such as
// `react-dom/client` or `konva/lib/Stage` is judged the same as the package
// root. A scoped package is two segments (`@base-ui/react`), everything else is
// one.
function packageNameOf(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function classifyExternal(spec) {
  if (spec.startsWith('node:')) return 'node';
  const name = packageNameOf(spec);
  if (name === 'electron') return 'electron';
  if (name === 'react' || name === 'react-dom') return 'react';
  if (name === 'konva' || name === 'react-konva') return 'konva';
  if (name === '@lumacast/ndi-native') return 'native';
  return 'other';
}

// Source extensions the checker classifies as code. `.js`/`.cjs` are code too:
// treating them as assets would let a JavaScript file inside an app or a package
// import Electron or another app while every zone rule silently skipped it.
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js', '.cjs']);

function codeOrAsset(hit) {
  return CODE_EXTENSIONS.has(path.extname(hit)) ? 'file' : 'asset';
}

function findExisting(base) {
  const exts = ['', '.ts', '.tsx', '.mjs', '.js', '.cjs', '.css'];
  for (const ext of exts) {
    const cand = base + ext;
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  for (const idx of ['/index.ts', '/index.tsx', '/index.mjs', '/index.js', '/index.cjs']) {
    const cand = base + idx;
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

function readPackageManifest(pkgDir) {
  const manifestPath = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

// Targets named by a manifest field, e.g. `exports["./theme.css"]`.
function collectExportTargets(value, out) {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) collectExportTargets(nested, out);
  }
}

// The public surface of a package: its entry points, as absolute paths. A
// package has exactly one public *source* entry — `src/index.ts`, or `index.ts`
// at the package root — and an export map naming a second TypeScript file does
// not make that file public. The single asset exception is an explicitly
// exported stylesheet (@lumacast/ui/theme.css), which the bundler has to be
// able to import by subpath. check() normalizes rootDir to an absolute path,
// so the cache key and every entry below are absolute and directly comparable
// with a resolved import target.
const SOURCE_ENTRY_REL_PATHS = ['src/index.ts', 'src/index.tsx', 'index.ts', 'index.tsx'];
const publicEntryCache = new Map();
function packagePublicEntries(root, pkgName) {
  const cacheKey = `${root}\u0000${pkgName}`;
  const cached = publicEntryCache.get(cacheKey);
  if (cached) return cached;
  const pkgDir = path.join(path.resolve(root), 'packages', pkgName);
  const entries = new Set();
  const manifest = readPackageManifest(pkgDir);
  if (manifest?.exports) {
    const targets = [];
    collectExportTargets(manifest.exports, targets);
    for (const target of targets) {
      // Only a declared stylesheet counts. A manifest field such as `style`,
      // `sass`, or `unpkg` is not a declaration, and a JS/TS target is code,
      // not an asset: the sole source-entry rule below governs it.
      if (typeof target !== 'string' || !target.startsWith('.') || !target.endsWith('.css')) continue;
      const abs = path.resolve(pkgDir, target);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) entries.add(abs);
    }
  }
  for (const rel of SOURCE_ENTRY_REL_PATHS) {
    const abs = path.join(pkgDir, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) entries.add(abs);
  }
  publicEntryCache.set(cacheKey, entries);
  return entries;
}

// Resolves a subpath through the package's own export map (`'.'` for the root
// entry, `'./theme.css'` for a stylesheet). Returns null when the map does not
// name the subpath, so the caller can fall back to a disk lookup and let
// package-public-entry report the deep import.
function resolveViaExports(pkgDir, manifest, subpath) {
  if (!manifest || manifest.exports == null) return null;
  const key = subpath === '' ? '.' : `./${subpath}`;
  const map = manifest.exports;
  const target = typeof map === 'string' ? (key === '.' ? map : undefined) : map?.[key];
  if (target == null) return null;
  const targets = [];
  collectExportTargets(target, targets);
  for (const t of targets) {
    if (typeof t !== 'string' || !t.startsWith('.')) continue;
    const abs = path.resolve(pkgDir, t);
    if (fs.existsSync(abs)) return { type: codeOrAsset(abs), path: abs };
  }
  return null;
}

// Resolves a bare `@lumacast/<name>` specifier to a file inside
// packages/<name>, mirroring the fixed APP_SCOPED_ALIASES map above but keyed
// off whatever package directories actually exist under packages/ (real or
// fixture). `@lumacast/ndi-native` is excluded: it is the native module,
// already governed by the engine-session rule via classifyExternal, and is
// never resolved to a file. A `@lumacast/<name>` specifier with no matching
// package is not a typo to be tolerated: an app is not a module, so it is
// reported as an app-module specifier.
function resolvePackageAlias(specifier, root) {
  if (!specifier.startsWith('@lumacast/')) return null;
  const rest = specifier.slice('@lumacast/'.length);
  const slashIdx = rest.indexOf('/');
  const pkgName = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
  if (pkgName === 'ndi-native') return null;
  const subpath = slashIdx === -1 ? '' : rest.slice(slashIdx + 1);
  const pkgDir = path.join(root, 'packages', pkgName);
  if (!fs.existsSync(pkgDir)) {
    return { type: 'app-module', specifier, detail: `@lumacast/${pkgName}` };
  }
  const viaExports = resolveViaExports(pkgDir, readPackageManifest(pkgDir), subpath);
  if (viaExports) return viaExports;
  if (subpath === '') {
    const hit = findExisting(path.join(pkgDir, 'src', 'index')) ?? findExisting(path.join(pkgDir, 'index'));
    if (hit) return { type: codeOrAsset(hit), path: hit };
    return { type: 'unresolved', specifier };
  }
  const hit = findExisting(path.join(pkgDir, subpath));
  if (hit) return { type: codeOrAsset(hit), path: hit };
  return { type: 'unresolved', specifier };
}

// An app-scoped alias (`@renderer/…`, `@rendering/…`) resolves inside the
// importing app's own directory and nowhere else. There is deliberately no
// sibling-app fallback: a hit in another app would be a cross-app import, and
// an alias that resolves in neither the importing app nor a package is a
// broken specifier, not a licence to borrow a neighbour's tree. Either way it
// is reported (app-isolation, or package-app-boundary from a package).
function resolveAppScopedAlias(specifier, fromAbs, root) {
  const alias = specifier.split('/')[0];
  const subdir = APP_SCOPED_ALIASES[alias];
  if (!subdir) return null;
  const rest = specifier.slice(alias.length + 1);
  const fromRel = normRel(root, fromAbs);
  const ownApp = appOfPath(fromRel);
  if (!ownApp) return { type: 'app-module', specifier, detail: alias };
  const base = rest
    ? path.resolve(root, ownApp.dir, subdir, rest)
    : path.resolve(root, ownApp.dir, subdir);
  const hit = findExisting(base);
  if (hit) return { type: codeOrAsset(hit), path: hit };
  return { type: 'app-module', specifier, detail: 'unresolved-app-alias' };
}

// `@workspace/<name>/…` is an app module alias in the monorepo. It names an app
// when <name> is not a workspace package, so a new app is covered without the
// checker naming it.
function resolveWorkspaceAppAlias(specifier, root) {
  if (!specifier.startsWith('@workspace/')) return null;
  const rest = specifier.slice('@workspace/'.length);
  const name = rest.split('/')[0];
  if (!name) return null;
  if (fs.existsSync(path.join(root, 'packages', name))) return null;
  return { type: 'app-module', specifier, detail: `@workspace/${name}` };
}

function resolveSpecifier(specifier, fromAbs, root) {
  if (specifier.startsWith('.')) {
    const base = path.resolve(path.dirname(fromAbs), specifier);
    const hit = findExisting(base);
    if (hit) return { type: codeOrAsset(hit), path: hit };
    return { type: 'unresolved', specifier };
  }
  const scoped = resolveAppScopedAlias(specifier, fromAbs, root) ?? resolveWorkspaceAppAlias(specifier, root);
  if (scoped) return scoped;
  const pkgResolved = resolvePackageAlias(specifier, root);
  if (pkgResolved) return pkgResolved;
  return { type: 'external', externalKind: classifyExternal(specifier) };
}

// ---------------------------------------------------------------------------
// Walk + check
// ---------------------------------------------------------------------------

// The source tree, not the committed set: untracked and modified app/package
// source is checked exactly like committed source, so a migration in progress
// cannot pass by being unstaged. Build output, dependencies, and an app's
// Playwright drivers are skipped.
// Every code file the checker walks. `.js`/`.cjs` are included so a JavaScript
// file cannot sit outside the rules by naming itself an asset.
const CODE_FILE_NAME_RE = /\.(ts|tsx|mjs|js|cjs)$/;

// The native addon is governed by the engine-session rule instead: its loader
// is plain CommonJS that requires the built `.node` binary by a path computed
// at runtime, which this checker cannot follow as a static specifier.
const EXEMPT_SOURCE_FILES = new Set(['packages/ndi-native/index.js']);
function isExemptSourceFile(rel) {
  return EXEMPT_SOURCE_FILES.has(rel);
}

function walkFiles(dir, root) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.') || IGNORED_SOURCE_DIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(full, root));
    else if (CODE_FILE_NAME_RE.test(ent.name)) {
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (!isExemptSourceFile(rel)) out.push(rel);
    }
  }
  return out;
}

// Every app root in the tree: `apps/<name>` plus the legacy root `app/`.
function appRoots(rootDir) {
  const roots = [];
  const appsDir = path.join(rootDir, 'apps');
  if (fs.existsSync(appsDir)) {
    for (const ent of fs.readdirSync(appsDir, { withFileTypes: true })) {
      if (!ent.isDirectory() || IGNORED_SOURCE_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
      roots.push(`apps/${ent.name}`);
    }
  }
  if (fs.existsSync(path.join(rootDir, LEGACY_APP_DIR))) roots.push(LEGACY_APP_DIR);
  return roots.sort();
}

function isTestFile(rel) {
  return /\.(test|spec)\.(ts|tsx|mjs|js)$/.test(rel);
}

function normRel(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

export function check(options = {}) {
  // Resolved once, to an absolute path: every path below (the walked files, the
  // resolver, the public-entry cache keys) is then built from the same base, so
  // a relative rootDir cannot produce entries that no resolved import matches.
  const rootDir = path.resolve(options.rootDir ?? REPO_ROOT);
  const allowList = options.allowList ?? DEFAULT_ALLOW_LIST;
  const appsDir = path.join(rootDir, 'apps');
  const legacyAppDir = path.join(rootDir, 'app');
  const packagesDir = path.join(rootDir, 'packages');
  const errors = [];
  const stats = { files: 0, edges: 0, exceptionsUsed: 0, apps: 0 };

  const roots = appRoots(rootDir);
  stats.apps = roots.length;
  const files = [
    ...roots.flatMap((dir) => walkFiles(path.join(rootDir, dir), rootDir)),
    ...walkFiles(packagesDir, rootDir),
  ].filter((rel) => !isTestFile(rel));

  const publicIndexes = new Set();
  for (const rel of files) {
    if (/^(?:apps\/[^/]+\/|app\/)renderer\/features\/[^/]+\/index\.tsx?$/.test(rel)) {
      publicIndexes.add(rel.replace(/\/index\.tsx?$/, ''));
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

  // Feature pairs are scoped to one app: two apps may each contain a `canvas`
  // and a `playback` feature with edges in opposite directions without either
  // app containing a cycle.
  const featurePairs = [];
  for (const e of resolvedEdges) {
    const fromZone = zoneOf(e.from);
    const toRel = e.res.type === 'file' ? normRel(rootDir, e.res.path) : null;
    const toZone = toRel ? zoneOf(toRel) : null;
    if (fromZone?.startsWith('feature:') && toZone?.startsWith('feature:') && fromZone !== toZone && appOf(e.from) === appOf(toRel)) {
      featurePairs.push(`${appOf(e.from)} ${fromZone.slice(8)}->${toZone.slice(8)}`);
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
    const fromApp = appOf(fromRel);
    const fromFeature = fromZone?.startsWith('feature:') ? fromZone.slice(8) : null;
    const res = e.res;
    const line = e.line;
    // An asset (a stylesheet, an image) still has a location, so it participates
    // in the app-isolation and package-public-entry rules. Only the zone rules,
    // which describe code dependencies, stop at `res.type !== 'file'`.
    const toRel = res.type === 'file' || res.type === 'asset' ? normRel(rootDir, res.path) : null;
    const toZone = toRel ? zoneOf(toRel) : null;
    const toApp = toRel ? appOf(toRel) : null;
    const toFeature = toZone?.startsWith('feature:') ? toZone.slice(8) : null;

    const add = (rule, detail) => violations.push({ rule, from: fromRel, line, to: toRel ?? e.specifier, detail });

    // An app is not a module. Naming one — `@lumacast/<app>`,
    // `@workspace/<app>/…`, or an app-scoped alias from outside an app — is
    // reported wherever it appears, including for an app that does not exist
    // yet, so a new app is covered without an exemption.
    if (res.type === 'app-module') {
      if (fromZone?.startsWith('pkg:')) {
        add('package-app-boundary', `imports app code through "${e.specifier}"; packages may not depend on any app`);
      } else if (res.detail === 'unresolved-app-alias') {
        add(
          'app-isolation',
          `imports "${e.specifier}", which resolves only inside the importing app and does not exist there; an app-scoped alias never falls back to a sibling app or a package`,
        );
      } else {
        add('app-isolation', `imports app code through "${e.specifier}" (${res.detail})`);
      }
      continue;
    }

    // Apps are self-contained: nothing in one app may reach into another,
    // however the specifier spells it.
    if (fromApp && toApp && fromApp !== toApp) {
      add('app-isolation', `imports another app (${toApp}) ${toRel}`);
    }

    // A package's public surface is its entry point: `src/index.ts` (or the
    // package-root `index.ts`), plus a stylesheet the export map names. Every
    // other file inside the package is internal, whether the import is code or
    // an asset, so this check runs before the code-only `continue` below.
    if (toZone?.startsWith('pkg:') && !fromRel.startsWith(`packages/${toZone.slice(4)}/`)) {
      const toPkg = toZone.slice(4);
      const entries = packagePublicEntries(rootDir, toPkg);
      if (!entries.has(e.res.path)) {
        const publicList = [...entries]
          .map((abs) => normRel(rootDir, abs))
          .sort()
          .join(', ');
        add(
          'package-public-entry',
          `imports ${toRel}, which is not a public entry point of @lumacast/${toPkg} (public: ${publicList || 'none declared'})`,
        );
      }
    }

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
        add('engine-session', `imports native module ${e.specifier} outside the NDI engine-session boundary (apps/cast/main/ndi or packages/engine)`);
      }
      if (fromZone?.startsWith('pkg:')) {
        const fromPkg = fromZone.slice(4);
        if (k === 'electron' || (k === 'react' && !REACT_ALLOWED_PACKAGES.has(fromPkg))) {
          add('package-purity', `imports ${e.specifier}`);
        }
        if (k === 'konva' && !KONVA_ALLOWED_PACKAGES.has(fromPkg)) {
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
    // Observability is consumed through a port: within one app, only screens,
    // the shell, and the observability feature itself may reference it. A
    // cross-app reference is app-isolation, not a port problem.
    if (toApp && toApp === fromApp) {
      const appPrefix = appPrefixOf(toRel);
      const observabilityPrefix = `${appPrefix}/renderer/features/observability/`;
      if (
        toRel.startsWith(observabilityPrefix) &&
        !fromRel.startsWith(observabilityPrefix) &&
        fromZone !== 'screens' &&
        fromZone !== 'shell'
      ) {
        add('observability-port', `imports observability implementation ${toRel} outside a port`);
      }
    }
    // NdiHostCommand/NdiHostEvent are the main<->utility-process wire
    // protocol. Historically this checked only the literal pre-extraction
    // protocol path; now that the types live in packages/engine
    // (re-exported from its public index.ts), also catch any import whose
    // resolved target is inside that package — covering both a deep import
    // (blocked separately by package-public-entry) and the normal barrel
    // import `from '@lumacast/engine'`. Only the engine session that owns NDI
    // (apps/cast/main/ndi, and the legacy root app's copy) and the package's
    // own internals may reference these names; another app's main/ndi
    // directory has no NDI session of its own.
    if (
      (toRel != null && NDI_PROTOCOL_FILES.has(toRel) || toZone === 'pkg:engine') &&
      fromZone !== 'mainNdi' &&
      fromZone !== 'pkg:engine'
    ) {
      const cmdNames = e.names.filter((n) => NDI_HOST_COMMAND_EXPORTS.has(n));
      if (cmdNames.length > 0) {
        add('engine-session', `references raw NDI host commands (${cmdNames.join(', ')}) outside the NDI engine-session boundary`);
      }
    }
    if (toZone?.startsWith('feature:') && toApp === fromApp) {
      const featurePrefix = `${appPrefixOf(toRel)}/renderer/features/` + toFeature;
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

    // No package may depend on any app (issue #223 / #219): packages are
    // shared below the apps, and app code is not importable from one.
    if (fromZone?.startsWith('pkg:') && ((toZone && !toZone.startsWith('pkg:')) || toApp)) {
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
  }

  for (const key of uniqueFeaturePairs) {
    const [appKey, edge] = key.split(' ');
    const [a, b] = edge.split('->');
    if (hasPair.has(`${appKey} ${b}->${a}`)) {
      const prefix = `${appDirOfId(appKey)}/renderer/features/`;
      violations.push({
        rule: 'feature-cycle',
        from: prefix + a,
        line: 0,
        to: prefix + b,
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
      `Monorepo architecture check passed (${result.stats.apps} app(s), ${result.stats.files} files, ${result.stats.edges} import edges, ${result.stats.exceptionsUsed} frozen allow-list exceptions in use, ${result.warnings.length} warning(s)).`,
    );
  } else {
    console.error(`Monorepo architecture check failed with ${result.errors.length} problem(s).`);
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
    // Monorepo: several apps side by side, each self-contained, sharing only
    // packages.
    scenario('monorepo/apps-allowed', 'scenarios/monorepo/apps-allowed', 'pass'),
    // app-isolation: an app may not reach into another app, however the
    // specifier spells it.
    scenario('monorepo/app-isolation-relative', 'scenarios/monorepo/app-isolation-relative', 'fail', {
      rules: ['app-isolation'],
    }),
    scenario('monorepo/app-isolation-workspace-alias', 'scenarios/monorepo/app-isolation-workspace-alias', 'fail', {
      rules: ['app-isolation'],
    }),
    scenario('monorepo/app-isolation-app-name-alias', 'scenarios/monorepo/app-isolation-app-name-alias', 'fail', {
      rules: ['app-isolation'],
    }),
    scenario('monorepo/app-isolation-renderer-alias', 'scenarios/monorepo/app-isolation-renderer-alias', 'fail', {
      rules: ['app-isolation'],
    }),
    // An app-scoped alias is strict in both directions: it resolves inside the
    // importing app only, and an alias that resolves in no app is still an
    // error rather than a sibling-app or package fallback.
    scenario('monorepo/app-alias-no-sibling-fallback', 'scenarios/monorepo/app-alias-no-sibling-fallback', 'fail', {
      rules: ['app-isolation'],
    }),
    // package-app-boundary, by relative path and by app-scoped alias.
    scenario('monorepo/package-to-app', 'scenarios/monorepo/package-to-app', 'fail', {
      rules: ['package-app-boundary'],
    }),
    // …and by naming an app as a module, for any app in the workspace.
    scenario('monorepo/package-to-app-module-specifier', 'scenarios/monorepo/package-to-app-module-specifier', 'fail', {
      rules: ['package-app-boundary'],
    }),
    // A package's public source entry is src/index.ts and nothing else: an
    // export map naming a second TypeScript file does not publish it, and a
    // stylesheet is public only when `exports` names it (not `style`/`unpkg`).
    scenario('monorepo/package-entry-map-not-public', 'scenarios/monorepo/package-entry-map-not-public', 'fail', {
      rules: ['package-public-entry'],
    }),
    scenario('monorepo/package-asset-not-declared', 'scenarios/monorepo/package-asset-not-declared', 'fail', {
      rules: ['package-public-entry'],
    }),
    // .js/.cjs are code: they are walked and they are classified, so they
    // cannot reach around the renderer and package rules.
    scenario('js-is-code', 'scenarios/js-is-code', 'fail', {
      rules: ['renderer-isolation', 'package-purity'],
    }),
    // Only cast owns an NDI engine session: another app's main/ndi is ordinary
    // main code, and main may not import the renderer.
    scenario('monorepo/noncast-main-renderer', 'scenarios/monorepo/noncast-main-renderer', 'fail', {
      rules: ['main-boundary'],
    }),
    scenario('monorepo/noncast-ndi-forbidden', 'scenarios/monorepo/noncast-ndi-forbidden', 'fail', {
      rules: ['engine-session'],
    }),
    // Feature graphs are per app: opposite one-way edges in two apps are not a
    // cycle, while a genuine cycle inside one app still is.
    scenario('monorepo/feature-graph-per-app', 'scenarios/monorepo/feature-graph-per-app', 'pass', {
      warnRules: ['feature-isolation'],
    }),
    scenario('monorepo/feature-cycle-same-app', 'scenarios/monorepo/feature-cycle-same-app', 'pass', {
      warnRules: ['feature-cycle'],
    }),
    // @lumacast/ui: React allowed, Konva/Electron banned, kernel-only
    // direction, and a stylesheet public only through its export map.
    scenario('monorepo/ui-allowed', 'scenarios/monorepo/ui-allowed', 'pass'),
    scenario('monorepo/ui-forbidden', 'scenarios/monorepo/ui-forbidden', 'fail', {
      rules: ['package-purity', 'package-dependency-direction'],
    }),
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

export { DEFAULT_ALLOW_LIST, appOf, appOfPath, appRoots, parseImports, zoneOf };

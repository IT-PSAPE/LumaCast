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
  '@core': 'app/core',
  '@database': 'app/database',
  '@renderer': 'app/renderer',
  '@rendering': 'app/rendering',
};

const NDI_HOST_COMMAND_EXPORTS = new Set(['NdiHostCommand', 'NdiHostEvent']);

// Rules reported as warning-level "refactor debt" (exit 0) until the feature
// web is refactored, then flipped to hard errors. These are never allow-listed.
const WARNING_RULES = new Set(['feature-isolation', 'feature-cycle']);

const RULE_TITLES = {
  'core-purity':
    'Domain/core policy must not import Electron, React, the renderer, the database, main-process code, native modules, or feature code.',
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
    'Only the NDI engine-session boundary (app/main/ndi) may touch the native module or reference raw NDI host commands; ndi-service-proxy.ts is the sole command writer.',
  'public-entry':
    'Feature imports must go through the feature public entry point when one exists; deep internal imports fail.',
  'allow-list':
    'The frozen architecture allow-list must not grow and every entry must be used.',
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
    from: 'app/renderer/components/display/lazy-scene-stage.tsx',
    to: 'app/renderer/features/canvas/scene-types.ts',
    rules: ['ui-purity'],
    reason:
      'scene-types is the canvas render-scene contract consumed by the shared display primitive. Move the render-scene types to shared rendering together with the scene layer.',
    removedBy: 'shared scene-layer (plan 0.11, Atlas)',
  },
  {
    from: 'app/renderer/components/form/doc-sortable-block.tsx',
    to: 'app/renderer/features/deck/lyric-text-utils.ts',
    rules: ['ui-purity'],
    reason:
      'Lyric import text parsing lives in the deck feature but is used by a shared doc-sortable form component. Move the parser to app/core so shared form components need no feature dependency.',
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
  if (p[0] !== 'app' || p.length < 2) return null;
  const sec = p[1];
  if (sec === 'core') return 'core';
  if (sec === 'database') return 'data';
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
  if (spec === 'react' || spec === 'react-dom') return 'react';
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
  const errors = [];
  const stats = { files: 0, edges: 0, exceptionsUsed: 0 };

  const files = walkFiles(appDir, rootDir)
    .filter((rel) => rel.startsWith('app/') && !rel.startsWith('app/e2e/'))
    .filter((rel) => !isTestFile(rel));

  const publicIndexes = new Set();
  for (const rel of files) {
    if (/^app\/renderer\/features\/[^/]+\/index\.tsx?$/.test(rel)) {
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
      if (fromZone === 'data' && k === 'react') {
        add('data-purity', `imports ${e.specifier}`);
      }
      if (isRendererZone(fromZone) && k === 'electron') {
        add('renderer-isolation', `imports ${e.specifier}`);
      }
      if (k === 'native' && fromZone !== 'mainNdi') {
        add('engine-session', `imports native module ${e.specifier} outside app/main/ndi`);
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
    if (toRel === 'app/main/ndi/ndi-protocol.ts' && fromZone !== 'mainNdi') {
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
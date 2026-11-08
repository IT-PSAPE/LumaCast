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
// All architecture rules fail on violations unless an exact, documented
// exception is in use. Feature dependencies stay directed and cycles are forbidden.

import fs from 'node:fs';
import { isBuiltin } from "node:module";
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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

// Cast owns its NDI engine session under the existing directory boundary. The
// Stream app has a separate UtilityProcess adapter, so only its host and host
// runtime files are NDI boundary code. The main proxy may name host commands,
// but only the runtime wrapper loads the native package. The legacy root app
// keeps its own session so migration-time and fixture trees stay covered.
const NDI_ENGINE_SESSION_ROOTS = ['apps/cast/main/ndi', 'app/main/ndi'];
const NDI_PROTOCOL_FILES = new Set([
  'apps/cast/main/ndi/ndi-protocol.ts',
  'app/main/ndi/ndi-protocol.ts',
  'apps/stream/main/ndi-host-protocol.ts',
]);
const NDI_STREAM_HOST_FILES = new Set([
  'apps/stream/main/ndi-host.ts',
  'apps/stream/main/ndi-host-runtime.ts',
]);
const NDI_STREAM_NATIVE_FILES = new Set(['apps/stream/main/ndi-host-runtime.ts']);
const NDI_STREAM_COMMAND_FILES = new Set([
  ...NDI_STREAM_HOST_FILES,
  'apps/stream/main/ndi-bridge.ts',
]);

// Never walked: build output, installed dependencies, and the Playwright
// drivers under an app's `e2e/` (not app source).
const IGNORED_SOURCE_DIRS = new Set(['node_modules', 'out', 'dist', 'e2e']);

const NDI_HOST_COMMAND_EXPORTS = new Set(['NdiHostCommand', 'NdiHostEvent']);

// Packages allowed to import react/react-dom under package-purity (issue
// #219, W9). @lumacast/canvas renders the Konva scene; @lumacast/ui holds
// generic React controls and styling; @lumacast/selection holds shared React
// selection hooks and domain-agnostic selection primitives.
// konva/react-konva stays exclusive to @lumacast/canvas, and Electron stays
// banned for every package regardless of membership here.
const REACT_ALLOWED_PACKAGES = new Set(['canvas', 'selection', 'ui']);
const KONVA_ALLOWED_PACKAGES = new Set(['canvas']);
// @lumacast/desktop is the main-process window helper package; it is the one
// package that may import Electron.
const ELECTRON_ALLOWED_PACKAGES = new Set(['desktop']);

// The Flux photo packages split into a renderer-safe domain model and two
// Node-side packages. `photo-imaging` decodes, resizes and encodes image bytes
// and `photo-library` owns the indexed, on-disk photo library; both are process
// and filesystem code. A renderer in *any* app may depend on `photo-model` (and
// on the shared `@lumacast/ui` primitives) but never on these two, whatever the
// specifier or the file it resolves to. Image work happens in main and reaches
// the renderer as data over the typed IPC contract.
const PHOTO_RENDERER_SAFE_PACKAGES = new Set(["photo-model"]);
const PHOTO_RENDERER_BANNED_PACKAGES = new Set([
  "photo-imaging",
  "photo-library",
]);

// Renderer imports must opt into a package only when its public API is safe to
// load in a Chromium process. Packages with Electron, Node, native, or
// persistence capabilities stay on the main side and are reached over IPC.
const RENDERER_ALLOWED_PACKAGES = new Set([
  'automation',
  'canvas',
  'commands',
  'composition',
  'kernel',
  'markers',
  'photo-model',
  'playback',
  'protocol',
  'selection',
  'suite',
  'ui',
]);

// ---------------------------------------------------------------------------
// Package graph (issue #223, parent #219). npm workspace packages live under
// packages/*. The table below is the dependency direction #219 recorded for the
// packages planned in the sweep; it is deliberately a default-deny allow
// list so a new package name with no entry starts with zero permitted
// dependencies rather than silently inheriting access.
// ---------------------------------------------------------------------------
const PACKAGE_DEPENDENCY_DIRECTIONS = {
  // Everything may depend on kernel; it depends on nothing.
  kernel: [],
  composition: ['kernel'],
  canvas: ['kernel', 'composition', 'protocol', 'selection'],
  // Shared collection-selection primitives and React hooks are domain-agnostic.
  selection: [],
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
  // The LumaCast suite model LumaCloud manages the other apps with: the app
  // registry and identities, version rules, release-catalog parsing, and
  // app-state derivation. Kernel only, and renderer-safe (no Node builtins), so
  // the Cloud renderer and main can share one reading of the catalog.
  suite: ['kernel'],
  // Timed lyric-cue interchange (CSV/LRC/SRT) shared by LumaCast (records
  // audio-sync markers) and LumaChord (imports/exports a lyric video).
  markers: ['kernel'],
  // Main-process window helpers (chrome options, createAppWindow). Shares window-chrome constants with renderers via kernel.
  desktop: ['kernel'],
  // The approved Flux photo packages. They form a strict one-way stack above
  // kernel: the pure photo domain model, the imaging/derivation layer that
  // reads and transforms image bytes, and the library layer that owns the
  // on-disk/indexed library. A renderer may consume the domain model but never
  // the two Node-side packages (see PHOTO_RENDERER_BANNED_PACKAGES), so the
  // renderer/Node split is part of the recorded direction, not an app-local
  // convention. No React or Electron in any of them: package-purity already bans
  // both for every package outside REACT_ALLOWED_PACKAGES/KONVA_ALLOWED_PACKAGES,
  // and none of these names is added to either set.
  "photo-model": ["kernel"],
  "photo-imaging": ["kernel", "photo-model"],
  "photo-library": ["kernel", "photo-model", "photo-imaging"],
  // The native NDI addon (@lumacast/ndi-native) is not a dependency-direction
  // entry here — it is resolved via classifyExternal's 'native' kind, not a
  // pkg:* zone, and is governed by the engine-session rule below instead.
  // Listed for documentation parity with issue #219's target map.
  engine: ['kernel', 'composition', 'protocol', 'ndi-native'],
};

// Feature edges/cycles are structural rules, not transitional exceptions.
const NEVER_ALLOW_LISTABLE_RULES = new Set([
  'feature-isolation',
  'feature-cycle',
  'context-purity',
  'hooks-purity',
  'renderer-shared-purity',
  'renderer-other-purity',
  'renderer-composition-purity',
  'app-other-boundary',
  'runtime-purity',
  'renderer-package-boundary',
  'public-entry',
]);

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
    'The renderer must not import Electron, Node builtins, main-process modules, or the database; it reaches main only through the typed IPC contract.',
  'renderer-package-boundary':
    'Renderer code may import only packages explicitly approved for Chromium; Node, native, Electron, and persistence packages stay in the main process.',
  'ui-purity':
    'UI and shared rendering primitives (components, utils, types, rendering) must not import feature implementations.',
  'context-purity':
    'Renderer contexts are shared state contracts and providers; they must not import feature implementations. Compose feature behavior at screens or the application root.',
  'hooks-purity':
    'App-wide renderer hooks must not import feature implementations; compose feature behavior in screens, shell, or the application root.',
  'renderer-shared-purity':
    'Shared renderer modules may be consumed by features, but must not import feature implementations.',
  'renderer-other-purity':
    'Unclassified renderer helpers must not import features, screens, or the shell; move composition into a declared screen, shell, or application module.',
  'renderer-composition-purity':
    'Reusable renderer layers (UI, contexts, hooks, and shared helpers) must not import screens or the shell; composition flows from those layers toward screens and the application root.',
  'app-other-boundary':
    'App-owned source must belong to an explicit architectural zone; unclassified app files cannot import from or be imported by main, data, or renderer code.',
  'runtime-purity':
    'Shared renderer runtime services may be consumed by contexts and features, but must not import renderer UI, state, or feature implementations.',
  'feature-isolation':
    'A feature must not import another feature; screens and the shell compose independent features.',
  'feature-cycle':
    'Bidirectional feature dependencies are forbidden; cycles must be removed, not allow-listed.',
  'composition-boundary':
    'Features must not import screens or the application shell; screens and renderer/shell are the composition boundaries.',
  'observability-port':
    'Observability is consumed through a port; only screens, the shell, and the observability feature itself may reference it directly.',
  'engine-session':
    'Only the NDI engine-session boundaries may touch the native module or reference raw NDI host commands: apps/cast/main/ndi and packages/engine, plus Stream’s exact utility host files and main proxy. Stream’s ndi-host-runtime.ts alone may load the native module; other Stream main code may not.',
  'public-entry':
    'Every feature consumed outside its own directory must expose an index.ts public entry point, and external consumers must import only from that entry point.',
  'allow-list':
    'The frozen architecture allow-list must not grow and every entry must be used.',
  'app-isolation':
    'Apps are self-contained: no app may import another app, whether through a relative path, an app-scoped alias (@renderer, @rendering), or an app module specifier (@lumacast/<app>, @workspace/<app>/…). An app-scoped alias resolves only inside the importing app, and an alias that resolves nowhere is an error rather than a sibling-app fallback. Share code through a package under packages/* instead.',
  'application-boundary':
    'app/application is the composition root: it may import any zone or package, but only the shell and screens may import app/application.',
  'package-app-boundary':
    'No package under packages/* may import application code under apps/* or the legacy app/ root; packages may not depend on any app.',
  'package-purity':
    'A package must not import React, React DOM, Konva, React-Konva, or Electron; packages are headless domain/platform code, except @lumacast/canvas, which may import react/react-dom/konva/react-konva, and @lumacast/ui and @lumacast/selection, which may import react/react-dom but never konva/react-konva (Electron stays banned for all three).',
  'persistence-purity':
    'A persistence package must not import renderer code; persistence is process/storage logic and must not depend on the renderer.',
  'package-public-entry':
    'Package imports must go through the package public entry point: src/index.ts (or the index.ts at the package root), plus a stylesheet the export map names explicitly (e.g. @lumacast/ui/theme.css). Naming a second TypeScript file in the export map does not make it public, and no asset is importable from outside a package unless the export map declares it.',
  'package-dependency-direction':
    'Packages may only depend on other packages in the direction recorded in issue #219; this edge is not on that list.',
  'package-cycle':
    'Cycles between packages are forbidden and must be removed, never allow-listed.',
  "photo-renderer-boundary":
    "A renderer may not import the Node-side Flux photo packages: photo-imaging (image decode/encode) and photo-library (indexed on-disk library) are process and filesystem code. A renderer consumes the photo domain model (@lumacast/photo-model) and shared UI primitives, and reaches image work over the typed IPC contract.",
  "shared-contract":
    "An app shared/ directory holds the app's explicit typed IPC contract modules (e.g. apps/flux/shared DesktopAPI). It is a contract boundary: main and renderer may both import it, but it must not import main, renderer, feature, or database code, and it must stay process-neutral — no Node builtins, no Electron, and none of the Node-side Flux photo packages, directly or by naming them.",
};

// ---------------------------------------------------------------------------
// Allow-list (the "rule file"). Each entry is an exact edge that is currently
// permitted, why it exists, and who owns removing it. The checker fails if an
// entry is no longer exercised by the tree, forcing the list to shrink.
// ---------------------------------------------------------------------------
const DEFAULT_ALLOW_LIST = [];

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

const RENDERER_ZONES = new Set(['screens', 'shell', 'ui', 'contexts', 'hooks', 'rendererOther', 'rendererShared', 'runtime']);

function isRendererZone(zone) {
  return zone != null && (RENDERER_ZONES.has(zone) || zone.startsWith('feature:'));
}

function isNdiSessionPath(rel) {
  return NDI_ENGINE_SESSION_ROOTS.some((root) => rel === root || rel.startsWith(root + '/'))
    || NDI_STREAM_HOST_FILES.has(rel);
}

function canImportNdiNative(rel, zone) {
  if (zone === 'pkg:engine') return true;
  if (rel.startsWith('apps/stream/main/')) return NDI_STREAM_NATIVE_FILES.has(rel);
  return zone === 'mainNdi';
}

function canReferenceNdiHostCommands(rel, zone) {
  return zone === 'mainNdi' || zone === 'pkg:engine' || NDI_STREAM_COMMAND_FILES.has(rel);
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
  // An app-owned `shared/` directory holds the app's explicit typed IPC
  // contract modules — the one surface main and renderer are meant to meet on
  // (apps/flux/shared DesktopAPI). It is neither process code nor UI: it is the
  // contract both sides depend on, governed by shared-contract below.
  if (sec === "shared") return "shared";
  // main/ndi is the NDI engine session only inside an app that owns one.
  if (sec === 'main') return isNdiSessionPath(rel) ? 'mainNdi' : 'main';
  if (sec === 'renderer') {
    const third = p[app.dir === 'app' ? 2 : 3];
    if (third === 'features') return 'feature:' + p[app.dir === 'app' ? 3 : 4];
    if (third === 'screens') return 'screens';
    if (third === 'shell' || third === 'application' || third === 'docks' || third === 'dialogs' || third === 'chrome') return 'shell';
    if (third === 'components' || third === 'utils' || third === 'types' || third === 'rendering') return 'ui';
    if (third === 'contexts') return 'contexts';
    if (third === 'hooks') return 'hooks';
    if (third === 'runtime') return 'runtime';
    if (third === 'shared') return 'rendererShared';
    // The shell is the composition boundary, whichever extension it is written
    // in: compare the name, not the exact `.tsx` filename.
    const sourceName = third && CODE_EXTENSIONS.has(path.extname(third))
      ? path.basename(third, path.extname(third))
      : third;
    if (['App', 'main', 'workbench-screen-router'].includes(sourceName)) {
      return 'shell';
    }
    return 'rendererOther';
  }
  return 'appOther';
}

// ---------------------------------------------------------------------------
// Static import/export scanner
// ---------------------------------------------------------------------------
function importedNames(clause) {
  if (!clause) return ['*'];
  const names = [];
  if (clause.name) names.push('default');
  if (clause.namedBindings) {
    if (ts.isNamespaceImport(clause.namedBindings)) names.push('*');
    else {
      names.push(...clause.namedBindings.elements.map((element) => element.propertyName?.text ?? element.name.text));
    }
  }
  return names.length > 0 ? names : ['*'];
}

function exportedNames(clause) {
  if (!clause || ts.isNamespaceExport(clause)) return ['*'];
  return clause.elements.map((element) => element.propertyName?.text ?? element.name.text);
}

function parseImports(source, fileName = 'architecture-check.tsx') {
  // Use the TypeScript parser rather than a handwritten tokenizer so syntax
  // nested in template interpolation, JSX expressions, comments, and strings
  // is distinguished by the language grammar.
  // Infer the grammar from the source filename: parsing ordinary TypeScript as
  // TSX can swallow imports after an angle-bracket type assertion as JSX text.
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const edges = [];
  const dynamicErrors = [];
  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const addLiteralEdge = (kind, specifier, names, node) => {
    edges.push({ kind, specifier: specifier.text, names, line: lineOf(node) });
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      addLiteralEdge('import', node.moduleSpecifier, importedNames(node.importClause), node);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      addLiteralEdge('export', node.moduleSpecifier, exportedNames(node.exportClause), node);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const argument = node.moduleReference.expression;
      if (argument && ts.isStringLiteral(argument)) {
        addLiteralEdge('require', argument, ['*'], node);
      } else {
        dynamicErrors.push({ kind: 'require', line: lineOf(node), detail: 'non-literal argument' });
      }
    } else if (ts.isImportTypeNode(node)) {
      // `import('module').Type` and `typeof import('module')` express the
      // same architectural dependency as an import-type declaration.
      const argument = ts.isLiteralTypeNode(node.argument) ? node.argument.literal : null;
      if (argument && ts.isStringLiteral(argument)) {
        let qualifier = node.qualifier;
        while (qualifier && ts.isQualifiedName(qualifier)) qualifier = qualifier.left;
        addLiteralEdge('import', argument, qualifier ? [qualifier.text] : ['*'], node);
      } else {
        dynamicErrors.push({ kind: 'import', line: lineOf(node), detail: 'non-literal argument' });
      }
    } else if (ts.isCallExpression(node)) {
      const kind = node.expression.kind === ts.SyntaxKind.ImportKeyword
        ? 'import'
        : ts.isIdentifier(node.expression) && node.expression.text === 'require'
          ? 'require'
          : null;
      if (kind) {
        const [argument, ...extraArguments] = node.arguments;
        if (argument && ts.isStringLiteral(argument) && extraArguments.length === 0) {
          addLiteralEdge(kind, argument, ['*'], node);
        } else {
          dynamicErrors.push({ kind, line: lineOf(node), detail: 'non-literal argument' });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { edges, dynamicErrors };
}

// ---------------------------------------------------------------------------
// Specifier resolution
// ---------------------------------------------------------------------------

// The Node-side photo package a specifier names, whether it resolves to a file
// or not. A renderer that imports `@lumacast/photo-imaging` is denied whether
// the package is present (it resolves to a file, so the file's package zone
// gives the name), only its subpath is missing (unresolved), or the package is
// not there at all (an app-module specifier) — the name is judged either way,
// so the rule cannot be dodged by choosing a specifier that fails to resolve.
//
// The name must be scoped to `@lumacast/`: an unrelated third-party package
// that happens to be called `photo-imaging` is not our Node-side imaging layer
// and is left to the ordinary external rules. A relative import is judged by
// the file it resolves to, so a relative path that reaches into a photo package
// is covered by the first branch.
function bannedPhotoPackageName(res, toZone, specifier) {
  if (toZone?.startsWith("pkg:")) {
    const pkg = toZone.slice(4);
    return PHOTO_RENDERER_BANNED_PACKAGES.has(pkg) ? pkg : null;
  }
  let name = null;
  if (
    res.type === "app-module" &&
    typeof res.detail === "string" &&
    res.detail.startsWith("@lumacast/")
  ) {
    name = res.detail;
  } else if (res.type === "unresolved" || res.type === "external") {
    const pkg = packageNameOf(specifier);
    if (pkg.startsWith("@lumacast/")) name = pkg;
  }
  if (!name) return null;
  const pkg = name.slice("@lumacast/".length);
  return PHOTO_RENDERER_BANNED_PACKAGES.has(pkg) ? pkg : null;
}

function rendererPackageName(res, toZone, specifier) {
  if (toZone?.startsWith('pkg:')) return toZone.slice(4);
  if (res.type !== 'external' && res.type !== 'unresolved' && res.type !== 'app-module') return null;
  const packageName = packageNameOf(specifier);
  return packageName.startsWith('@lumacast/') ? packageName.slice('@lumacast/'.length) : null;
}

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
  // `import fs from "fs"` names the same builtin as `node:fs`, so an
  // unprefixed specifier must reach the same rules rather than fall through to
  // "other" and escape the Node-builtin denials.
  if (isBuiltin(spec)) return "node";
  if (name === 'electron') return 'electron';
  if (name === 'react' || name === 'react-dom') return 'react';
  if (name === 'konva' || name === 'react-konva') return 'konva';
  if (name === '@lumacast/ndi-native') return 'native';
  return 'other';
}

// One extension set governs source discovery, import resolution, and code/asset
// classification. No supported JavaScript/TypeScript form can bypass a zone rule
// by being skipped or mistaken for an asset.
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js', '.cjs', '.mts', '.cts', '.jsx']);
const SOURCE_EXTENSIONS_BY_OUTPUT = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

function codeOrAsset(hit) {
  return CODE_EXTENSIONS.has(path.extname(hit)) ? 'file' : 'asset';
}

function findExisting(base) {
  const extension = path.extname(base);
  // Source TypeScript may name the emitted JavaScript extension. Resolve that
  // edge to its source too, rather than silently skipping its boundary checks.
  const counterparts = (SOURCE_EXTENSIONS_BY_OUTPUT[extension] ?? [])
    .map((ext) => base.slice(0, -extension.length) + ext);
  const appended = CODE_EXTENSIONS.has(extension) ? [] : [...CODE_EXTENSIONS, '.css'].map((ext) => base + ext);
  const candidates = [base, ...counterparts, ...appended, ...[...CODE_EXTENSIONS].map((ext) => path.join(base, `index${ext}`))];
  for (const cand of candidates) {
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
// Use CODE_EXTENSIONS for walking and resolution so a supported source form
// cannot be checked as an importer but silently treated as an asset target.

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
    else if (CODE_EXTENSIONS.has(path.extname(ent.name))) {
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
    const { edges, dynamicErrors } = parseImports(source, rel);
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

    const namedRendererPackage = rendererPackageName(res, toZone, e.specifier);
    if (isRendererZone(fromZone) && namedRendererPackage && !RENDERER_ALLOWED_PACKAGES.has(namedRendererPackage)) {
      add(
        'renderer-package-boundary',
        `imports @lumacast/${namedRendererPackage}, which is not approved for Chromium; renderer-safe packages are ${[...RENDERER_ALLOWED_PACKAGES].map((name) => `@lumacast/${name}`).join(', ')}`,
      );
    }

    // Two rules have to see a specifier that does not resolve to a file — the
    // `continue`s below for an app-module and an external specifier would
    // otherwise skip them — so both run first and judge the package a specifier
    // names as well as the file it resolves to.
    //
    // 1. The renderer/Node split of the Flux photo stack, enforced for every
    //    app: the renderer may hold the photo domain model, never the
    //    image-processing or library packages.
    // 2. An app's shared/ directory is the explicit typed IPC contract surface
    //    (apps/flux/shared DesktopAPI). Main and renderer may both import it;
    //    it may not depend on either side, nor on the database, a feature, or
    //    the Node-side photo packages. The contract describes the wire, not
    //    either implementation of it, so it stays process-neutral: a contract
    //    that reaches `node:fs` or Electron would drag one side's runtime into
    //    the other the moment the other side imports it.
    const namedPhotoPkg = bannedPhotoPackageName(res, toZone, e.specifier);
    if (isRendererZone(fromZone) && namedPhotoPkg) {
      add(
        "photo-renderer-boundary",
        `imports @lumacast/${namedPhotoPkg}, a Node-side photo package; a renderer may only import ${[...PHOTO_RENDERER_SAFE_PACKAGES].map((p) => `@lumacast/${p}`).join(", ")} and shared UI, and reaches image work over the typed IPC contract`,
      );
    }
    if (fromZone === "shared") {
      if (namedPhotoPkg) {
        add(
          "shared-contract",
          `imports @lumacast/${namedPhotoPkg}, a Node-side photo package; the contract is reached by both processes, so image work crosses it as data over the typed IPC contract`,
        );
      }
      if (
        res.type === "external" &&
        (res.externalKind === "node" || res.externalKind === "electron")
      ) {
        add(
          "shared-contract",
          `imports ${e.specifier}, a ${res.externalKind === "node" ? "Node builtin" : "process-runtime module"}; a contract module must stay usable from both the main and renderer processes`,
        );
      }
    }

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
      if (isRendererZone(fromZone) && (k === 'electron' || k === 'node')) {
        add('renderer-isolation', `imports ${e.specifier}`);
      }
      if (k === 'native' && !canImportNdiNative(fromRel, fromZone)) {
        add('engine-session', `imports native module ${e.specifier} outside the NDI native boundary`);
      }
      if (fromZone?.startsWith('pkg:')) {
        const fromPkg = fromZone.slice(4);
        if ((k === 'electron' && !ELECTRON_ALLOWED_PACKAGES.has(fromPkg)) || (k === 'react' && !REACT_ALLOWED_PACKAGES.has(fromPkg))) {
          add('package-purity', `imports ${e.specifier}`);
        }
        if (k === 'konva' && !KONVA_ALLOWED_PACKAGES.has(fromPkg)) {
          add('package-purity', `imports ${e.specifier}`);
        }
        // Check every module of every renderer-approved package, including
        // internal/transitive dependencies reached through a public barrel.
        if (k === "node" && RENDERER_ALLOWED_PACKAGES.has(fromPkg)) {
          add(
            "package-purity",
            `imports ${e.specifier}, a Node builtin; @lumacast/${fromPkg} is renderer-safe and may not depend on a Node runtime`,
          );
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
    // The file half of shared-contract: the side-specific code and the
    // composition root, which the early guard above cannot see because these
    // targets do resolve to files. A shared module in another app is
    // app-isolation, not a contract problem, so the rule is scoped to the
    // importing app's own shared directory.
    if (fromZone === "shared" && toApp === fromApp) {
      if (isRendererZone(toZone))
        add("shared-contract", `imports renderer code ${toRel}`);
      else if (
        toZone === "main" ||
        toZone === "mainNdi" ||
        toZone === "data" ||
        toZone === "application" ||
        toZone?.startsWith("feature:")
      ) {
        add(
          "shared-contract",
          `imports ${toZone.startsWith("feature:") ? "feature" : toZone} code ${toRel}`,
        );
      }
    }
    if ((fromZone === 'main' || fromZone === 'mainNdi') && isRendererZone(toZone)) {
      add('main-boundary', `imports renderer code ${toRel}`);
    }
    if (
      fromApp && fromApp === toApp &&
      ((fromZone === 'appOther' && toZone !== 'appOther') || (toZone === 'appOther' && fromZone !== 'appOther'))
    ) {
      add('app-other-boundary', `crosses into or out of unclassified app code ${toRel}`);
    }
    if (isRendererZone(fromZone)) {
      if (toZone === 'main' || toZone === 'mainNdi') add('renderer-isolation', `imports main-process code ${toRel}`);
      if (toZone === 'data') add('renderer-isolation', `imports database code ${toRel}`);
    }
    if (fromZone === 'ui' && toZone?.startsWith('feature:')) {
      add('ui-purity', `imports feature code ${toRel}`);
    }
    if (fromZone === 'contexts' && toZone?.startsWith('feature:') && fromApp === toApp) {
      add('context-purity', `imports feature code ${toRel}`);
    }
    if (fromZone === 'hooks' && toZone?.startsWith('feature:') && fromApp === toApp) {
      add('hooks-purity', `imports feature code ${toRel}`);
    }
    if (
      fromZone === 'rendererShared' && toZone?.startsWith('feature:') && fromApp === toApp
    ) {
      add('renderer-shared-purity', `imports feature code ${toRel}`);
    }
    if (
      fromZone === 'rendererOther' && fromApp === toApp &&
      (toZone?.startsWith('feature:') || toZone === 'screens' || toZone === 'shell')
    ) {
      add('renderer-other-purity', `imports composition code ${toRel}`);
    }
    if (
      (fromZone === 'ui' || fromZone === 'contexts' || fromZone === 'hooks' || fromZone === 'rendererShared') &&
      fromApp === toApp && (toZone === 'screens' || toZone === 'shell')
    ) {
      add('renderer-composition-purity', `imports composition code ${toRel}`);
    }
    if (
      fromZone === 'runtime' && fromApp === toApp &&
      (toZone === 'contexts' || toZone === 'hooks' || toZone === 'ui' || toZone === 'screens' || toZone === 'shell' || toZone === 'rendererOther' || toZone?.startsWith('feature:'))
    ) {
      add('runtime-purity', `imports renderer state, UI, or feature code ${toRel}`);
    }
    if (fromZone?.startsWith('feature:') && toZone?.startsWith('feature:') && fromFeature !== toFeature) {
      add('feature-isolation', `imports another feature ${toRel}`);
    }
    if (fromZone?.startsWith('feature:') && (toZone === 'screens' || toZone === 'shell')) {
      add('composition-boundary', `imports composition code ${toRel}`);
    }
    // Observability is consumed through a port: within one app, only screens,
    // shell/application composition and the observability feature may reference it. A
    // cross-app reference is app-isolation, not a port problem.
    if (toApp && toApp === fromApp) {
      const appPrefix = appPrefixOf(toRel);
      const observabilityPrefix = `${appPrefix}/renderer/features/observability/`;
      if (
        toRel.startsWith(observabilityPrefix) &&
        !fromRel.startsWith(observabilityPrefix) &&
        fromZone !== 'screens' &&
        fromZone !== 'shell' &&
        fromZone !== 'application'
      ) {
        add('observability-port', `imports observability implementation ${toRel} outside a port`);
      }
    }
    // NdiHostCommand/NdiHostEvent are the main<->utility-process wire
    // protocol. Types also live in packages/engine (re-exported from its
    // public index.ts), so catch both deep imports and the normal barrel. The
    // Stream UtilityProcess host has its own exact host/protocol boundary;
    // another Stream main file still cannot reference these raw commands.
    if (
      (toRel != null && NDI_PROTOCOL_FILES.has(toRel) || toZone === 'pkg:engine') &&
      !canReferenceNdiHostCommands(fromRel, fromZone)
    ) {
      const cmdNames = e.names.filter((n) => NDI_HOST_COMMAND_EXPORTS.has(n));
      if (cmdNames.length > 0) {
        add('engine-session', `references raw NDI host commands (${cmdNames.join(', ')}) outside the NDI engine-session boundary`);
      }
    }
    if (toZone?.startsWith('feature:') && toApp === fromApp && !fromZone?.startsWith('feature:')) {
      const featurePrefix = `${appPrefixOf(toRel)}/renderer/features/` + toFeature;
      const hasIndex = publicIndexes.has(featurePrefix);
      const isPublicEntry = toRel === featurePrefix + '/index.ts' || toRel === featurePrefix + '/index.tsx';
      if (!hasIndex) {
        add('public-entry', `consumes feature ${toFeature} without its required public entry point ${featurePrefix}/index.ts`);
      } else if (!isPublicEntry) {
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
  for (const v of violations) {
    if (NEVER_ALLOW_LISTABLE_RULES.has(v.rule)) {
      errors.push(
        `${v.from}:${v.line} [${v.rule}] ${v.detail}\n    ${RULE_TITLES[v.rule]}\n    Feature boundaries and cycles cannot be covered by the frozen allow-list.`,
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
  return { ok: errors.length === 0, errors, stats, violations, used };
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
  if (result.ok) {
    console.log(
      `Monorepo architecture check passed (${result.stats.apps} app(s), ${result.stats.files} files, ${result.stats.edges} import edges, ${result.stats.exceptionsUsed} frozen allow-list exceptions in use).`,
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
        'context-purity',
        'public-entry',
        'feature-isolation',
      ],
      dynamic: true,
    }),
    scenario('cycle', 'scenarios/cycle', 'fail', { rules: ['feature-isolation', 'feature-cycle'] }),
    scenario('feature-edge-not-allow-listable', 'scenarios/cycle', 'fail', {
      rules: ['feature-isolation', 'feature-cycle'],
      allowList: [
        {
          from: 'app/renderer/features/a/a.ts',
          to: 'app/renderer/features/b/b.ts',
          rules: ['feature-isolation'],
          reason: 'fixture',
          removedBy: 'fixture',
        },
      ],
    }),
    scenario('renderer-shell-boundary', 'scenarios/renderer-shell-boundary', 'fail', {
      rules: ['composition-boundary'],
    }),
    scenario('renderer-application-boundary', 'scenarios/renderer-application-boundary', 'fail', {
      rules: ['composition-boundary'],
    }),
    scenario('renderer-rendering-boundary', 'scenarios/renderer-rendering-boundary', 'fail', {
      rules: ['ui-purity'],
    }),
    scenario('renderer-hook-boundary', 'scenarios/renderer-hook-boundary', 'fail', {
      rules: ['hooks-purity'],
    }),
    scenario('hook-edge-not-allow-listable', 'scenarios/renderer-hook-boundary', 'fail', {
      rules: ['hooks-purity'],
      allowList: [
        {
          from: 'app/renderer/hooks/use-shortcuts.ts',
          to: 'app/renderer/features/items/index.ts',
          rules: ['hooks-purity'],
          reason: 'fixture',
          removedBy: 'fixture',
        },
      ],
    }),
    scenario('renderer-shared-boundary', 'scenarios/renderer-shared-boundary', 'fail', {
      rules: ['renderer-shared-purity'],
    }),
    scenario('renderer-other-boundary', 'scenarios/renderer-other-boundary', 'fail', {
      rules: ['renderer-other-purity'],
    }),
    scenario('renderer-composition-boundary', 'scenarios/renderer-composition-boundary', 'fail', {
      rules: ['renderer-composition-purity'],
    }),
    scenario('unclassified-app-boundary', 'scenarios/unclassified-app-boundary', 'fail', {
      rules: ['app-other-boundary'],
    }),
    scenario('shared-renderer-edge-not-allow-listable', 'scenarios/renderer-shared-boundary', 'fail', {
      rules: ['renderer-shared-purity'],
      allowList: [
        {
          from: 'app/renderer/shared/source-factory.ts',
          to: 'app/renderer/features/capture/index.ts',
          rules: ['renderer-shared-purity'],
          reason: 'fixture',
          removedBy: 'fixture',
        },
      ],
    }),
    scenario('renderer-runtime-boundary', 'scenarios/renderer-runtime-boundary', 'fail', {
      rules: ['runtime-purity'],
    }),
    scenario('runtime-edge-not-allow-listable', 'scenarios/renderer-runtime-boundary', 'fail', {
      rules: ['runtime-purity'],
      allowList: [
        {
          from: 'app/renderer/runtime/audio-runtime.ts',
          to: 'app/renderer/contexts/app-context.ts',
          rules: ['runtime-purity'],
          reason: 'fixture',
          removedBy: 'fixture',
        },
      ],
    }),
    scenario('renderer-context-boundary', 'scenarios/renderer-context-boundary', 'fail', {
      rules: ['context-purity'],
    }),
    scenario('context-edge-not-allow-listable', 'scenarios/renderer-context-boundary', 'fail', {
      rules: ['context-purity'],
      allowList: [
        {
          from: 'app/renderer/contexts/slide-context.ts',
          to: 'app/renderer/features/automation/events.ts',
          rules: ['context-purity'],
          reason: 'fixture',
          removedBy: 'fixture',
        },
      ],
    }),
    scenario('mixed/cycle-and-hard', 'scenarios/mixed/cycle-and-hard', 'fail', {
      rules: ['renderer-isolation', 'feature-isolation', 'feature-cycle'],
    }),
    scenario('feature-public-entry-required', 'scenarios/feature-public-entry-required', 'fail', {
      rules: ['public-entry'],
    }),
    scenario('missing-feature-entry-not-allow-listable', 'scenarios/feature-public-entry-required', 'fail', {
      rules: ['public-entry'],
      allowList: [
        {
          from: 'app/renderer/screens/dinner/page.tsx',
          to: 'app/renderer/features/kitchen/knife.tsx',
          rules: ['public-entry'],
          reason: 'fixture',
          removedBy: 'fixture',
        },
      ],
    }),
    scenario('public-entry', 'scenarios/public-entry', 'fail', { rules: ['public-entry'] }),
    // Proves a permitted core -> contracts edge stays clean while a forbidden
    // contracts -> database edge is caught by contracts-purity.
    scenario('contracts', 'scenarios/contracts', 'fail', { rules: ['contracts-purity'] }),
    scenario('allowlist/covered', 'scenarios/allowlist/covered', 'pass', {
      allowList: [
        {
          from: 'app/renderer/shell/main-boundary-consumer.ts',
          to: 'app/main/menu.ts',
          rules: ['renderer-isolation'],
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
    scenario('renderer-package-boundary', 'scenarios/renderer-package-boundary', 'fail', {
      rules: ['renderer-package-boundary'],
    }),
    scenario('renderer-packages-allowed', 'scenarios/renderer-packages-allowed', 'pass'),
    scenario('renderer-node-builtins', 'scenarios/renderer-node-builtins', 'fail', {
      rules: ['renderer-isolation'],
    }),
    scenario('renderer-safe-package-node', 'scenarios/renderer-safe-package-node', 'fail', {
      rules: ['package-purity'],
    }),
    scenario('import-type-boundaries', 'scenarios/import-type-boundaries', 'fail', {
      rules: ['renderer-isolation', 'package-purity', 'engine-session'],
    }),
    scenario('supported-source-forms', 'scenarios/supported-source-forms', 'fail', {
      rules: ['renderer-isolation', 'app-isolation'],
    }),
    scenario('process-node-and-source-forms-allowed', 'scenarios/process-node-and-source-forms-allowed', 'pass'),
    scenario('renderer-template-interpolation', 'scenarios/renderer-template-interpolation', 'fail', {
      rules: ['renderer-isolation'],
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
    // Cast owns its NDI engine session; Stream has only the exact UtilityProcess
    // host files. Another app's main/ndi is ordinary main code.
    scenario('monorepo/noncast-main-renderer', 'scenarios/monorepo/noncast-main-renderer', 'fail', {
      rules: ['main-boundary'],
    }),
    scenario('monorepo/noncast-ndi-forbidden', 'scenarios/monorepo/noncast-ndi-forbidden', 'fail', {
      rules: ['engine-session'],
    }),
    scenario('monorepo/stream-ndi-host-policy', 'scenarios/monorepo/stream-ndi-host-policy', 'fail', {
      rules: ['engine-session'],
    }),
    // Feature graphs are per app: opposite one-way edges in two apps are not a
    // cycle, while a genuine cycle inside one app still is.
    scenario('monorepo/feature-graph-per-app', 'scenarios/monorepo/feature-graph-per-app', 'fail', {
      rules: ['feature-isolation'],
    }),
    scenario('monorepo/feature-cycle-same-app', 'scenarios/monorepo/feature-cycle-same-app', 'fail', {
      rules: ['feature-isolation', 'feature-cycle'],
    }),
    // @lumacast/ui: React allowed, Konva/Electron banned, kernel-only
    // direction, and a stylesheet public only through its export map.
    scenario('monorepo/ui-allowed', 'scenarios/monorepo/ui-allowed', 'pass'),
    scenario('monorepo/ui-forbidden', 'scenarios/monorepo/ui-forbidden', 'fail', {
      rules: ['package-purity', 'package-dependency-direction'],
    }),
    // Approved Flux photo packages: a one-way stack (photo-model -> kernel,
    // photo-imaging -> kernel/photo-model, photo-library ->
    // kernel/photo-model/photo-imaging), headless, and split so a renderer may
    // hold the domain model but never the Node-side imaging/library code.
    scenario("photo/allowed", "scenarios/photo/allowed", "pass"),
    // The recorded direction is enforced in both directions: a reverse edge
    // (model -> imaging, imaging -> library) and an off-stack edge are denied.
    scenario(
      "photo/direction-denied",
      "scenarios/photo/direction-denied",
      "fail",
      {
        rules: ["package-dependency-direction"],
      },
    ),
    scenario(
      "photo/deep-import-denied",
      "scenarios/photo/deep-import-denied",
      "fail",
      {
        rules: ["package-public-entry"],
      },
    ),
    scenario(
      "photo/app-import-denied",
      "scenarios/photo/app-import-denied",
      "fail",
      {
        rules: ["package-app-boundary"],
      },
    ),
    scenario(
      "photo/renderer-node-denied",
      "scenarios/photo/renderer-node-denied",
      "fail",
      {
        rules: ["photo-renderer-boundary"],
      },
    ),
    scenario(
      "photo/headless-purity",
      "scenarios/photo/headless-purity",
      "fail",
      {
        rules: ["package-purity"],
      },
    ),
    // A specifier that does not resolve to a file is still judged by the
    // package it names, and only a scoped name is ours: an unrelated third-party
    // package called `photo-imaging` is left to the ordinary external rules.
    scenario(
      "photo/renderer-named-denied",
      "scenarios/photo/renderer-named-denied",
      "fail",
      {
        rules: ["photo-renderer-boundary"],
      },
    ),
    // The renderer-safe package must not need a Node runtime, while the
    // Node-side packages are Node code by design.
    scenario(
      "photo/model-node-purity",
      "scenarios/photo/model-node-purity",
      "fail",
      {
        rules: ["package-purity"],
      },
    ),
    // An app shared/ directory is the explicit typed IPC contract
    // surface; main and renderer may both depend on it, it may depend on
    // neither, and it must not reach a Node runtime.
    scenario("shared/forbidden", "scenarios/shared/forbidden", "fail", {
      rules: ["shared-contract"],
    }),
    scenario(
      "shared/builtin-denied",
      "scenarios/shared/builtin-denied",
      "fail",
      {
        rules: ["shared-contract"],
      },
    ),
  ];

  let failed = 0;
  for (const s of scenarios) {
    const root = path.join(FIXTURES_ROOT, s.dir);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      failed += 1;
      console.error(`FAIL ${s.name}: missing fixture directory ${root}`);
      continue;
    }
    if (walkFiles(root, root).filter((file) => !isTestFile(file)).length === 0) {
      failed += 1;
      console.error(`FAIL ${s.name}: fixture directory contains no source files ${root}`);
      continue;
    }
    const result = check({ rootDir: root, allowList: s.allowList ?? [] });
    const expectOk = s.expect === 'pass';
    const ok = result.ok === expectOk;
    const rulesOk = (s.rules ?? []).every((r) => result.errors.some((m) => m.includes(`[${r}]`)));
    const dynamicOk = !s.dynamic || result.errors.some((m) => m.includes('unsupported dynamic'));
    if (ok && rulesOk && dynamicOk) {
      console.log(`ok   ${s.name}`);
    } else {
      failed += 1;
      console.error(`FAIL ${s.name}: expected=${s.expect} rules=[${(s.rules ?? []).join(',')}] dynamic=${!!s.dynamic}`);
      for (const e of result.errors) console.error(`  err:   ${e.split('\n')[0]}`);
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

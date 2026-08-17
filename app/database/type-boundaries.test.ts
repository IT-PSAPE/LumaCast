import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Boundary guard for #153 (parent #116): domain primitives (app/core/domain/)
// and persistence DTOs (app/database/dto/) must stay one-directionally
// decoupled — a DTO may depend on core (it maps domain shapes to SQL rows),
// but core must never depend back on the database layer (core-purity, see
// AGENTS.md / tool/check_electron_architecture.mjs). This file asserts that
// directly, independent of the general architecture checker, so a
// reintroduced cross-dependency between the two new directories fails loudly
// even if nothing else changes.
//
// The static-import extraction below is intentionally small (regex over
// `import ... from '...'` / `export ... from '...'`) — good enough for the
// hand-written, type-only modules this test scans. It is not a general JS/TS
// parser; see tool/check_electron_architecture.mjs for the full checker.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CORE_DIR = path.resolve(REPO_ROOT, 'app/core');
const DOMAIN_DIR = path.resolve(REPO_ROOT, 'app/core/domain');
const DATABASE_DIR = path.resolve(REPO_ROOT, 'app/database');
const DTO_DIR = path.resolve(REPO_ROOT, 'app/database/dto');

const ALIASES: Record<string, string> = {
  '@core': CORE_DIR,
  '@database': DATABASE_DIR,
};

interface SourceFile {
  file: string;
  source: string;
}

interface ImportEdge {
  file: string;
  specifier: string;
  resolved: string;
}

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function readAll(dir: string): SourceFile[] {
  return listTsFiles(dir).map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }));
}

/** Extract static `from '...'` module specifiers from import/export statements. */
function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+[^;]*?from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) specifiers.push(m[1]);
  return specifiers;
}

function tryExts(base: string): string | null {
  for (const ext of ['', '.ts', '.tsx']) {
    const cand = base + ext;
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  for (const idx of ['/index.ts', '/index.tsx']) {
    const cand = base + idx;
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

/** Resolve a specifier the same way the app does: relative paths and the
 * `@core`/`@database` tsconfig aliases. Bare package specifiers and
 * unresolvable paths return null (not a domain/database edge). */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  if (specifier.startsWith('.')) {
    return tryExts(path.resolve(path.dirname(fromFile), specifier));
  }
  const alias = specifier.split('/')[0];
  const aliasBase = ALIASES[alias];
  if (aliasBase) {
    return tryExts(path.resolve(aliasBase, specifier.slice(alias.length + 1)));
  }
  return null;
}

function isInside(resolved: string, dir: string): boolean {
  const rel = path.relative(dir, resolved);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Every import edge from `files` that resolves into `intoDir`. Takes
 * in-memory sources (not just real files on disk) so tests below can prove
 * this detector fires on a violation without ever committing bad code. */
function findEdgesInto(files: SourceFile[], intoDir: string): ImportEdge[] {
  const edges: ImportEdge[] = [];
  for (const { file, source } of files) {
    for (const specifier of extractImportSpecifiers(source)) {
      const resolved = resolveSpecifier(specifier, file);
      if (resolved && isInside(resolved, intoDir)) {
        edges.push({ file, specifier, resolved });
      }
    }
  }
  return edges;
}

describe('domain vs persistence-DTO boundary (#153)', () => {
  it('app/core/domain/ exists and has real content (guards against an empty, meaningless check)', () => {
    const domainFiles = listTsFiles(DOMAIN_DIR);
    expect(domainFiles.length).toBeGreaterThan(0);
  });

  it('no file under app/core/domain/ imports from app/database/ (domain primitives must not depend on persistence DTOs, or anything else in the database layer)', () => {
    const violations = findEdgesInto(readAll(DOMAIN_DIR), DATABASE_DIR);
    expect(violations).toEqual([]);
  });

  it('no file under app/database/dto/ imports database code outside itself (a DTO module may depend on core, never on the repository/mapping code it is a shape for)', () => {
    const dtoFiles = readAll(DTO_DIR);
    const nonDtoDatabaseFiles = new Set(listTsFiles(DATABASE_DIR).filter((f) => !isInside(f, DTO_DIR)));
    const violations: ImportEdge[] = [];
    for (const { file, source } of dtoFiles) {
      for (const specifier of extractImportSpecifiers(source)) {
        const resolved = resolveSpecifier(specifier, file);
        if (resolved && nonDtoDatabaseFiles.has(resolved)) {
          violations.push({ file, specifier, resolved });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('a DTO depending on core/domain is permitted, not flagged (documents the allowed direction)', () => {
    const synthetic: SourceFile = {
      file: path.join(DTO_DIR, 'synthetic-permitted.ts'),
      source: `import type { Id } from '../../core/domain/ids';\nexport interface Row { id: Id }\n`,
    };
    expect(findEdgesInto([synthetic], DATABASE_DIR)).toEqual([]);
  });

  it('fails on a synthetic domain file importing database code via a relative path (proves the detector has teeth)', () => {
    const synthetic: SourceFile = {
      file: path.join(DOMAIN_DIR, 'synthetic-relative-violation.ts'),
      source: `import type { SqliteDatabase } from '../../database/sqlite';\nexport type Bad = SqliteDatabase;\n`,
    };
    const violations = findEdgesInto([synthetic], DATABASE_DIR);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ specifier: '../../database/sqlite' });
  });

  it('fails on a synthetic domain file importing database code via the @database alias (proves alias edges are caught too)', () => {
    const synthetic: SourceFile = {
      file: path.join(DOMAIN_DIR, 'synthetic-alias-violation.ts'),
      source: `import type { SqliteDatabase } from '@database/sqlite';\nexport type Bad = SqliteDatabase;\n`,
    };
    const violations = findEdgesInto([synthetic], DATABASE_DIR);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ specifier: '@database/sqlite' });
  });
});

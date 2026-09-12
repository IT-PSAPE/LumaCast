import nodeCrypto, { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CastRepository } from './store';
import type { RepositoryOptions } from './store';

const TEMP_PREFIX = 'lumacast-test-';

export interface TestRepositoryPaths {
  root: string;
  dbPath: string;
  userDataPath: string;
  documentsPath: string;
}

export interface TestRepositoryHandle {
  repository: CastRepository;
  paths: TestRepositoryPaths;
  close: () => void;
  reopen: () => CastRepository;
  cleanup: (target?: string) => void;
}

function closeRepository(repository: CastRepository): void {
  (repository as unknown as { db: { close(): void } }).db.close();
}

function isSafeCleanupTarget(target: string): boolean {
  const resolved = path.resolve(target);
  const parent = path.dirname(resolved);

  if (resolved === path.parse(resolved).root) return false;
  if (resolved === path.resolve(os.homedir())) return false;
  if (resolved === path.resolve(process.cwd())) return false;
  if (resolved === path.resolve(os.tmpdir())) return false;
  if (parent !== path.resolve(os.tmpdir())) return false;

  let realTarget: string;
  let realParent: string;
  try {
    realTarget = fs.realpathSync(resolved);
    realParent = fs.realpathSync(parent);
  } catch {
    return false;
  }
  if (realTarget === realParent) return false;
  if (!realTarget.startsWith(realParent + path.sep)) return false;

  return true;
}

export interface CreateTestRepositoryOptions {
  /** Pass `false` to open a database with no starter onboarding content seeded. Defaults to true. */
  seed?: boolean;
}

export function createTestRepository(options: CreateTestRepositoryOptions = {}): TestRepositoryHandle {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  const repositoryOptions: RepositoryOptions = {
    dbPath: path.join(root, 'lumacast.sqlite'),
    userDataPath: root,
    documentsPath: path.join(root, 'documents'),
    seed: options.seed,
  };

  let repository = new CastRepository(repositoryOptions);
  let closed = false;

  const handle: TestRepositoryHandle = {
    repository,
    paths: {
      root,
      dbPath: repositoryOptions.dbPath,
      userDataPath: repositoryOptions.userDataPath,
      documentsPath: repositoryOptions.documentsPath,
    },
    close: () => {
      closeRepository(handle.repository);
      closed = true;
    },
    reopen: () => {
      repository = new CastRepository(repositoryOptions);
      handle.repository = repository;
      closed = false;
      return repository;
    },
    cleanup: (target?: string) => {
      const resolvedTarget = target === undefined ? root : path.resolve(target);
      if (resolvedTarget !== path.resolve(root)) {
        throw new Error('cleanup: refuses a caller-supplied replacement path');
      }
      if (!closed) {
        throw new Error('cleanup: repository must be closed before cleanup');
      }
      if (!isSafeCleanupTarget(resolvedTarget)) {
        throw new Error('cleanup: refuses unsafe target');
      }
      fs.rmSync(resolvedTarget, { recursive: true, force: true });
    },
  };

  return handle;
}

// ─── Deterministic runtime (#200) ──────────────────────────────────────
//
// `CastRepository` gets its ids and timestamps from `createId()`/`nowIso()`
// in `@core/utils`, which call `crypto.randomUUID()` (`crypto` there is the
// `node:crypto` module's default export — a distinct object from the
// ambient `globalThis.crypto` WebCrypto global, even though both expose a
// `randomUUID` backed by the same native implementation) and `new Date()`.
// Reproducible performance fixtures need every id and timestamp a
// generation run produces to be a pure function of a seed and call order —
// never wall-clock time or OS randomness — so two runs of the same
// generator emit byte-identical output. Rather than adding a seam to
// `store.ts` (out of scope here and unwanted generally), this patches
// `randomUUID` on *both* crypto objects (whichever one a caller's `createId`
// happens to close over) plus the ambient `Date`, for the duration of `fn`,
// and restores everything afterward, including on throw.

export interface DeterministicRuntimeOptions {
  /** Same seed + same call sequence always yields the same ids/timestamps. */
  seed: string;
  /** Fixed clock start, ms since Unix epoch. Defaults to 2024-01-01T00:00:00.000Z. */
  epochMs?: number;
  /** Milliseconds the clock advances on every `new Date()` / `Date.now()` call. Defaults to 1000. */
  tickMs?: number;
}

const DEFAULT_DETERMINISTIC_EPOCH_MS = Date.UTC(2024, 0, 1, 0, 0, 0, 0);
const DEFAULT_DETERMINISTIC_TICK_MS = 1000;

/**
 * Deterministic stand-in for `crypto.randomUUID()`, derived from `seed` and
 * a monotonic counter via SHA-256 (a real, non-random digest — never
 * `Math.random()`). Shaped like a UUID v4 (version/variant nibbles set)
 * purely for compatibility with anything that might assume that format;
 * nothing in the current schema enforces it.
 */
function deterministicUuid(seed: string, counter: number): string {
  const hex = createHash('sha256').update(`${seed}:id:${counter}`).digest('hex');
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Runs `fn` with `crypto.randomUUID` and `Date` replaced by deterministic,
 * seed-derived equivalents, then restores the originals (even if `fn`
 * throws). Any code `fn` calls synchronously — directly or transitively,
 * including `CastRepository` methods — will observe the patched globals.
 *
 * Not safe to nest or interleave with concurrent async work that depends on
 * real time/randomness: the patch is global and process-wide for the
 * duration of the (synchronous) call.
 */
export function withDeterministicRuntime<T>(options: DeterministicRuntimeOptions, fn: () => T): T {
  const { seed } = options;
  const tickMs = options.tickMs ?? DEFAULT_DETERMINISTIC_TICK_MS;
  let clockMs = options.epochMs ?? DEFAULT_DETERMINISTIC_EPOCH_MS;
  let idCounter = 0;

  const OriginalDate = globalThis.Date;
  const originalGlobalRandomUUID = globalThis.crypto.randomUUID.bind(globalThis.crypto);
  const originalNodeCryptoRandomUUID = nodeCrypto.randomUUID.bind(nodeCrypto);

  class DeterministicDate extends OriginalDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(clockMs);
        clockMs += tickMs;
      } else {
        // Only `new Date()` (zero-arg) is reachable through `nowIso()`, the
        // one call site this patch exists for. This branch is a defensive
        // fallback for any other call shape (`new Date(x)`, `new Date(y, m,
        // d)`, ...) that forwards args as-is, deliberately unpatched — it
        // has no deterministic-seed story of its own, so behaves like the
        // real `Date` rather than throwing.
        // @ts-expect-error forwarding an arbitrary, unknown-shaped argument
        // list to Date's overloaded constructor.
        super(...args);
      }
    }
    static override now(): number {
      const current = clockMs;
      clockMs += tickMs;
      return current;
    }
  }

  const deterministicRandomUUID = (): `${string}-${string}-${string}-${string}-${string}` =>
    deterministicUuid(seed, ++idCounter) as `${string}-${string}-${string}-${string}-${string}`;

  Object.defineProperty(globalThis, 'Date', { value: DeterministicDate, configurable: true, writable: true });
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: deterministicRandomUUID,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(nodeCrypto, 'randomUUID', {
    value: deterministicRandomUUID,
    configurable: true,
    writable: true,
  });

  try {
    return fn();
  } finally {
    Object.defineProperty(globalThis, 'Date', { value: OriginalDate, configurable: true, writable: true });
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: originalGlobalRandomUUID,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(nodeCrypto, 'randomUUID', {
      value: originalNodeCryptoRandomUUID,
      configurable: true,
      writable: true,
    });
  }
}

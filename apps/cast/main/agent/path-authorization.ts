import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Reasons `PathAuthorizer.authorizeRead` refuses a path. `authorizeRead`
 * checks them in this same order — not-absolute, then unreadable, then
 * system-path, then hidden-path, then outside-allowed-roots, then
 * not-a-file, then too-large, then unsupported-type/type-mismatch — so a
 * path that fails more than one check always reports the first.
 */
export type PathDenialCode =
  | 'not-absolute'
  | 'outside-allowed-roots'
  | 'system-path'
  | 'hidden-path'
  | 'not-a-file'
  | 'unreadable'
  | 'too-large'
  | 'type-mismatch'
  | 'unsupported-type';

export class PathAuthorizationError extends Error {
  constructor(
    public readonly code: PathDenialCode,
    message: string,
  ) {
    super(message);
    this.name = 'PathAuthorizationError';
  }
}

export type SniffedMediaType = 'image' | 'video' | 'audio';

export interface AuthorizeReadOptions {
  purpose: 'media' | 'document';
  /**
   * The type a caller expected the file to be (e.g. from a tool call's
   * declared argument). Only consulted for `purpose: 'media'` — a mismatch
   * against the sniffed type denies with `type-mismatch` rather than
   * trusting the caller's label. `purpose: 'document'` never sniffs, so this
   * is ignored for document reads.
   */
  declaredType?: SniffedMediaType;
  /** Overrides the purpose's default size ceiling (media 4 GiB, document 50 MiB). */
  maxBytes?: number;
}

export interface AuthorizedPath {
  /** The realpath of the authorized file. Callers must use this, not the path they passed in. */
  path: string;
  size: number;
  /** Sniffed media type, or `null` for `purpose: 'document'` (sniffing is skipped entirely). */
  detectedType: SniffedMediaType | null;
}

const DEFAULT_MAX_BYTES: Record<AuthorizeReadOptions['purpose'], number> = {
  media: 4 * 1024 * 1024 * 1024,
  document: 50 * 1024 * 1024,
};

const SNIFF_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// Magic-byte sniffing
// ---------------------------------------------------------------------------

const ascii = (value: string): Buffer => Buffer.from(value, 'ascii');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const GIF87_SIGNATURE = ascii('GIF87a');
const GIF89_SIGNATURE = ascii('GIF89a');
const BMP_SIGNATURE = ascii('BM');
const EBML_SIGNATURE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const FLAC_SIGNATURE = ascii('fLaC');
const OGG_SIGNATURE = ascii('OggS');
const ID3_SIGNATURE = ascii('ID3');
const RIFF_SIGNATURE = ascii('RIFF');
const WEBP_SIGNATURE = ascii('WEBP');
const WAVE_SIGNATURE = ascii('WAVE');
const FTYP_SIGNATURE = ascii('ftyp');
/** `ftyp` brands that mean "audio in an MP4 container" rather than video. */
const AUDIO_FTYP_BRANDS = new Set(['M4A ', 'M4B ']);

function matchesAt(buffer: Buffer, offset: number, signature: Buffer): boolean {
  if (buffer.length < offset + signature.length) return false;
  return buffer.compare(signature, 0, signature.length, offset, offset + signature.length) === 0;
}

/** MPEG audio frame sync: 0xFF followed by a byte whose top nibble is also all-ones. */
function detectMp3FrameSync(buffer: Buffer): SniffedMediaType | null {
  if (buffer.length < 2) return null;
  return buffer[0] === 0xff && (buffer[1] & 0xf0) === 0xf0 ? 'audio' : null;
}

/** RIFF containers: `WEBP` at offset 8 is an image, `WAVE` at offset 8 is audio. */
function detectRiff(buffer: Buffer): SniffedMediaType | null {
  if (!matchesAt(buffer, 0, RIFF_SIGNATURE)) return null;
  if (matchesAt(buffer, 8, WEBP_SIGNATURE)) return 'image';
  if (matchesAt(buffer, 8, WAVE_SIGNATURE)) return 'audio';
  return null;
}

/** ISO base media containers (`ftyp` at offset 4): mp4/m4v/mov are video, m4a/m4b are audio. */
function detectFtyp(buffer: Buffer): SniffedMediaType | null {
  if (!matchesAt(buffer, 4, FTYP_SIGNATURE)) return null;
  const brand = buffer.subarray(8, 12).toString('ascii');
  return AUDIO_FTYP_BRANDS.has(brand) ? 'audio' : 'video';
}

/** SVG is text, not a binary format: sniff the first 1 KiB for an `<svg` (optionally after an `<?xml` prolog). */
function detectSvg(buffer: Buffer): SniffedMediaType | null {
  const head = buffer
    .subarray(0, Math.min(buffer.length, 1024))
    .toString('utf-8')
    .replace(/^\uFEFF/, '')
    .trimStart()
    .toLowerCase();
  if (head.startsWith('<svg')) return 'image';
  if (head.startsWith('<?xml') && head.includes('<svg')) return 'image';
  return null;
}

/** One detector per format family, tried in order; the first match wins. */
const DETECTORS: ReadonlyArray<(buffer: Buffer) => SniffedMediaType | null> = [
  (buffer) => (matchesAt(buffer, 0, PNG_SIGNATURE) ? 'image' : null),
  (buffer) => (matchesAt(buffer, 0, JPEG_SIGNATURE) ? 'image' : null),
  (buffer) => (matchesAt(buffer, 0, GIF87_SIGNATURE) || matchesAt(buffer, 0, GIF89_SIGNATURE) ? 'image' : null),
  (buffer) => (matchesAt(buffer, 0, BMP_SIGNATURE) ? 'image' : null),
  (buffer) => (matchesAt(buffer, 0, EBML_SIGNATURE) ? 'video' : null),
  (buffer) => (matchesAt(buffer, 0, FLAC_SIGNATURE) ? 'audio' : null),
  (buffer) => (matchesAt(buffer, 0, OGG_SIGNATURE) ? 'audio' : null),
  (buffer) => (matchesAt(buffer, 0, ID3_SIGNATURE) ? 'audio' : null),
  detectMp3FrameSync,
  detectRiff,
  detectFtyp,
  detectSvg,
];

async function readHead(filePath: string, maxBytes: number): Promise<Buffer> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Identifies a media file by its magic bytes — never its extension or a
 * caller-declared type, both of which are trivial to fake. Reads at most the
 * first 64 KiB of the file, far more than any signature below needs (the
 * deepest, an `ftyp` brand, sits at offset 8).
 */
export async function sniffMediaType(filePath: string): Promise<SniffedMediaType | null> {
  const buffer = await readHead(filePath, SNIFF_BYTES);
  if (buffer.length === 0) return null;
  for (const detect of DETECTORS) {
    const type = detect(buffer);
    if (type) return type;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Deny list
// ---------------------------------------------------------------------------

interface DenyRule {
  /** Absolute path this rule denies, along with everything under it. */
  root: string;
  /** Sub-paths of `root` carved back out (e.g. a temp directory under `/var`). */
  exceptions?: string[];
}

function safeRealpathSync(candidate: string): string {
  try {
    return fs.realpathSync(candidate);
  } catch {
    return candidate;
  }
}

function isWithinOrEqual(candidate: string, root: string): boolean {
  if (candidate === root) return true;
  const withSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate.startsWith(withSeparator);
}

function matchesDenyRule(realPath: string, rule: DenyRule): boolean {
  if (!isWithinOrEqual(realPath, rule.root)) return false;
  return !rule.exceptions?.some((exception) => isWithinOrEqual(realPath, exception));
}

/**
 * System and credential locations no agent-authorized read may reach,
 * regardless of the user's allowed roots — checked on the realpath, so a
 * symlink cannot dress one of these up as something else.
 *
 * `/etc` and `/var` are listed alongside their `/private` counterparts
 * because both are themselves symlinks into `/private` on macOS:
 * `fs.promises.realpath` always resolves to the `/private` form there, so
 * without the twin entry the bare form would never actually match anything.
 * `/var/folders` (and its realpath'd twin) is carved back out because that
 * is where this app's own temp directories — and most test fixtures — live.
 *
 * The three `~/Library` subtrees are deliberately a short, explicit list
 * (keychains, cookies, and the directory most apps use for stored
 * credentials/tokens) rather than an attempt to enumerate every credential
 * file under the user's Library.
 */
function buildDenyRules(homeDir: string, platform: NodeJS.Platform): DenyRule[] {
  const rules: DenyRule[] = [
    { root: '/etc' },
    { root: '/private/etc' },
    { root: '/System' },
    { root: '/Library' },
    { root: '/usr' },
    { root: '/bin' },
    { root: '/sbin' },
    { root: '/var', exceptions: ['/var/folders'] },
    { root: '/private/var', exceptions: ['/private/var/folders'] },
    { root: '/proc' },
    { root: '/dev' },
    { root: path.join(homeDir, '.ssh') },
    { root: path.join(homeDir, '.aws') },
    { root: path.join(homeDir, '.gnupg') },
    { root: path.join(homeDir, '.config', 'gcloud') },
    { root: path.join(homeDir, '.kube') },
    { root: path.join(homeDir, '.docker') },
    { root: path.join(homeDir, '.npmrc') },
    { root: path.join(homeDir, '.netrc') },
    { root: path.join(homeDir, 'Library', 'Keychains') },
    { root: path.join(homeDir, 'Library', 'Cookies') },
    { root: path.join(homeDir, 'Library', 'Application Support') },
  ];

  if (platform === 'win32') {
    rules.push({ root: 'C:\\Windows' });
    const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
    if (systemRoot) rules.push({ root: systemRoot });
  }

  return rules;
}

function hasHiddenSegment(realPath: string): boolean {
  return realPath
    .split(path.sep)
    .some((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && segment.startsWith('.'));
}

/** Any file literally named `.env`, wherever it lives — not just under a credential root. */
function isEnvFile(realPath: string): boolean {
  return path.basename(realPath) === '.env';
}

// ---------------------------------------------------------------------------
// Authorizer
// ---------------------------------------------------------------------------

/**
 * Authorizes a filesystem read on behalf of an agent-originated caller
 * (import-by-path, document-text-extraction) — the same access a user
 * gesture (a native picker, a drop) already has implicitly, extended to an
 * external agent that calls those tools directly without one.
 *
 * Every check runs against the realpath, resolved once up front, so a
 * symlink inside an allowed root cannot point outside it
 * (`outside-allowed-roots`) or stand in front of a denied system/credential
 * location that the deny-list would otherwise catch (`system-path`) — the
 * deny-list is checked first and wins over the allow-list either way.
 * Callers must persist and open `AuthorizedPath.path` (the realpath), never
 * the path they passed in.
 */
export class PathAuthorizer {
  private readonly homeDir: string;
  private readonly denyRules: DenyRule[];

  constructor(
    private readonly getAllowedRoots: () => readonly string[],
    options: { homeDir?: string; platform?: NodeJS.Platform } = {},
  ) {
    // Realpath'd up front, for the same reason `/etc` and `/private/etc` are
    // both listed below: every comparison in this class is against a
    // realpath, so the home-relative deny roots must be built from the
    // realpath'd home directory or a symlinked home (or, as in tests, a
    // fixture directory that resolves through `/private`) would silently
    // fail to match.
    this.homeDir = safeRealpathSync(options.homeDir ?? os.homedir());
    this.denyRules = buildDenyRules(this.homeDir, options.platform ?? process.platform);
  }

  async authorizeRead(filePath: string, options: AuthorizeReadOptions): Promise<AuthorizedPath> {
    if (!path.isAbsolute(filePath)) {
      throw new PathAuthorizationError('not-absolute', `Path must be absolute: ${filePath}`);
    }

    let realPath: string;
    try {
      realPath = await fs.promises.realpath(filePath);
    } catch {
      throw new PathAuthorizationError('unreadable', `Could not resolve path: ${filePath}`);
    }

    if (isEnvFile(realPath) || this.denyRules.some((rule) => matchesDenyRule(realPath, rule))) {
      throw new PathAuthorizationError('system-path', `Path is a protected system or credential location: ${realPath}`);
    }

    if (hasHiddenSegment(realPath)) {
      throw new PathAuthorizationError('hidden-path', `Path has a hidden segment: ${realPath}`);
    }

    if (!this.isWithinAllowedRoots(realPath)) {
      throw new PathAuthorizationError('outside-allowed-roots', `Path is outside all allowed roots: ${realPath}`);
    }

    let stats: fs.Stats;
    try {
      stats = await fs.promises.stat(realPath);
    } catch {
      throw new PathAuthorizationError('unreadable', `Could not read ${realPath}`);
    }
    if (!stats.isFile()) {
      throw new PathAuthorizationError('not-a-file', `Not a regular file: ${realPath}`);
    }

    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES[options.purpose];
    if (stats.size > maxBytes) {
      throw new PathAuthorizationError(
        'too-large',
        `${realPath} is ${stats.size} bytes, exceeding the ${maxBytes}-byte limit for ${options.purpose}`,
      );
    }

    let detectedType: SniffedMediaType | null = null;
    if (options.purpose === 'media') {
      detectedType = await sniffMediaType(realPath);
      if (detectedType === null) {
        throw new PathAuthorizationError('unsupported-type', `Could not identify a supported media type: ${realPath}`);
      }
      if (options.declaredType && options.declaredType !== detectedType) {
        throw new PathAuthorizationError(
          'type-mismatch',
          `Declared type ${options.declaredType} does not match the detected type ${detectedType}: ${realPath}`,
        );
      }
    }

    return { path: realPath, size: stats.size, detectedType };
  }

  /**
   * Whether an already-resolved `realPath` falls inside one of the
   * currently allowed roots. Each root is realpath'd fresh on every call —
   * `getAllowedRoots` can change between calls, and a granted root may
   * itself be a symlink — and a root that no longer resolves is skipped
   * rather than thrown. Comparisons include a trailing separator so a root
   * `/a/Docs` cannot match a candidate under `/a/Documents`.
   */
  isWithinAllowedRoots(realPath: string): boolean {
    for (const root of this.getAllowedRoots()) {
      let realRoot: string;
      try {
        realRoot = fs.realpathSync(root);
      } catch {
        continue;
      }
      if (isWithinOrEqual(realPath, realRoot)) return true;
    }
    return false;
  }
}

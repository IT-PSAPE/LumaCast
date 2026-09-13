// Electron-free, pure redaction helpers. Anything that logs main-process
// console output (see `logger.ts`) or otherwise persists text that might
// contain LLM provider API keys or chat transcripts must run it through
// `redactValue`/`redactString` first.

const MIN_SECRET_LENGTH = 8;

const REDACTED = '[redacted]';

// Exact-match secrets (API keys, tokens, etc.) registered at runtime, e.g.
// immediately after a provider key is read from config/keychain. Matched
// verbatim before pattern-based redaction runs.
const registeredSecrets = new Set<string>();

export function registerSecretForRedaction(value: string): void {
  if (typeof value !== 'string') return;
  if (value.length < MIN_SECRET_LENGTH) return;
  registeredSecrets.add(value);
}

export function unregisterSecretForRedaction(value: string): void {
  registeredSecrets.delete(value);
}

// Exposed for tests only — not part of the module's public contract.
export function __clearRegisteredSecretsForTests(): void {
  registeredSecrets.clear();
}

function maskKeepingPrefix(matched: string): string {
  const prefix = matched.slice(0, 4);
  return `${prefix}…${REDACTED}`;
}

// Order matters: more specific prefixes (sk-ant-, sk-or-) must run before the
// generic sk- pattern, otherwise the generic pattern would match the
// specific ones' text too and produce an equivalent-but-redundant hit — not
// wrong, but keeping specific-before-generic makes intent clear and avoids
// double-processing overlapping matches.
const CREDENTIAL_PATTERNS: RegExp[] = [
  // Anthropic keys: sk-ant-...
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  // OpenRouter keys: sk-or-...
  /sk-or-[A-Za-z0-9_-]{20,}/g,
  // OpenAI-style keys: sk-...
  /sk-[A-Za-z0-9_-]{20,}/g,
  // Google API keys
  /AIza[0-9A-Za-z_-]{35}/g,
];

function redactCredentialPatterns(input: string): string {
  let result = input;
  for (const pattern of CREDENTIAL_PATTERNS) {
    result = result.replace(pattern, (matched) => maskKeepingPrefix(matched));
  }
  return result;
}

function redactHeaderPatterns(input: string): string {
  let result = input;
  // Authorization: Bearer <token>
  result = result.replace(/\b(Bearer\s+)([A-Za-z0-9._-]{8,})/gi, (_m, prefix: string, token: string) => {
    return `${prefix}${maskKeepingPrefix(token)}`;
  });
  // x-api-key: <value>  (header form, quotes optional)
  result = result.replace(
    /\b(x-api-key["']?\s*[:=]\s*["']?)([^\s"',}]{8,})/gi,
    (_m, prefix: string, value: string) => `${prefix}${maskKeepingPrefix(value)}`,
  );
  return result;
}

function redactJsonishPatterns(input: string): string {
  let result = input;
  // "apiKey": "...", "api_key": "...", "token": "...", "secret": "..."
  result = result.replace(
    /("(?:apiKey|api_key|token|secret)"\s*:\s*")([^"]+)(")/gi,
    (_m, prefix: string, value: string, suffix: string) => `${prefix}${maskKeepingPrefix(value)}${suffix}`,
  );
  return result;
}

export function redactString(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return input;

  let result = input;

  // Exact registered secrets first — these are known-sensitive values (e.g.
  // a provider key read at startup), so mask them fully regardless of shape.
  if (registeredSecrets.size > 0) {
    for (const secret of registeredSecrets) {
      if (secret.length === 0) continue;
      result = result.split(secret).join(REDACTED);
    }
  }

  result = redactCredentialPatterns(result);
  result = redactHeaderPatterns(result);
  result = redactJsonishPatterns(result);

  return result;
}

const SENSITIVE_KEY_PATTERN = /^(apiKey|api_key|authorization|token|secret|password)$/i;

const MAX_DEPTH = 6;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function redactErrorLike(error: Error, depth: number, seen: WeakSet<object>): Error {
  // Mutate a shallow clone, not the original error object, so callers that
  // still hold a reference to the original (e.g. to rethrow it) don't have
  // their message/stack silently rewritten out from under them.
  const clone = Object.create(Object.getPrototypeOf(error)) as Error & Record<string, unknown>;
  Object.assign(clone, error);
  clone.message = typeof error.message === 'string' ? redactString(error.message) : error.message;
  clone.stack = typeof error.stack === 'string' ? redactString(error.stack) : error.stack;
  clone.name = error.name;

  // Redact any additional enumerable own properties too (e.g. `.cause`,
  // custom error fields that might carry request payloads).
  for (const key of Object.keys(error)) {
    if (key === 'message' || key === 'stack' || key === 'name') continue;
    (clone as Record<string, unknown>)[key] = redactValueInternal(
      (error as unknown as Record<string, unknown>)[key],
      depth + 1,
      seen,
      key,
    );
  }

  return clone;
}

function redactValueInternal(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  keyName?: string,
): unknown {
  if (typeof value === 'string') {
    if (keyName && SENSITIVE_KEY_PATTERN.test(keyName) && value.length > 0) {
      return REDACTED;
    }
    return redactString(value);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (depth >= MAX_DEPTH) {
    return value;
  }

  // `seen` tracks the current ancestor path, not every object visited, so a
  // value referenced twice from unrelated branches (a DAG, not a cycle)
  // still gets redacted normally — only a true cycle (an object nested
  // inside itself) hits the circular guard. Entries are removed once a
  // node's children are done, which is why every `seen.add` below is
  // paired with a `finally`-style `seen.delete` after recursing.
  if (seen.has(value)) {
    return '[circular]';
  }

  if (value instanceof Error) {
    seen.add(value);
    try {
      return redactErrorLike(value, depth, seen);
    } finally {
      seen.delete(value);
    }
  }

  if (Array.isArray(value)) {
    seen.add(value);
    try {
      return value.map((item) => redactValueInternal(item, depth + 1, seen));
    } finally {
      seen.delete(value);
    }
  }

  if (isPlainObject(value)) {
    seen.add(value);
    try {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        if (SENSITIVE_KEY_PATTERN.test(key) && typeof val === 'string' && val.length > 0) {
          result[key] = REDACTED;
        } else {
          result[key] = redactValueInternal(val, depth + 1, seen, key);
        }
      }
      return result;
    } finally {
      seen.delete(value);
    }
  }

  // Other object types (Map, Date, RegExp, class instances, …) are left
  // untouched — we only walk plain data shapes and arrays.
  return value;
}

export function redactValue(value: unknown, depth = 0): unknown {
  return redactValueInternal(value, depth, new WeakSet<object>());
}

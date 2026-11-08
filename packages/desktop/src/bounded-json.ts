import type { IncomingMessage } from 'node:http';

export interface JsonRequestLimits {
  maxBytes: number;
  maxBatchMessages: number;
  maxElements: number;
  maxDepth: number;
}

export class JsonRequestLimitError extends Error {
  constructor(public readonly status: 400 | 413, message: string) {
    super(message);
    this.name = 'JsonRequestLimitError';
  }
}

/** Counts object keys and array members before any schema walks the input. */
export function assertJsonRequestBudget(value: unknown, limits: JsonRequestLimits): void {
  if (Array.isArray(value) && value.length > limits.maxBatchMessages) {
    throw new JsonRequestLimitError(400, 'Too many request messages');
  }
  const pending = [{ value, depth: 0 }];
  let elements = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.value === null || typeof current.value !== 'object') continue;
    if (current.depth > limits.maxDepth) {
      throw new JsonRequestLimitError(413, 'Request nesting is too deep');
    }
    const keys = Object.keys(current.value);
    elements += keys.length;
    if (elements > limits.maxElements) {
      throw new JsonRequestLimitError(413, 'Too many request elements');
    }
    for (const key of keys) {
      const child = (current.value as Record<string, unknown>)[key];
      if (child !== null && typeof child === 'object') {
        pending.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
}

/** Call only after authentication and origin checks. Does not destroy the socket on rejection. */
export async function readBoundedJsonRequest(request: IncomingMessage, limits: JsonRequestLimits): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  // A normal for-await return destroys IncomingMessage before a 413 can flush.
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > limits.maxBytes) {
      request.resume();
      throw new JsonRequestLimitError(413, 'Request too large');
    }
    chunks.push(chunk);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')); }
  catch { throw new JsonRequestLimitError(400, 'Invalid JSON request'); }
  assertJsonRequestBudget(value, limits);
  return value;
}

// @vitest-environment node
import { createServer, request, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { assertJsonRequestBudget, JsonRequestLimitError, readBoundedJsonRequest } from '../../../../packages/desktop/src/bounded-json';

const limits = { maxBytes: 1024, maxBatchMessages: 100, maxElements: 100_000, maxDepth: 64 };
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

describe('JSON request budgets', () => {
  it('keeps a valid maximum-size photo batch within the aggregate element budget', () => {
    const edits = Array.from({ length: 10_000 }, (_, id) => ({ id: String(id), expectedRevision: 0, patch: { exposure: 1 } }));
    expect(() => assertJsonRequestBudget({ params: { arguments: { edits } } }, limits)).not.toThrow();
  });

  it('accepts the batch boundary and rejects one extra message', () => {
    expect(() => assertJsonRequestBudget(Array(100).fill({}), limits)).not.toThrow();
    expect(() => assertJsonRequestBudget(Array(101).fill({}), limits)).toThrow('Too many request messages');
  });

  it('counts the entire batch and nested object keys before schema validation', () => {
    const budget = { ...limits, maxElements: 3 };
    expect(() => assertJsonRequestBudget({ values: [1, 2] }, budget)).not.toThrow();
    expect(() => assertJsonRequestBudget([{ value: 1 }, { value: 2 }], budget)).toThrow('Too many request elements');
  });

  it('bounds nesting without recursively walking the JavaScript stack', () => {
    const nested = (depth: number): unknown => {
      let value: unknown = {};
      for (let i = 0; i < depth; i++) value = { nested: value };
      return value;
    };
    expect(() => assertJsonRequestBudget(nested(64), limits)).not.toThrow();
    expect(() => assertJsonRequestBudget(nested(65), limits)).toThrow('Request nesting is too deep');
  });
});

async function endpoint() {
  let activeReaders = 0;
  const server = createServer(async (req, res) => {
    activeReaders++;
    try {
      const value = await readBoundedJsonRequest(req, limits);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    } catch (error) {
      if (!res.destroyed) res.writeHead(error instanceof JsonRequestLimitError ? error.status : 400, { connection: 'close' }).end((error as Error).message);
    } finally { activeReaders--; }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing HTTP test address');
  return { url: `http://127.0.0.1:${address.port}`, activeReaders: () => activeReaders };
}

function chunked(url: string, chunks: string[]): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, text }));
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

describe('bounded real HTTP input', () => {
  it('delivers a useful 413 for chunked overflow and releases the reader', async () => {
    const server = await endpoint();
    const rejected = await chunked(server.url, ['{"value":"', 'a'.repeat(2048), '"}']);
    expect(rejected).toEqual({ status: 413, text: 'Request too large' });
    expect(server.activeReaders()).toBe(0);
    const accepted = await chunked(server.url, ['{"value":', 'true}']);
    expect(accepted).toEqual({ status: 200, text: '{"value":true}' });
  });

  it('rejects malformed JSON and preserves a body exactly at the byte limit', async () => {
    const server = await endpoint();
    expect((await chunked(server.url, ['{'])).status).toBe(400);
    const body = JSON.stringify({ value: 'a'.repeat(limits.maxBytes - 12) });
    expect(Buffer.byteLength(body)).toBe(limits.maxBytes);
    expect((await chunked(server.url, [body])).status).toBe(200);
  });
});

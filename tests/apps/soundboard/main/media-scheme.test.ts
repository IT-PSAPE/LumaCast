import { mkdtemp, mkdir, rm, writeFile, symlink, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SoundLibrary } from '../../../../apps/soundboard/shared/desktop-api';
import { createMediaProtocolHandler, MEDIA_SCHEME } from '../../../../apps/soundboard/main/media-scheme';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('soundboard media scheme', () => {
  it('streams only manifest sounds and supports byte ranges', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'soundboard-media-'));
    roots.push(root);
    await mkdir(path.join(root, 'audio'));
    const id = '26a00123-1234-4234-8234-123456789012';
    const sound = { id, name: 'Test', fileName: `${id}.wav` };
    await writeFile(path.join(root, 'audio', sound.fileName), Buffer.from('hello'));
    const library: SoundLibrary = { version: 2, boards: [{ id: '26a00123-1234-4234-8234-123456789013', name: 'Board', sounds: [sound] }] };
    const handle = createMediaProtocolHandler(root, async () => library);
    const response = await handle(new Request(`${MEDIA_SCHEME}://audio/${id}`, { headers: { range: 'bytes=1-3' } }));
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 1-3/5');
    expect(await response.text()).toBe('ell');
    const suffix = await handle(new Request(`${MEDIA_SCHEME}://audio/${id}`, { headers: { range: 'bytes=-2' } }));
    expect(suffix.status).toBe(206);
    expect(await suffix.text()).toBe('lo');
    const head = await handle(new Request(`${MEDIA_SCHEME}://audio/${id}`, { method: 'HEAD', headers: { range: 'bytes=0-0' } }));
    expect(head.status).toBe(206);
    expect(head.headers.get('content-length')).toBe('1');
    expect(await head.text()).toBe('');
    const invalidRange = await handle(new Request(`${MEDIA_SCHEME}://audio/${id}`, { headers: { range: 'bytes=9-10' } }));
    expect(invalidRange.status).toBe(416);
    await unlink(path.join(root, 'audio', sound.fileName));
    expect((await handle(new Request(`${MEDIA_SCHEME}://audio/${id}`))).status).toBe(404);
    expect((await handle(new Request(`${MEDIA_SCHEME}://audio/26a00123-1234-4234-8234-123456789014`))).status).toBe(404);
    expect((await handle(new Request(`${MEDIA_SCHEME}://audio/%2e%2e%2fsecret`))).status).toBe(403);
  });

  it('rejects a symlink even when a library entry points to the managed filename', async (context) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'soundboard-media-'));
    roots.push(root);
    await mkdir(path.join(root, 'audio'));
    const id = '26a00123-1234-4234-8234-123456789012';
    const sound = { id, name: 'Test', fileName: `${id}.wav` };
    const outside = path.join(root, 'outside.wav');
    await writeFile(outside, 'secret');
    try {
      await symlink(outside, path.join(root, 'audio', sound.fileName));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') context.skip();
      throw error;
    }
    const library: SoundLibrary = { version: 2, boards: [{ id: '26a00123-1234-4234-8234-123456789013', name: 'Board', sounds: [sound] }] };
    const handle = createMediaProtocolHandler(root, async () => library);
    expect((await handle(new Request(`${MEDIA_SCHEME}://audio/${id}`))).status).toBe(403);
  });
});

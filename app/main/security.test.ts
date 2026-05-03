import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const netFetch = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(),
  },
  net: {
    fetch: netFetch,
  },
}));

describe('fetchLocalFileResponse', () => {
  beforeEach(() => {
    netFetch.mockReset();
    netFetch.mockResolvedValue(new Response(null, { status: 206 }));
  });

  it('forwards range requests to the underlying file fetch', async () => {
    const { fetchLocalFileResponse } = await import('./security');
    const filePath = path.join(os.tmpdir(), `lumacast-range-${Date.now()}.mp4`);
    fs.writeFileSync(filePath, Buffer.from('0123456789'));

    const response = await fetchLocalFileResponse(filePath, {
      method: 'GET',
      referrer: '',
      url: 'cast-media://tmp/example.mp4',
      headers: new Headers({
        range: 'bytes=2-5',
      }),
    });

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(response.headers.get('content-length')).toBe('4');
    expect(await response.text()).toBe('2345');
    expect(netFetch).not.toHaveBeenCalled();
  });

  it('preserves HEAD requests for media probes', async () => {
    const { fetchLocalFileResponse } = await import('./security');

    await fetchLocalFileResponse('/tmp/example.mp4', {
      method: 'HEAD',
      referrer: '',
      url: 'cast-media://tmp/example.mp4',
      headers: {},
    });

    expect(netFetch).toHaveBeenCalledTimes(1);
    const [, options] = netFetch.mock.calls[0] as [string, { method?: string }];
    expect(options.method).toBe('HEAD');
  });
});

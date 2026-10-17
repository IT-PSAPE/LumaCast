import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { SoundLibrary } from '../shared/desktop-api';
import { AUDIO_EXTENSIONS } from './library-store';

export const MEDIA_SCHEME = 'lumasoundboard';
export const MEDIA_SCHEME_PRIVILEGES = { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } as const;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/opus' };

function parseRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[2] && match[1] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return Number.isInteger(start) && start >= 0 && start < size && Number.isInteger(end) && end >= start ? { start, end } : null;
}

export function createMediaProtocolHandler(directory: string, getLibrary: () => Promise<SoundLibrary>) {
  return async (request: Pick<Request, 'method' | 'url' | 'headers'>): Promise<Response> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
    let url: URL;
    try { url = new URL(request.url); } catch { return new Response(null, { status: 403 }); }
    const soundId = url.pathname.replace(/^\/+/, '');
    if (url.protocol !== `${MEDIA_SCHEME}:` || url.hostname !== 'audio' || !ID_PATTERN.test(soundId) || url.search || url.hash) return new Response(null, { status: 403 });
    const sound = (await getLibrary()).boards.flatMap((board) => board.sounds).find((item) => item.id === soundId);
    if (!sound) return new Response(null, { status: 404 });
    const expectedPrefix = `${soundId}.`;
    if (!sound.fileName.startsWith(expectedPrefix) || !(AUDIO_EXTENSIONS as readonly string[]).some((ext) => sound.fileName === `${soundId}.${ext}`)) return new Response(null, { status: 403 });
    const audioDirectory = path.join(directory, 'audio');
    const target = path.join(audioDirectory, sound.fileName);
    try {
      const [realDirectory, realTarget, directoryInfo, fileInfo] = await Promise.all([realpath(audioDirectory), realpath(target), lstat(audioDirectory), lstat(target)]);
      if (directoryInfo.isSymbolicLink() || fileInfo.isSymbolicLink() || path.dirname(realTarget) !== realDirectory || !fileInfo.isFile()) return new Response(null, { status: 403 });
      const size = fileInfo.size;
      const extension = path.extname(sound.fileName).slice(1).toLowerCase();
      const rangeHeader = request.headers.get('range');
      if (rangeHeader) {
        const range = parseRange(rangeHeader, size);
        if (!range) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
        const headers = { 'content-type': MIME[extension], 'accept-ranges': 'bytes', 'content-length': String(range.end - range.start + 1), 'content-range': `bytes ${range.start}-${range.end}/${size}` };
        return request.method === 'HEAD' ? new Response(null, { status: 206, headers }) : new Response(Readable.toWeb(createReadStream(realTarget, range)) as unknown as BodyInit, { status: 206, headers });
      }
      const headers = { 'content-type': MIME[extension], 'accept-ranges': 'bytes', 'content-length': String(size) };
      return request.method === 'HEAD' ? new Response(null, { status: 200, headers }) : new Response(Readable.toWeb(createReadStream(realTarget)) as unknown as BodyInit, { status: 200, headers });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Response(null, { status: 404 });
      throw error;
    }
  };
}

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { nativeImage } from 'electron';
import type { MediaAsset } from '@lumacast/composition';
import type { AppSnapshot, EnsureMediaDerivativeResult, MediaDerivativeProgress, SnapshotPatch } from '@lumacast/protocol';
import { revokeManagedMediaSource } from './media-capability';
import { resolveLocalMediaSourcePath } from './media-source-path';
import type { PersistenceServiceLike } from './persistence/persistence-service-proxy';

const THUMB_DIR_NAME = 'thumbs';
const THUMB_MANIFEST_NAME = 'manifest.json';
const THUMB_MAX_WIDTH = 480;
const THUMB_MAX_HEIGHT = 270;
const THUMB_ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg']);
const THUMB_FILENAME_PATTERN = /^[0-9a-f]{40}\.(png|jpg|jpeg)$/;
const SOURCE_FINGERPRINT_PATTERN = /^[0-9a-f]{40}$/;
const MAX_CONCURRENT_DERIVATIVES = 3;
const MAX_BACKGROUND_ADMISSIONS = 24;
const MAX_FOREGROUND_PENDING = 24;
const MAX_FALLBACK_TOKEN_COUNT = 128;
const MAX_BATCH_TRACKING = 8;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_SOURCE_RACE_RETRIES = 4;
export const MAX_FALLBACK_DERIVATIVE_BYTES = 5 * 1024 * 1024;
export const MAX_TRUSTED_EMBEDDED_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FALLBACK_IMAGE_WIDTH = 8192;
const MAX_FALLBACK_IMAGE_HEIGHT = 8192;
const MAX_FALLBACK_IMAGE_PIXELS = 16_777_216;
const MAX_FALLBACK_OUTPUT_BYTES = 2 * 1024 * 1024;
export const MAX_EMBEDDED_IMAGE_OUTPUT_BYTES = 512 * 1024;

export type MediaDerivativeRepository = Pick<
  PersistenceServiceLike,
  'getMediaAsset' | 'updateMediaAssetMetadata' | 'buildMediaAssetPatch'
>;

interface ManifestEntry {
  assetId: string;
  use: 'thumbnail';
  source: string;
  sourceSize: number;
  sourceMtimeMs: number;
  sourceFingerprint: string;
  fileName: string;
}

interface ManifestDocument {
  entries: Record<string, ManifestEntry>;
}

interface MediaMetadataUpdate {
  width: number | null;
  height: number | null;
  duration: number | null;
  codec: string | null;
}

interface ThumbnailBuild {
  bytes: Buffer;
  extension: 'png' | 'jpg';
}

interface EncodedImageDimensions {
  width: number;
  height: number;
}

interface SourceDescriptor {
  asset: MediaAsset;
  filePath: string;
  size: number;
  mtimeMs: number;
  sourceFingerprint: string;
  jobKey: string;
}

interface DerivativeJob {
  jobKey: string;
  assetId: string;
  priority: 'interactive' | 'background';
  runner: () => Promise<EnsureMediaDerivativeResult>;
  resolve: (value: EnsureMediaDerivativeResult) => void;
  reject: (reason?: unknown) => void;
}

interface BackgroundBatch {
  id: number;
  ids: string[];
  total: number;
  completed: number;
  failed: number;
}

interface FallbackTokenRecord {
  assetId: string;
  sourceFingerprint: string;
}

type BackgroundResultKind = 'ready' | 'failed';

const RETRY_RESULT = Symbol('media-derivative-retry');
type EnsureDescriptorOutcome = EnsureMediaDerivativeResult | typeof RETRY_RESULT;

function thumbKey(assetId: string): string {
  return `${assetId}:thumbnail`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeFileName(fileName: string): boolean {
  return THUMB_FILENAME_PATTERN.test(fileName) && THUMB_ALLOWED_EXTENSIONS.has(path.extname(fileName).slice(1).toLowerCase());
}

function isValidSourceFingerprint(value: string): boolean {
  return SOURCE_FINGERPRINT_PATTERN.test(value);
}

export function fitWithinBounds(width: number, height: number, maxWidth = THUMB_MAX_WIDTH, maxHeight = THUMB_MAX_HEIGHT): { width: number; height: number } {
  const safeWidth = Math.max(width, 1);
  const safeHeight = Math.max(height, 1);
  const scale = Math.min(1, maxWidth / safeWidth, maxHeight / safeHeight);
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function createSourceFingerprint(assetId: string, source: string, size: number, mtimeMs: number): string {
  return createHash('sha1').update(`${assetId}\0thumbnail\0${source}\0${size}\0${mtimeMs}`).digest('hex');
}

function ensureJobKey(assetId: string): string {
  return `ensure:${assetId}`;
}

function uploadJobKey(generationToken: string): string {
  return `upload:${generationToken}`;
}

async function readBytes(filePath: string, length: number, position = 0): Promise<Buffer> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const result = await handle.read(buffer, 0, length, position);
    return buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

async function probeJpegSize(filePath: string): Promise<{ width: number; height: number } | null> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const initial = Buffer.alloc(2);
    const opened = await handle.read(initial, 0, 2, 0);
    if (opened.bytesRead < 2 || initial[0] !== 0xff || initial[1] !== 0xd8) return null;
    let offset = 2;
    while (offset < 64 * 1024) {
      const markerHeader = Buffer.alloc(4);
      const result = await handle.read(markerHeader, 0, 4, offset);
      if (result.bytesRead < 4) return null;
      if (markerHeader[0] !== 0xff) return null;
      const marker = markerHeader[1];
      const segmentLength = markerHeader.readUInt16BE(2);
      if (segmentLength < 2) return null;
      if (
        (marker >= 0xc0 && marker <= 0xc3)
        || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb)
        || (marker >= 0xcd && marker <= 0xcf)
      ) {
        const sof = Buffer.alloc(5);
        const sofResult = await handle.read(sof, 0, 5, offset + 5);
        if (sofResult.bytesRead < 5) return null;
        return {
          height: sof.readUInt16BE(0),
          width: sof.readUInt16BE(2),
        };
      }
      offset += 2 + segmentLength;
    }
    return null;
  } finally {
    await handle.close();
  }
}

function probeJpegSizeFromBuffer(bytes: Uint8Array): EncodedImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length && offset < 64 * 1024) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segmentLength < 2) return null;
    if (
      (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (offset + 10 > bytes.length) return null;
      return {
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
        width: (bytes[offset + 7] << 8) | bytes[offset + 8],
      };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function probeEncodedImageDimensions(bytes: Uint8Array): EncodedImageDimensions | null {
  const buffer = Buffer.from(bytes);
  if (
    bytes.length >= 24
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }
  if (
    bytes.length >= 10
    && (
      String.fromCharCode(...bytes.subarray(0, 6)) === 'GIF87a'
      || String.fromCharCode(...bytes.subarray(0, 6)) === 'GIF89a'
    )
  ) {
    return {
      width: bytes[6] | (bytes[7] << 8),
      height: bytes[8] | (bytes[9] << 8),
    };
  }
  if (
    bytes.length >= 30
    && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === 'VP8X') {
      return {
        width: (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1,
        height: (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1,
      };
    }
    if (chunk === 'VP8 ') {
      return {
        width: ((bytes[26] | (bytes[27] << 8)) & 0x3fff),
        height: ((bytes[28] | (bytes[29] << 8)) & 0x3fff),
      };
    }
    if (chunk === 'VP8L' && bytes.length >= 25) {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
  }
  return probeJpegSizeFromBuffer(bytes);
}

export function validateEncodedImageForNativeDecode(
  bytes: Uint8Array,
  encodedByteLimit = MAX_TRUSTED_EMBEDDED_IMAGE_BYTES,
): EncodedImageDimensions {
  if (bytes.byteLength > encodedByteLimit) {
    throw new Error(`Embedded image exceeds ${encodedByteLimit} bytes`);
  }
  const dimensions = probeEncodedImageDimensions(bytes);
  if (!dimensions) {
    throw new Error('Embedded image must be a supported PNG, JPEG, GIF, or WebP image');
  }
  const { width, height } = dimensions;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Embedded image has invalid encoded dimensions');
  }
  if (width > MAX_FALLBACK_IMAGE_WIDTH || height > MAX_FALLBACK_IMAGE_HEIGHT) {
    throw new Error(`Embedded image exceeds ${MAX_FALLBACK_IMAGE_WIDTH}x${MAX_FALLBACK_IMAGE_HEIGHT}`);
  }
  if (width * height > MAX_FALLBACK_IMAGE_PIXELS) {
    throw new Error(`Embedded image exceeds ${MAX_FALLBACK_IMAGE_PIXELS} pixels`);
  }
  return dimensions;
}

async function probeImageMetadata(filePath: string): Promise<MediaMetadataUpdate> {
  try {
    const header = await readBytes(filePath, 64, 0);
    if (header.length >= 24 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return {
        width: header.readUInt32BE(16) || null,
        height: header.readUInt32BE(20) || null,
        duration: null,
        codec: null,
      };
    }
    if (header.length >= 10 && (header.subarray(0, 6).toString('ascii') === 'GIF87a' || header.subarray(0, 6).toString('ascii') === 'GIF89a')) {
      return {
        width: header.readUInt16LE(6) || null,
        height: header.readUInt16LE(8) || null,
        duration: null,
        codec: null,
      };
    }
    if (header.length >= 30 && header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP') {
      const chunk = header.subarray(12, 16).toString('ascii');
      if (chunk === 'VP8X' && header.length >= 30) {
        return {
          width: header.readUIntLE(24, 3) + 1 || null,
          height: header.readUIntLE(27, 3) + 1 || null,
          duration: null,
          codec: null,
        };
      }
      if (chunk === 'VP8 ' && header.length >= 30) {
        return {
          width: (header.readUInt16LE(26) & 0x3fff) || null,
          height: (header.readUInt16LE(28) & 0x3fff) || null,
          duration: null,
          codec: null,
        };
      }
      if (chunk === 'VP8L' && header.length >= 25) {
        const bits = header.readUInt32LE(21);
        return {
          width: ((bits & 0x3fff) + 1) || null,
          height: ((((bits >> 14) & 0x3fff)) + 1) || null,
          duration: null,
          codec: null,
        };
      }
    }
    const jpeg = await probeJpegSize(filePath);
    if (jpeg) {
      return { width: jpeg.width || null, height: jpeg.height || null, duration: null, codec: null };
    }
  } catch {
    // unknown/unsupported images stay null
  }

  return { width: null, height: null, duration: null, codec: null };
}

export class MediaDerivativeService {
  readonly thumbsDir: string;
  readonly manifestPath: string;
  #repo: MediaDerivativeRepository;
  #manifest: ManifestDocument;
  #activeCount = 0;
  #interactiveQueue: DerivativeJob[] = [];
  #backgroundJobQueue: DerivativeJob[] = [];
  #jobsByKey = new Map<string, Promise<EnsureMediaDerivativeResult>>();
  #interactiveJobKeys = new Set<string>();
  #backgroundEnsureJobKeys = new Set<string>();
  #progressListeners = new Set<(progress: MediaDerivativeProgress) => void>();
  #backgroundBatches: BackgroundBatch[] = [];
  #backgroundBatchIdsByAssetId = new Map<string, Set<number>>();
  #backgroundQueue: string[] = [];
  #backgroundQueuedIds = new Set<string>();
  #nextBackgroundBatchId = 1;
  #fallbackTokens = new Map<string, FallbackTokenRecord>();

  constructor(repo: MediaDerivativeRepository, userDataPath: string) {
    this.#repo = repo;
    this.thumbsDir = path.join(userDataPath, THUMB_DIR_NAME);
    this.manifestPath = path.join(this.thumbsDir, THUMB_MANIFEST_NAME);
    this.ensureThumbsDir();
    this.#manifest = this.readManifest();
  }

  onProgress(listener: (progress: MediaDerivativeProgress) => void): () => void {
    this.#progressListeners.add(listener);
    listener(this.progressSnapshot());
    return () => {
      this.#progressListeners.delete(listener);
    };
  }

  attachToResult(result: unknown): unknown {
    if (!isPlainObject(result)) return result;
    if (this.isSnapshotPatch(result)) return this.attachToPatch(result as SnapshotPatch);
    if (this.isSnapshot(result)) return this.attachToSnapshot(result as AppSnapshot);
    if (this.isEnsureResult(result)) {
      return result.patch ? { ...result, patch: this.attachToPatch(result.patch) } : result;
    }
    if (isPlainObject(result.patch) && this.isSnapshotPatch(result.patch)) {
      return { ...result, patch: this.attachToPatch(result.patch as SnapshotPatch) };
    }
    if (isPlainObject(result.snapshot) && this.isSnapshot(result.snapshot)) {
      return { ...result, snapshot: this.attachToSnapshot(result.snapshot as AppSnapshot) };
    }
    return result;
  }

  schedule(assetId: string): void {
    this.scheduleBatch([assetId]);
  }

  scheduleBatch(assetIds: readonly string[]): void {
    const ids = [...new Set(assetIds.filter((id) => typeof id === 'string' && id.length > 0))];
    if (ids.length === 0) return;
    const batchId = this.#nextBackgroundBatchId++;
    this.#backgroundBatches.push({
      id: batchId,
      ids: [...ids],
      total: ids.length,
      completed: 0,
      failed: 0,
    });
    for (const assetId of ids) {
      let batchIds = this.#backgroundBatchIdsByAssetId.get(assetId);
      if (!batchIds) {
        batchIds = new Set<number>();
        this.#backgroundBatchIdsByAssetId.set(assetId, batchIds);
      }
      batchIds.add(batchId);
      if (!this.#backgroundQueuedIds.has(assetId) && !this.hasPendingEnsureJob(assetId)) {
        this.#backgroundQueuedIds.add(assetId);
        this.#backgroundQueue.push(assetId);
      }
    }
    this.trimBackgroundBatchHistory();
    this.emitProgress();
    this.pumpBackgroundAdmissions();
  }

  async ensure(assetId: string): Promise<EnsureMediaDerivativeResult> {
    this.dequeueBackgroundAsset(assetId);
    return this.enqueueEnsure(assetId, 'interactive');
  }

  async uploadFallback(
    assetId: string,
    generationToken: string,
    sourceFingerprint: string,
    bytes: Uint8Array,
  ): Promise<EnsureMediaDerivativeResult> {
    validateEncodedImageForNativeDecode(bytes, MAX_FALLBACK_DERIVATIVE_BYTES);
    return this.enqueueInteractiveJob(
      uploadJobKey(generationToken),
      assetId,
      () => this.runFallbackUpload(assetId, generationToken, sourceFingerprint, bytes),
    );
  }

  invalidate(assetId: string): void {
    this.invalidateMany([assetId]);
  }

  invalidateMany(assetIds: readonly string[]): void {
    const uniqueIds = [...new Set(assetIds.filter((assetId) => typeof assetId === 'string' && assetId.length > 0))];
    if (uniqueIds.length === 0) return;
    const removedFileNames: string[] = [];
    let manifestChanged = false;
    for (const assetId of uniqueIds) {
      this.dequeueBackgroundAsset(assetId);
      this.completeBackgroundAsset(assetId, 'failed');
      const entry = this.getManifestEntry(assetId);
      if (!Object.hasOwn(this.#manifest.entries, thumbKey(assetId))) continue;
      delete this.#manifest.entries[thumbKey(assetId)];
      manifestChanged = true;
      if (entry?.fileName) removedFileNames.push(entry.fileName);
    }
    if (manifestChanged) {
      this.ensureThumbsDir();
      this.writeManifest();
    }
    for (const fileName of removedFileNames) {
      this.revokeStaleThumbnailGrant(fileName, null);
      this.removeFileBestEffort(path.join(this.thumbsDir, fileName));
    }
  }

  private async runEnsure(assetId: string): Promise<EnsureMediaDerivativeResult> {
    for (let attempt = 0; attempt < MAX_SOURCE_RACE_RETRIES; attempt += 1) {
      const descriptor = await this.describeCurrentSource(assetId);
      if (!descriptor) return { assetId, status: 'missing' };
      const result = await this.ensureDescriptor(descriptor);
      if (result !== RETRY_RESULT) return result;
      await Promise.resolve();
    }
    return { assetId, status: 'failed' };
  }

  private async runFallbackUpload(
    assetId: string,
    generationToken: string,
    sourceFingerprint: string,
    bytes: Uint8Array,
  ): Promise<EnsureMediaDerivativeResult> {
    const tokenRecord = this.#fallbackTokens.get(generationToken);
    if (!tokenRecord || tokenRecord.assetId !== assetId || tokenRecord.sourceFingerprint !== sourceFingerprint) {
      throw new Error('Stale media derivative fallback token');
    }

    const descriptor = await this.describeCurrentSource(assetId);
    if (!descriptor) return { assetId, status: 'missing' };
    if (descriptor.sourceFingerprint !== sourceFingerprint) {
      throw new Error('Stale media derivative fallback fingerprint');
    }

    const decoded = nativeImage.createFromBuffer(Buffer.from(bytes));
    if (decoded.isEmpty()) throw new Error('Fallback derivative is not a decodable native image');

    const targetSize = fitWithinBounds(...(() => {
      const { width, height } = decoded.getSize();
      return [width || THUMB_MAX_WIDTH, height || THUMB_MAX_HEIGHT] as const;
    })());
    const output = decoded.resize({ ...targetSize, quality: 'good' }).toPNG();
    if (output.byteLength > MAX_FALLBACK_OUTPUT_BYTES) {
      throw new Error(`Fallback derivative output exceeds ${MAX_FALLBACK_OUTPUT_BYTES} bytes`);
    }

    const current = await this.revalidateDescriptor(descriptor);
    if (!current) throw new Error('Stale media derivative fallback fingerprint');

    const previousEntry = this.getManifestEntry(current.asset.id);
    const nextFileName = `${current.sourceFingerprint}.png`;
    this.writeThumbnailFile(nextFileName, output);
    this.writeManifestEntry(current, nextFileName);
    this.revokeStaleThumbnailGrant(previousEntry?.fileName ?? null, nextFileName);
    if (previousEntry?.fileName && previousEntry.fileName !== nextFileName) {
      this.removeFileBestEffort(path.join(this.thumbsDir, previousEntry.fileName));
    }
    this.#fallbackTokens.delete(generationToken);
    const patch = await this.#repo.buildMediaAssetPatch(assetId);
    return { assetId, status: 'ready', patch };
  }

  private async ensureDescriptor(descriptor: SourceDescriptor): Promise<EnsureDescriptorOutcome> {
    const metadata = await this.probeMetadata(descriptor);
    const afterMetadata = await this.revalidateDescriptor(descriptor);
    if (!afterMetadata) return RETRY_RESULT;

    const metadataPatch = await this.#repo.updateMediaAssetMetadata(
      afterMetadata.asset.id,
      afterMetadata.asset.src,
      metadata,
    );
    const afterMetadataPatch = await this.revalidateDescriptor(afterMetadata);
    if (!afterMetadataPatch) return RETRY_RESULT;
    if (metadataPatch) this.emitProgress(metadataPatch);

    const existing = await this.validateCurrentThumbnail(afterMetadataPatch);
    if (existing) {
      const afterExistingCheck = await this.revalidateDescriptor(afterMetadataPatch);
      if (!afterExistingCheck) return RETRY_RESULT;
      return {
        assetId: descriptor.asset.id,
        status: 'ready',
        patch: metadataPatch ?? await this.#repo.buildMediaAssetPatch(afterExistingCheck.asset.id),
      };
    }

    const built = await this.buildThumbnail(afterMetadataPatch);
    const afterBuild = await this.revalidateDescriptor(afterMetadataPatch);
    if (!afterBuild) return RETRY_RESULT;

    if (built === 'needs-upload') {
      const generationToken = this.mintFallbackToken(afterBuild.asset.id, afterBuild.sourceFingerprint);
      return {
        assetId: descriptor.asset.id,
        status: 'needs-upload',
        patch: metadataPatch ?? undefined,
        generationToken,
        sourceFingerprint: afterBuild.sourceFingerprint,
      };
    }
    if (built === null) {
      return {
        assetId: descriptor.asset.id,
        status: 'ready',
        patch: metadataPatch ?? await this.#repo.buildMediaAssetPatch(afterBuild.asset.id),
      };
    }

    const previousEntry = this.getManifestEntry(afterBuild.asset.id);
    const fileName = `${afterBuild.sourceFingerprint}.${built.extension}`;
    this.writeThumbnailFile(fileName, built.bytes);
    this.writeManifestEntry(afterBuild, fileName);
    this.revokeStaleThumbnailGrant(previousEntry?.fileName ?? null, fileName);
    if (previousEntry?.fileName && previousEntry.fileName !== fileName) {
      this.removeFileBestEffort(path.join(this.thumbsDir, previousEntry.fileName));
    }

    return {
      assetId: descriptor.asset.id,
      status: 'ready',
      patch: metadataPatch ?? await this.#repo.buildMediaAssetPatch(afterBuild.asset.id),
    };
  }

  private async probeMetadata(descriptor: SourceDescriptor): Promise<MediaMetadataUpdate> {
    if (descriptor.asset.type === 'image') {
      return probeImageMetadata(descriptor.filePath);
    }

    try {
      const { parseFile } = await import('music-metadata');
      const metadata = await parseFile(descriptor.filePath);
      const duration = typeof metadata.format.duration === 'number' && Number.isFinite(metadata.format.duration)
        ? metadata.format.duration
        : null;
      const codecFromTrack = metadata.format.trackInfo.find((track) => typeof track.codecName === 'string')?.codecName ?? null;
      if (descriptor.asset.type === 'audio') {
        return {
          width: null,
          height: null,
          duration,
          codec: codecFromTrack ?? metadata.format.codec ?? null,
        };
      }
      const videoTrack = metadata.format.trackInfo.find((track) =>
        typeof track.video?.pixelWidth === 'number' || typeof track.video?.pixelHeight === 'number'
      );
      return {
        width: videoTrack?.video?.pixelWidth ?? null,
        height: videoTrack?.video?.pixelHeight ?? null,
        duration,
        codec: videoTrack?.codecName ?? metadata.format.codec ?? null,
      };
    } catch {
      return { width: null, height: null, duration: null, codec: null };
    }
  }

  private async buildThumbnail(descriptor: SourceDescriptor): Promise<ThumbnailBuild | 'needs-upload' | null> {
    if (descriptor.asset.type === 'audio') {
      try {
        const { parseFile } = await import('music-metadata');
        const metadata = await parseFile(descriptor.filePath);
        const picture = metadata.common.picture?.[0];
        if (!picture) return null;
        validateEncodedImageForNativeDecode(picture.data, MAX_TRUSTED_EMBEDDED_IMAGE_BYTES);
        const image = nativeImage.createFromBuffer(Buffer.from(picture.data));
        if (image.isEmpty()) return null;
        const { width, height } = image.getSize();
        const targetSize = fitWithinBounds(width || THUMB_MAX_WIDTH, height || THUMB_MAX_HEIGHT);
        const resized = image.resize({ ...targetSize, quality: 'good' });
        const output = resized.toPNG();
        if (output.byteLength > MAX_EMBEDDED_IMAGE_OUTPUT_BYTES) return null;
        return { bytes: output, extension: 'png' };
      } catch {
        return null;
      }
    }

    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      return 'needs-upload';
    }

    try {
      const image = await nativeImage.createThumbnailFromPath(descriptor.filePath, {
        width: THUMB_MAX_WIDTH,
        height: THUMB_MAX_HEIGHT,
      });
      if (image.isEmpty()) return 'needs-upload';
      return { bytes: image.toPNG(), extension: 'png' };
    } catch {
      return 'needs-upload';
    }
  }

  private attachToSnapshot(snapshot: AppSnapshot): AppSnapshot {
    const mediaAssets = snapshot.mediaAssets.map((asset) => this.attachToAsset(asset));
    return mediaAssets.some((asset, index) => asset !== snapshot.mediaAssets[index])
      ? { ...snapshot, mediaAssets }
      : snapshot;
  }

  private attachToPatch(patch: SnapshotPatch): SnapshotPatch {
    if (!patch.upserts.mediaAssets) return patch;
    const mediaAssets = patch.upserts.mediaAssets.map((asset) => this.attachToAsset(asset));
    if (mediaAssets.every((asset, index) => asset === patch.upserts.mediaAssets?.[index])) return patch;
    return {
      ...patch,
      upserts: {
        ...patch.upserts,
        mediaAssets,
      },
    };
  }

  private attachToAsset(asset: MediaAsset): MediaAsset {
    const entry = this.getManifestEntry(asset.id);
    if (!entry || entry.source !== asset.src) {
      return asset.thumbnailSrc ? { ...asset, thumbnailSrc: null } : asset;
    }
    const thumbnailPath = path.join(this.thumbsDir, entry.fileName);
    return asset.thumbnailSrc === thumbnailPath ? asset : { ...asset, thumbnailSrc: thumbnailPath };
  }

  private async validateCurrentThumbnail(descriptor: SourceDescriptor): Promise<string | null> {
    const entry = this.getManifestEntry(descriptor.asset.id);
    if (!entry) return null;
    if (
      entry.source !== descriptor.asset.src
      || entry.sourceSize !== descriptor.size
      || entry.sourceMtimeMs !== descriptor.mtimeMs
      || entry.sourceFingerprint !== descriptor.sourceFingerprint
    ) {
      this.invalidate(descriptor.asset.id);
      return null;
    }

    const filePath = path.join(this.thumbsDir, entry.fileName);
    try {
      const stats = await fs.promises.stat(filePath);
      if (!stats.isFile()) throw new Error('thumbnail missing');
    } catch {
      this.invalidate(descriptor.asset.id);
      return null;
    }

    const decoded = nativeImage.createFromPath(filePath);
    if (decoded.isEmpty()) {
      this.invalidate(descriptor.asset.id);
      return null;
    }
    return filePath;
  }

  private async describeCurrentSource(assetId: string): Promise<SourceDescriptor | null> {
    const asset = await this.#repo.getMediaAsset(assetId);
    if (!asset) return null;
    const filePath = resolveLocalMediaSourcePath(asset.src);
    if (!filePath) return null;
    try {
      const stats = await fs.promises.stat(filePath);
      if (!stats.isFile()) return null;
      const sourceFingerprint = createSourceFingerprint(asset.id, asset.src, stats.size, stats.mtimeMs);
      return {
        asset,
        filePath,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        sourceFingerprint,
        jobKey: `${asset.id}\0${sourceFingerprint}`,
      };
    } catch {
      return null;
    }
  }

  private async revalidateDescriptor(descriptor: SourceDescriptor): Promise<SourceDescriptor | null> {
    const current = await this.describeCurrentSource(descriptor.asset.id);
    if (!current) return null;
    return current.sourceFingerprint === descriptor.sourceFingerprint ? current : null;
  }

  private mintFallbackToken(assetId: string, sourceFingerprint: string): string {
    const token = randomBytes(16).toString('hex');
    this.#fallbackTokens.set(token, { assetId, sourceFingerprint });
    while (this.#fallbackTokens.size > MAX_FALLBACK_TOKEN_COUNT) {
      const oldest = this.#fallbackTokens.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.#fallbackTokens.delete(oldest);
    }
    return token;
  }

  private getManifestEntry(assetId: string): ManifestEntry | null {
    const entry = this.#manifest.entries[thumbKey(assetId)];
    if (!entry) return null;
    if (!isSafeFileName(entry.fileName) || !isValidSourceFingerprint(entry.sourceFingerprint)) return null;
    if (path.parse(entry.fileName).name !== entry.sourceFingerprint) return null;
    const resolved = path.resolve(this.thumbsDir, entry.fileName);
    if (!resolved.startsWith(path.resolve(this.thumbsDir) + path.sep)) return null;
    return entry;
  }

  private ensureThumbsDir(): void {
    fs.mkdirSync(this.thumbsDir, { recursive: true });
  }

  private writeThumbnailFile(fileName: string, bytes: Buffer): string {
    this.ensureThumbsDir();
    const targetPath = path.join(this.thumbsDir, path.basename(fileName));
    const tempPath = `${targetPath}.tmp`;
    fs.writeFileSync(tempPath, bytes);
    fs.renameSync(tempPath, targetPath);
    return targetPath;
  }

  private writeManifestEntry(descriptor: SourceDescriptor, fileName: string): void {
    this.#manifest.entries[thumbKey(descriptor.asset.id)] = {
      assetId: descriptor.asset.id,
      use: 'thumbnail',
      source: descriptor.asset.src,
      sourceSize: descriptor.size,
      sourceMtimeMs: descriptor.mtimeMs,
      sourceFingerprint: descriptor.sourceFingerprint,
      fileName: path.basename(fileName),
    };
    this.writeManifest();
  }

  private readManifest(): ManifestDocument {
    try {
      if (fs.existsSync(this.manifestPath) && fs.statSync(this.manifestPath).size > MAX_MANIFEST_BYTES) {
        this.quarantineManifest();
        return { entries: {} };
      }
      const raw = fs.readFileSync(this.manifestPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      return this.validateManifestDocument(parsed);
    } catch {
      this.quarantineManifest();
      return { entries: {} };
    }
  }

  private validateManifestDocument(parsed: unknown): ManifestDocument {
    if (!isPlainObject(parsed) || !isPlainObject(parsed.entries)) {
      this.quarantineManifest();
      return { entries: {} };
    }
    const entries: Record<string, ManifestEntry> = {};
    for (const [key, value] of Object.entries(parsed.entries)) {
      if (!isPlainObject(value)) {
        this.quarantineManifest();
        return { entries: {} };
      }
      const {
        assetId,
        use,
        source,
        sourceSize,
        sourceMtimeMs,
        sourceFingerprint,
        fileName,
      } = value;
      if (
        typeof key !== 'string'
        || typeof assetId !== 'string'
        || use !== 'thumbnail'
        || typeof source !== 'string'
        || typeof sourceSize !== 'number'
        || typeof sourceMtimeMs !== 'number'
        || typeof sourceFingerprint !== 'string'
        || typeof fileName !== 'string'
        || key !== thumbKey(assetId)
        || !isSafeFileName(fileName)
        || !isValidSourceFingerprint(sourceFingerprint)
        || path.parse(fileName).name !== sourceFingerprint
      ) {
        this.quarantineManifest();
        return { entries: {} };
      }
      const resolved = path.resolve(this.thumbsDir, fileName);
      if (!resolved.startsWith(path.resolve(this.thumbsDir) + path.sep)) {
        this.quarantineManifest();
        return { entries: {} };
      }
      entries[key] = {
        assetId,
        use,
        source,
        sourceSize,
        sourceMtimeMs,
        sourceFingerprint,
        fileName: path.basename(fileName),
      };
    }
    return { entries };
  }

  private quarantineManifest(): void {
    try {
      if (!fs.existsSync(this.manifestPath)) return;
      this.ensureThumbsDir();
      const quarantined = `${this.manifestPath}.invalid-${Date.now()}`;
      fs.renameSync(this.manifestPath, quarantined);
    } catch {
      // best-effort quarantine only
    }
  }

  private writeManifest(): void {
    this.ensureThumbsDir();
    const tempPath = `${this.manifestPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(this.#manifest, null, 2), 'utf8');
    fs.renameSync(tempPath, this.manifestPath);
  }

  private removeFileBestEffort(filePath: string): void {
    try {
      this.ensureThumbsDir();
      fs.rmSync(filePath, { force: true });
    } catch {
      // rebuildable cache only
    }
  }

  private revokeStaleThumbnailGrant(previousFileName: string | null, nextFileName: string | null): void {
    if (!previousFileName || previousFileName === nextFileName) return;
    revokeManagedMediaSource(path.join(this.thumbsDir, previousFileName), 'image');
  }

  private hasPendingEnsureJob(assetId: string): boolean {
    return this.#jobsByKey.has(ensureJobKey(assetId));
  }

  private enqueueEnsure(assetId: string, priority: 'interactive' | 'background'): Promise<EnsureMediaDerivativeResult> {
    const jobKey = ensureJobKey(assetId);
    const existing = this.#jobsByKey.get(jobKey);
    if (existing) {
      if (priority === 'interactive') this.promotePendingEnsureJob(jobKey);
      return existing;
    }
    return priority === 'interactive'
      ? this.enqueueInteractiveJob(jobKey, assetId, () => this.runEnsure(assetId))
      : this.enqueueBackgroundEnsureJob(jobKey, assetId, () => this.runEnsure(assetId));
  }

  private enqueueInteractiveJob(
    jobKey: string,
    assetId: string,
    runner: () => Promise<EnsureMediaDerivativeResult>,
  ): Promise<EnsureMediaDerivativeResult> {
    const existing = this.#jobsByKey.get(jobKey);
    if (existing) return existing;
    if (this.#interactiveJobKeys.size >= MAX_FOREGROUND_PENDING) {
      return Promise.resolve({ assetId, status: 'failed' });
    }
    return this.enqueueJob(jobKey, assetId, 'interactive', runner);
  }

  private enqueueBackgroundEnsureJob(
    jobKey: string,
    assetId: string,
    runner: () => Promise<EnsureMediaDerivativeResult>,
  ): Promise<EnsureMediaDerivativeResult> {
    return this.enqueueJob(jobKey, assetId, 'background', runner);
  }

  private enqueueJob(
    jobKey: string,
    assetId: string,
    priority: 'interactive' | 'background',
    runner: () => Promise<EnsureMediaDerivativeResult>,
  ): Promise<EnsureMediaDerivativeResult> {
    const promise = new Promise<EnsureMediaDerivativeResult>((resolve, reject) => {
      const job: DerivativeJob = { jobKey, assetId, priority, runner, resolve, reject };
      if (priority === 'interactive') this.#interactiveQueue.push(job);
      else this.#backgroundJobQueue.push(job);
      this.emitProgress();
      this.pumpWorkQueue();
    }).finally(() => {
      if (this.#jobsByKey.get(jobKey) === promise) {
        this.#jobsByKey.delete(jobKey);
        this.#interactiveJobKeys.delete(jobKey);
        this.#backgroundEnsureJobKeys.delete(jobKey);
      }
      this.emitProgress();
      this.pumpBackgroundAdmissions();
    });

    this.#jobsByKey.set(jobKey, promise);
    if (priority === 'interactive') this.#interactiveJobKeys.add(jobKey);
    else this.#backgroundEnsureJobKeys.add(jobKey);
    return promise;
  }

  private promotePendingEnsureJob(jobKey: string): void {
    const index = this.#backgroundJobQueue.findIndex((job) => job.jobKey === jobKey);
    if (index < 0) return;
    const [job] = this.#backgroundJobQueue.splice(index, 1);
    this.#backgroundEnsureJobKeys.delete(jobKey);
    this.#interactiveJobKeys.add(jobKey);
    job.priority = 'interactive';
    this.#interactiveQueue.push(job);
    this.emitProgress();
  }

  private dequeueBackgroundAsset(assetId: string): void {
    if (!this.#backgroundQueuedIds.delete(assetId)) return;
    this.#backgroundQueue = this.#backgroundQueue.filter((queuedAssetId) => queuedAssetId !== assetId);
  }

  private completeBackgroundAsset(assetId: string, kind: BackgroundResultKind): void {
    const batchIds = this.#backgroundBatchIdsByAssetId.get(assetId);
    if (!batchIds) return;
    for (const batchId of batchIds) {
      const batch = this.#backgroundBatches.find((candidate) => candidate.id === batchId);
      if (!batch) continue;
      if (kind === 'ready') batch.completed += 1;
      else batch.failed += 1;
    }
    this.#backgroundBatchIdsByAssetId.delete(assetId);
    this.trimBackgroundBatchHistory();
  }

  private trimBackgroundBatchHistory(): void {
    const activeBatchIds = new Set<number>();
    for (const ids of this.#backgroundBatchIdsByAssetId.values()) {
      for (const id of ids) activeBatchIds.add(id);
    }
    const retainedActive = this.#backgroundBatches.filter((batch) => activeBatchIds.has(batch.id));
    const retainedComplete = this.#backgroundBatches
      .filter((batch) => !activeBatchIds.has(batch.id))
      .slice(-MAX_BATCH_TRACKING);
    this.#backgroundBatches = [...retainedActive, ...retainedComplete];
  }

  private pumpWorkQueue(): void {
    while (this.#activeCount < MAX_CONCURRENT_DERIVATIVES) {
      const next = this.#interactiveQueue.shift() ?? this.#backgroundJobQueue.shift();
      if (!next) return;
      this.#activeCount += 1;
      this.emitProgress();
      void next.runner()
        .then((result) => {
          this.completeBackgroundAsset(next.assetId, result.status === 'ready' ? 'ready' : 'failed');
          next.resolve(result);
        }, (error) => {
          this.completeBackgroundAsset(next.assetId, 'failed');
          next.reject(error);
        })
        .finally(() => {
          this.#activeCount = Math.max(0, this.#activeCount - 1);
          this.emitProgress();
          this.pumpWorkQueue();
          this.pumpBackgroundAdmissions();
        });
    }
  }

  private pumpBackgroundAdmissions(): void {
    while (this.#backgroundEnsureJobKeys.size < MAX_BACKGROUND_ADMISSIONS) {
      const assetId = this.#backgroundQueue.shift();
      if (!assetId) return;
      this.#backgroundQueuedIds.delete(assetId);
      void this.enqueueEnsure(assetId, 'background').catch((error) => {
        console.error('[MediaDerivativeService] Background derivative scheduling failed:', error);
      });
      this.emitProgress();
    }
  }

  private progressSnapshot(): MediaDerivativeProgress {
    const total = this.#backgroundBatches.reduce((sum, batch) => sum + batch.total, 0);
    const completed = this.#backgroundBatches.reduce((sum, batch) => sum + batch.completed, 0);
    const failed = this.#backgroundBatches.reduce((sum, batch) => sum + batch.failed, 0);
    const queued = this.#interactiveQueue.length + this.#backgroundJobQueue.length + this.#backgroundQueue.length;
    const processed = completed + failed;
    const statusText = total > 0 && processed < total
      ? `Generating media thumbnails ${processed}/${total}`
      : null;
    return {
      active: this.#activeCount,
      queued,
      completed,
      total,
      failed,
      statusText,
    };
  }

  private emitProgress(patch?: SnapshotPatch): void {
    const progress = patch ? { ...this.progressSnapshot(), patch } : this.progressSnapshot();
    for (const listener of this.#progressListeners) listener(progress);
  }

  private isSnapshotPatch(value: unknown): value is SnapshotPatch {
    return isPlainObject(value) && typeof value.version === 'number' && isPlainObject(value.upserts) && isPlainObject(value.deletes);
  }

  private isSnapshot(value: unknown): value is AppSnapshot {
    return isPlainObject(value) && Array.isArray(value.mediaAssets) && Array.isArray(value.slides) && Array.isArray(value.slideElements);
  }

  private isEnsureResult(value: unknown): value is EnsureMediaDerivativeResult {
    return isPlainObject(value) && typeof value.assetId === 'string' && typeof value.status === 'string';
  }
}

import type { ReleaseApp } from './release-version.mjs';

export interface UpdateFileInfo {
  url: string;
  sha512: string;
  size?: number;
  blockMapSize?: number;
  [field: string]: unknown;
}

export interface UpdateInfo {
  version: string;
  files: UpdateFileInfo[];
  path?: string;
  sha512?: string;
  packages?: Record<string, { path: string; sha512?: string; [field: string]: unknown }>;
  releaseDate?: string;
  [field: string]: unknown;
}

export interface RewriteResult {
  text: string;
  version: string;
  artifacts: string[];
}

export type FeedUpdateReason =
  | 'release-not-published'
  | 'feed-empty'
  | 'feed-already-current'
  | 'feed-version-increased'
  | 'feed-repair';

export interface FeedUpdateInput {
  app: ReleaseApp | string;
  incomingVersion: string;
  currentFeedVersion?: string;
  releasePublished: boolean;
  feedInconsistent?: boolean;
}

export interface FeedUpdateDecision {
  shouldUpdate: boolean;
  reason: FeedUpdateReason;
  feedTag: string;
  incomingVersion: string;
  feedVersion: string;
}

export function feedTagFor(app: string): string;

export function isFeedMetadataFile(fileName: string): boolean;

export function parseUpdateMetadata(text: string, source?: string, app?: string): UpdateInfo;

export function normalizeDownloadBase(downloadBaseUrl: string): string;

export function rewriteUpdateMetadata(input: {
  text: string;
  downloadBaseUrl: string;
  source?: string;
  app?: string;
}): RewriteResult;

export function readFeedVersions(directory: string, app?: string): string[];

export function decideFeedUpdate(input: FeedUpdateInput): FeedUpdateDecision;

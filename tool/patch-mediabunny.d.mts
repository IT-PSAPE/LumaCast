import type { Plugin } from 'vite';
export interface MediaBunnyPatchOptions { rootDir?: string }
export interface VerifiedMediaBunnyPatch {
  packageDir: string;
  esmEntry: string;
  typesEntry: string;
  fingerprint: string;
  patchedFiles: string[];
}
export function applyMediaBunnyPatch(options?: MediaBunnyPatchOptions): VerifiedMediaBunnyPatch;
export function verifyMediaBunnyPatch(options?: MediaBunnyPatchOptions): VerifiedMediaBunnyPatch;
export function mediaBunnyPatchPlugin(options?: MediaBunnyPatchOptions): Plugin;

// Temporary re-export (#219): Id now lives in @lumacast/kernel, the
// dependency-free base of the package graph. This file exists only so
// existing @core/domain/ids call sites keep working during the migration;
// remove it once they import @lumacast/kernel directly.
export type { Id } from '@lumacast/kernel';

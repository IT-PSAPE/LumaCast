// Temporary re-export (#219): createId and nowIso now live in
// @lumacast/kernel, the dependency-free base of the package graph — kernel
// exists so id/timestamp generation doesn't force every future package to
// depend on the visual-document package. This file exists only so existing
// @core/utils call sites keep working during the migration; remove it once
// they import @lumacast/kernel directly.
export { createId, nowIso } from '@lumacast/kernel';

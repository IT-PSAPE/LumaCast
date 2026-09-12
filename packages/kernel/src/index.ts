// Public entry point for @lumacast/kernel (issue #219). Kernel is the base of
// the package graph: everything may depend on it, and it depends on nothing
// — no Electron, React, or app/ code. It is deliberately minimal but not a
// placeholder: Id, createId and nowIso have no home in the eight-package map
// because they are used by libraries, macros, cues and collections, entities
// with nothing to do with the visual document, so putting them anywhere else
// would force every future package to depend on "the visual document
// package" just to generate an id.
export type { Id } from './id';
export { createId } from './id';
export { nowIso } from './time';

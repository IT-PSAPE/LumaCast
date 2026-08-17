// Moved from app/core/utils.ts (#219). Implementation is byte-identical:
// app/database/test-support.ts patches the ambient `Date` global for
// deterministic runs (#200) — that patch depends on `nowIso` still calling
// `new Date()` exactly as written here.
export const nowIso = (): string => new Date().toISOString();

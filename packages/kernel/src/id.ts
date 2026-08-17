import crypto from 'node:crypto';

// Domain primitive (#219, moved from app/core/domain/ids.ts, originally #153):
// every entity in the domain model is addressed by an opaque string id.
export type Id = string;

// Moved from app/core/utils.ts (#219). Implementation is byte-identical:
// persisted data and the deterministic fixture generator in
// benchmarks/fixtures both depend on the id shape this produces, and
// app/database/test-support.ts patches `crypto.randomUUID` (both the
// ambient global and this `node:crypto` import) for deterministic runs
// (#200) — that patch depends on `createId` still calling
// `crypto.randomUUID()` exactly as written here.
export const createId = (): string => crypto.randomUUID();

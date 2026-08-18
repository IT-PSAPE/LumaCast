export type {
  ProjectRecoveryHooks,
  RestoreProjectBackupOptions,
  RepositoryOptions,
} from './store';
export { CastRepository } from './store';

export type { Migration, RunMigrationsOptions } from './migrations';
export {
  MIGRATIONS,
  FutureSchemaVersionError,
  LATEST_SCHEMA_VERSION,
  MigrationBackupError,
  runMigrations,
} from './migrations';

// Test-support helpers are consumed outside this package by
// benchmarks/fixtures/generator.ts, which needs a real repository handle and
// a deterministic id/clock runtime to generate reproducible fixtures.
export type {
  TestRepositoryHandle,
  TestRepositoryPaths,
  CreateTestRepositoryOptions,
  DeterministicRuntimeOptions,
} from './test-support';
export { createTestRepository, withDeterministicRuntime } from './test-support';

// Consumed by app/main/media-capability.ts to translate a managed-media
// capability id back to the stored `cast-media://...`/absolute path.
export { resolveLocalMediaSourcePath } from './media-source-utils';

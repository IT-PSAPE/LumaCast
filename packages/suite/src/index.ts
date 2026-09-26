// The single public entry point for @lumacast/suite. Everything here is
// renderer-safe data and pure functions: the registry of managed apps, the
// release-version rules, GitHub release-catalog and updater-metadata parsing,
// installer artifact selection, and the app-state derivation LumaCloud renders.
// Downloading, verifying, and installing stay in the Cloud main process.
export * from './types';
export {
  SUITE_ORGANIZATION,
  SUITE_APPS,
  SUITE_APP_IDS,
  LEGACY_MANAGED_IDENTITIES,
  suiteApp,
  isSuiteAppId,
  isManagedIdentity,
} from './registry';
export {
  parseVersion,
  compareVersions,
  isValidVersion,
} from './version';
export {
  parseReleaseCatalog,
  parseUpdateMetadata,
  updateMetadataFileNameFor,
} from './catalog';
export { selectInstallArtifact } from './artifacts';
export { deriveAppState } from './state';

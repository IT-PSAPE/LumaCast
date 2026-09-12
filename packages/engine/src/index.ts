// Public entry point for @lumacast/engine — the authoritative NDI output
// runtime and its supporting diagnostics/config-persistence pieces.
//
// `NdiHostCommand`/`NdiHostEvent` are the wire protocol between the main
// process and the NDI utility-process host; they are exported here so the
// two Electron-shaped shims that still live in app/main/ndi
// (ndi-host.ts, which runs inside the forked utility process, and
// ndi-service-proxy.ts, which forks it and is the sole command writer) can
// import them from the package's public surface rather than reaching past
// it. The architecture checker's `engine-session` rule restricts raw
// references to these two names to app/main/ndi and this package's own
// internals.

export { NdiService, NDI_FAST_BLACKOUT_BUDGET_MS, type BlackoutOptions } from './ndi-service';
export { NoopNdiService } from './ndi-noop-service';
export {
  defaultNdiModuleLoader,
  type NdiNativeModule,
  type NdiSenderConfig,
  type NdiRuntimeInfo,
} from './ndi-native-module';
export type {
  NdiServiceLike,
  NdiHostCommand,
  NdiHostEvent,
  BlackoutFlushOptions,
} from './ndi-protocol';
export { NdiConfigStore } from './ndi-config-store';
export { sampleSystemMetrics } from './system-metrics';

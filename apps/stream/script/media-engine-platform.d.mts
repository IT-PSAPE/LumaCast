export const REQUIRED_OUTPUT_PROTOCOLS: readonly string[];
export function assertRequiredOutputProtocols(protocolsOutput: string): void;
export function requiredEncodersForPlatform(platform: string): string[];
export function assertRequiredEncoders(encodersOutput: string, platform: string): void;
export function mediaEngineExecutableName(platform: string): string;
export interface MediaEngineBundle { version: string; url: string; sha256: string; buildTag: string; buildRepository: string }
export type MediaEngineSource =
  | { kind: 'download'; bundle: MediaEngineBundle }
  | { kind: 'explicit'; executable: string }
  | { kind: 'path'; command: string }
  | { kind: 'unsupported'; reason: string };
export function resolveMediaEngineSource(host: { platform: string; arch: string; env: Record<string, string | undefined>; development: boolean }): MediaEngineSource;
export function inspectBuildConfiguration(versionOutput: string): { gpl: boolean; shared: boolean; static: boolean };
export function assertSelfContainedMachO(otoolOutput: string): void;

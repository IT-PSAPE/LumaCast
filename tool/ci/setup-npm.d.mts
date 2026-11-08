import type { SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
export interface Toolchain { node: string; npm: string; packageManager: string }
export function readToolchain(rootDir?: string): Toolchain;
export function runCiNpm(mode: 'setup' | 'install', options?: {
  rootDir?: string;
  nodeVersion?: string;
  env?: NodeJS.ProcessEnv;
  run?: (command: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) => {
    status: number | null; stdout?: string; error?: Error;
  };
}): Toolchain;

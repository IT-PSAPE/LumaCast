// The platform-adapter factory: the one place that picks darwin/win32/linux
// by host platform. Everything above this (catalog, download, verification,
// permissions, operations, IPC) reaches the OS only through the returned
// `PlatformAdapter`.
import type { PlatformAdapter, PlatformAdapterDeps } from './adapter';
import { createDarwinPlatformAdapter } from './darwin';
import { createLinuxPlatformAdapter } from './linux';
import { createWin32PlatformAdapter } from './win32';

export function createPlatformAdapter(deps: PlatformAdapterDeps): PlatformAdapter {
  switch (deps.env.platform) {
    case 'darwin':
      return createDarwinPlatformAdapter(deps);
    case 'win32':
      return createWin32PlatformAdapter(deps);
    case 'linux':
      return createLinuxPlatformAdapter(deps);
    default: {
      const unsupported: never = deps.env.platform;
      throw new Error(`Unsupported platform: ${String(unsupported)}`);
    }
  }
}

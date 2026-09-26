// The one place platform adapters' injected side effects are real. Every
// adapter (darwin/win32/linux) is written against the `ExecFn`/`PlatformFs`
// interfaces in ./adapter and takes them as constructor deps precisely so
// this is the only file allowed to import Node builtins that touch the
// filesystem or spawn processes — the adapters stay pure over whatever the
// tests inject.
import { constants as fsConstants } from 'node:fs';
import { access, chmod, copyFile, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import type { ExecFn, ExecResult, PlatformAdapterDeps, PlatformEnv, PlatformFs } from './adapter';

/** A real `ExecFn` over `child_process.execFile`. Never spawns a shell. */
function createExecFn(): ExecFn {
  return (file, args, options) =>
    new Promise<ExecResult>((resolve, reject) => {
      const child = execFile(
        file,
        args as string[],
        {
          cwd: options?.cwd,
          timeout: options?.timeoutMs,
          // Installers/uninstallers and `ditto`/`hdiutil` output are small;
          // this just guards against a runaway process wedging the buffer.
          maxBuffer: 64 * 1024 * 1024,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error !== null && child.pid === undefined) {
            // The process never spawned (bad executable path, EACCES, …).
            // This is the only case ExecFn's contract rejects on.
            reject(error);
            return;
          }
          const exitCode = (error as (NodeJS.ErrnoException & { code?: unknown }) | null)?.code;
          const code = typeof exitCode === 'number' ? exitCode : (child.exitCode ?? (error ? -1 : 0));
          resolve({ code, stdout: stdout.toString(), stderr: stderr.toString() });
        },
      );

      const signal = options?.signal;
      if (signal !== undefined) {
        if (signal.aborted) {
          child.kill();
        } else {
          const onAbort = () => child.kill();
          signal.addEventListener('abort', onAbort, { once: true });
          child.once('exit', () => signal.removeEventListener('abort', onAbort));
        }
      }
    });
}

/** Spawns a detached, unwaited process (win32/linux "launch"). */
function createSpawnDetached(): (file: string, args: readonly string[]) => Promise<void> {
  return (file, args) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(file, args as string[], { detached: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
}

/** A real `PlatformFs` over `node:fs/promises`. */
function createPlatformFs(trash: (path: string) => Promise<void>): PlatformFs {
  return {
    exists: async (path) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
    readFile: (path) => readFile(path, 'utf8'),
    readDir: (path) => readdir(path),
    mkdir: async (path) => {
      await mkdir(path, { recursive: true });
    },
    copyFile: (from, to) => copyFile(from, to),
    rename: (from, to) => rename(from, to),
    remove: (path) => rm(path, { recursive: true, force: true }),
    chmod: (path, mode) => chmod(path, mode),
    writable: async (path) => {
      try {
        await access(path, fsConstants.W_OK);
        return true;
      } catch {
        return false;
      }
    },
    // Wired by main to Electron's `shell.trashItem`, which this module — the
    // sole Node-builtin-with-side-effects seam — does not import itself.
    trash,
  };
}

export function createNodePlatformDeps(
  env: PlatformEnv,
  trash: (path: string) => Promise<void>,
): PlatformAdapterDeps {
  return {
    env,
    exec: createExecFn(),
    fs: createPlatformFs(trash),
    spawnDetached: createSpawnDetached(),
  };
}

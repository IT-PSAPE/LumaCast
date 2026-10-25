// Persists where each managed app was installed, at <userData>/installs.json,
// so discovery trusts what install() recorded instead of re-deriving the
// location (registry, directory probes, Spotlight) on every launch. Records
// are keyed per app id and per scope. Follows settings-store.ts: zod-validated
// reads that degrade to empty on a corrupt file, serialized atomic writes
// (tmp + rename). A record is only a hint: adapters re-verify the binary
// exists before trusting it, and uninstall removes it.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { isSuiteAppId, type InstalledApp } from '@lumacast/suite';
import type { InstallRecords } from '../platform/adapter';

const recordSchema = z.object({
  app: z.string().min(1),
  scope: z.enum(['user', 'system', 'unknown']),
  location: z.string().min(1),
  version: z.string(),
});
const fileSchema = z.object({ records: z.array(recordSchema) });

const keyOf = (app: string, scope: string) => `${app}:${scope}`;

export class InstallRecordStore implements InstallRecords {
  private writeTail: Promise<void> = Promise.resolve();

  private constructor(
    private readonly filePath: string,
    private records: Map<string, InstalledApp>,
  ) {}

  static async open(filePath: string): Promise<InstallRecordStore> {
    return new InstallRecordStore(filePath, await InstallRecordStore.read(filePath));
  }

  private static async read(filePath: string): Promise<Map<string, InstalledApp>> {
    const records = new Map<string, InstalledApp>();
    let text: string;
    try {
      text = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[install-records] could not read installs.json, starting empty', error);
      }
      return records;
    }
    try {
      for (const record of fileSchema.parse(JSON.parse(text)).records) {
        // Records for since-removed app ids are dropped, not fatal.
        if (isSuiteAppId(record.app)) records.set(keyOf(record.app, record.scope), { ...record, app: record.app });
      }
    } catch (error) {
      console.error('[install-records] invalid installs.json, starting empty', error);
      records.clear();
    }
    return records;
  }

  get(app: InstalledApp['app'], scope: InstalledApp['scope']): InstalledApp | undefined {
    const record = this.records.get(keyOf(app, scope));
    return record ? { ...record } : undefined;
  }

  set(installed: InstalledApp): Promise<void> {
    return this.mutate((records) => records.set(keyOf(installed.app, installed.scope), { ...installed }));
  }

  remove(app: InstalledApp['app'], scope: InstalledApp['scope']): Promise<void> {
    return this.mutate((records) => {
      if (!records.delete(keyOf(app, scope))) return false;
    });
  }

  /** Serialized; `apply` returning false means nothing changed (skip the write). */
  private async mutate(apply: (records: Map<string, InstalledApp>) => unknown): Promise<void> {
    const run = this.writeTail.then(async () => {
      const next = new Map(this.records);
      if (apply(next) === false) return;
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, JSON.stringify({ records: [...next.values()] }, null, 2));
      await rename(tmp, this.filePath);
      this.records = next;
    });
    this.writeTail = run.catch(() => {});
    await run;
  }
}

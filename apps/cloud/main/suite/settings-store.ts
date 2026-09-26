// Persists CloudSettings (install scope, launch-check preference, and the
// per-app permission grants) at <userData>/settings.json. Reads are
// zod-validated so a corrupted or hand-edited file degrades to defaults
// instead of crashing the app; writes are atomic (tmp file + rename) with
// 0o600 permissions, since the file records which suite apps the user has
// authorised Cloud to manage.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { isManagedIdentity, isSuiteAppId, suiteApp, type SuiteAppId } from '@lumacast/suite';
import type { CloudSettings, CloudSettingsPatch, PermissionGrant } from '../../shared/desktop-api';

function defaultSettings(): CloudSettings {
  return { installScope: 'user', checkOnLaunch: true, grants: [] };
}

// Structural validation only: a grant's `app` is checked against the live
// suite registry afterwards, so a settings.json written by an older or newer
// Cloud build (with a since-removed app id) is treated the same as any other
// invalid file — defaults, not a crash.
const grantShapeSchema = z.object({
  bundleId: z.string().min(1),
  app: z.string().min(1),
  grantedAt: z.string().min(1),
});

const settingsShapeSchema = z.object({
  installScope: z.enum(['user', 'system']),
  checkOnLaunch: z.boolean(),
  grants: z.array(grantShapeSchema),
});

function parseCloudSettings(raw: unknown): CloudSettings {
  const shape = settingsShapeSchema.parse(raw);
  const grants: PermissionGrant[] = shape.grants.map((grant) => {
    if (!isSuiteAppId(grant.app)) {
      throw new Error(`settings.json: unknown suite app id "${grant.app}"`);
    }
    return { bundleId: grant.bundleId, app: grant.app, grantedAt: grant.grantedAt };
  });
  return { installScope: shape.installScope, checkOnLaunch: shape.checkOnLaunch, grants };
}

function cloneSettings(settings: CloudSettings): CloudSettings {
  return { ...settings, grants: settings.grants.map((grant) => ({ ...grant })) };
}

export class SettingsStore {
  private settings: CloudSettings;
  private writeTail: Promise<void> = Promise.resolve();

  private constructor(
    private readonly filePath: string,
    initial: CloudSettings,
  ) {
    this.settings = initial;
  }

  static async open(filePath: string): Promise<SettingsStore> {
    return new SettingsStore(filePath, await SettingsStore.readOrDefault(filePath));
  }

  private static async readOrDefault(filePath: string): Promise<CloudSettings> {
    let text: string;
    try {
      text = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultSettings();
      console.error('[settings-store] could not read settings.json, using defaults', error);
      return defaultSettings();
    }

    try {
      return parseCloudSettings(JSON.parse(text));
    } catch (error) {
      console.error('[settings-store] invalid settings.json, using defaults', error);
      return defaultSettings();
    }
  }

  get(): CloudSettings {
    return cloneSettings(this.settings);
  }

  async update(patch: CloudSettingsPatch): Promise<CloudSettings> {
    const next: CloudSettings = {
      ...this.settings,
      ...(patch.installScope !== undefined ? { installScope: patch.installScope } : {}),
      ...(patch.checkOnLaunch !== undefined ? { checkOnLaunch: patch.checkOnLaunch } : {}),
    };
    await this.persist(next);
    return this.get();
  }

  /**
   * Records the user's consent for Cloud to manage `app`. Refuses (leaves
   * settings unchanged) when `app` is Cloud's own identity — Cloud never
   * grants itself permission, it self-updates — or when `bundleId` does not
   * match a currently managed identity for that app; both guard against a
   * forged or stale renderer payload recording a grant for the wrong app.
   * Idempotent: granting an already-granted app is a no-op.
   */
  async grant(app: SuiteAppId, bundleId: string): Promise<CloudSettings> {
    if (app === 'cloud') return this.get();
    if (!isManagedIdentity(bundleId) || bundleId !== suiteApp(app).bundleId) return this.get();
    if (this.settings.grants.some((grant) => grant.app === app)) return this.get();

    const next: CloudSettings = {
      ...this.settings,
      grants: [...this.settings.grants, { app, bundleId, grantedAt: new Date().toISOString() }],
    };
    await this.persist(next);
    return this.get();
  }

  /** Idempotent: revoking an app with no grant is a no-op. */
  async revoke(app: SuiteAppId): Promise<CloudSettings> {
    if (!this.settings.grants.some((grant) => grant.app === app)) return this.get();

    const next: CloudSettings = {
      ...this.settings,
      grants: this.settings.grants.filter((grant) => grant.app !== app),
    };
    await this.persist(next);
    return this.get();
  }

  private async persist(next: CloudSettings): Promise<void> {
    const run = this.writeTail.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(tmp, this.filePath);
      this.settings = next;
    });
    this.writeTail = run.catch(() => {});
    await run;
  }
}

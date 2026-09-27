// Serializes every install/update/downgrade/uninstall through one queue: at
// most one operation runs at a time, so two apps installing at once (or a
// user mashing "update" twice) can never race the downloads directory or the
// platform adapter. Everything the queue touches is injected, so tests drive
// it with fake catalogs/adapters instead of real network and disk access.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  compareVersions,
  selectInstallArtifact,
  suiteApp,
  type AppRelease,
  type HostArch,
  type HostPlatform,
  type InstalledApp,
  type SuiteAppId,
  type UpdateMetadata,
  type VersionScheme,
} from '@lumacast/suite';
import type {
  CloudSettings,
  OperationKind,
  OperationProgress,
  OperationSnapshot,
  OperationStatus,
} from '../../shared/desktop-api';
import type { PlatformAdapter } from '../platform/adapter';
import { assertManaged } from './permissions';
import { downloadArtifact } from './download';

/** The last 50 finished operations are kept; older ones are dropped. */
const MAX_FINISHED_OPERATIONS = 50;

const TERMINAL_STATUSES: ReadonlySet<OperationStatus> = new Set(['done', 'failed', 'cancelled']);
const CANCELLABLE_STATUSES: ReadonlySet<OperationStatus> = new Set(['queued', 'downloading']);

export interface OperationCatalog {
  releasesFor: (app: SuiteAppId) => AppRelease[] | null;
  metadataFor: (release: AppRelease, platform: HostPlatform) => Promise<UpdateMetadata>;
}

export interface OperationSettingsReader {
  get: () => CloudSettings;
}

export interface OperationQueueDeps {
  catalog: OperationCatalog;
  adapter: PlatformAdapter;
  /** Read for the install scope only; the queue never writes settings. */
  settings: OperationSettingsReader;
  discover: (app: SuiteAppId) => Promise<InstalledApp | null>;
  platform: HostPlatform;
  arch: HostArch;
  downloadsDir: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  idFactory?: () => string;
}

export interface EnqueueInstallRequest {
  app: SuiteAppId;
  version?: string;
}

export interface EnqueueUninstallRequest {
  app: SuiteAppId;
  removeUserData?: boolean;
}

interface OperationRecord {
  id: string;
  app: SuiteAppId;
  kind: OperationKind;
  version: string;
  status: OperationStatus;
  progress: OperationProgress;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  controller: AbortController | null;
  /** Resolves once the operation's task has fully settled (any terminal status). */
  settled: Promise<void> | null;
}

function isAbortError(error: unknown): boolean {
  // Deliberately not `error instanceof Error`: in some realms (e.g. jsdom's
  // test environment) `DOMException` and the ambient `Error` come from
  // different global objects, so an `instanceof` check silently fails and a
  // user-initiated cancel gets reported as a failure instead of `cancelled`.
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

function decideKind(
  installed: InstalledApp | null,
  release: AppRelease,
  versionScheme: VersionScheme,
): OperationKind {
  if (!installed) return 'install';
  const cmp = compareVersions(release.version, installed.version, versionScheme);
  if (cmp === 0) return 'install'; // same version requested again: reinstall.
  return cmp > 0 ? 'update' : 'downgrade';
}

const emptyProgress = (): OperationProgress => ({
  transferred: 0,
  total: null,
  percent: null,
  bytesPerSecond: null,
});

export declare interface OperationQueue {
  on(event: 'change', listener: (operation: OperationSnapshot) => void): this;
  off(event: 'change', listener: (operation: OperationSnapshot) => void): this;
}

export class OperationQueue extends EventEmitter {
  private readonly records = new Map<string, OperationRecord>();
  private readonly order: string[] = [];
  private readonly pending: string[] = [];
  private readonly tasks = new Map<string, () => Promise<void>>();
  private activeId: string | null = null;

  constructor(private readonly deps: OperationQueueDeps) {
    super();
  }

  async enqueueInstall(request: EnqueueInstallRequest): Promise<OperationSnapshot> {
    assertManaged(request.app);
    const descriptor = suiteApp(request.app);

    const releases = this.deps.catalog.releasesFor(request.app);
    if (!releases) {
      throw new Error(`The release catalog has not loaded yet for ${descriptor.productName}`);
    }

    const release = request.version
      ? releases.find((candidate) => candidate.version === request.version)
      : releases[0];
    if (!release) {
      throw request.version
        ? new Error(`${descriptor.productName} ${request.version} is not in the release catalog`)
        : new Error(`No installable release is available for ${descriptor.productName}`);
    }

    const installed = await this.deps.discover(request.app);
    const kind = decideKind(installed, release, descriptor.versionScheme);
    const record = this.createRecord({ app: request.app, kind, version: release.version });

    this.tasks.set(record.id, () => this.runInstall(record, release));
    this.pending.push(record.id);
    this.pump();

    return this.toSnapshot(record);
  }

  async enqueueUninstall(request: EnqueueUninstallRequest): Promise<OperationSnapshot> {
    assertManaged(request.app);
    const descriptor = suiteApp(request.app);

    const installed = await this.deps.discover(request.app);
    if (!installed) {
      throw new Error(`${descriptor.productName} is not installed`);
    }

    const record = this.createRecord({ app: request.app, kind: 'uninstall', version: installed.version });

    this.tasks.set(record.id, () => this.runUninstall(record, installed, request.removeUserData ?? false));
    this.pending.push(record.id);
    this.pump();

    return this.toSnapshot(record);
  }

  async cancel(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) {
      throw new Error(`Unknown operation "${id}"`);
    }

    if (!isCancellableStatus(record.status)) {
      throw new Error(`Operation "${id}" cannot be cancelled (status: ${record.status})`);
    }

    if (record.status === 'queued') {
      const index = this.pending.indexOf(id);
      if (index !== -1) this.pending.splice(index, 1);
      this.tasks.delete(id);
      this.finish(record, 'cancelled');
      return;
    }

    // 'downloading': abort the in-flight fetch and wait for the task's catch
    // branch to settle the operation as 'cancelled'.
    record.controller?.abort();
    await record.settled;
  }

  operations(): OperationSnapshot[] {
    return this.order.map((id) => this.toSnapshot(this.records.get(id)!));
  }

  private createRecord(params: { app: SuiteAppId; kind: OperationKind; version: string }): OperationRecord {
    const id = this.deps.idFactory ? this.deps.idFactory() : randomUUID();
    const startedAt = (this.deps.now ? this.deps.now() : new Date()).toISOString();
    const record: OperationRecord = {
      id,
      app: params.app,
      kind: params.kind,
      version: params.version,
      status: 'queued',
      progress: emptyProgress(),
      error: null,
      startedAt,
      finishedAt: null,
      controller: null,
      settled: null,
    };
    this.records.set(id, record);
    this.order.push(id);
    this.emitChange(record);
    return record;
  }

  private pump(): void {
    if (this.activeId !== null) return;
    const nextId = this.pending.shift();
    if (nextId === undefined) return;

    const record = this.records.get(nextId);
    const task = this.tasks.get(nextId);
    if (!record || !task) {
      this.pump();
      return;
    }

    this.activeId = nextId;
    const settled = task()
      .catch(() => {
        // Every task already routes its own errors into `fail`/`finish`; this
        // catch only exists so a rejected task promise can never surface as
        // an unhandled rejection.
      })
      .finally(() => {
        this.tasks.delete(nextId);
        this.activeId = null;
        this.pump();
      });
    record.settled = settled;
  }

  private async runInstall(record: OperationRecord, release: AppRelease): Promise<void> {
    const descriptor = suiteApp(record.app);
    const controller = new AbortController();
    record.controller = controller;
    this.setStatus(record, 'downloading');

    try {
      const metadata = await this.deps.catalog.metadataFor(release, this.deps.platform);
      const artifact = selectInstallArtifact({
        app: descriptor,
        release,
        metadata,
        platform: this.deps.platform,
        arch: this.deps.arch,
      });
      const destination = path.join(this.deps.downloadsDir, descriptor.id, artifact.name);

      await downloadArtifact({
        url: artifact.url,
        destination,
        expectedSha512: artifact.sha512,
        expectedSize: artifact.size,
        fetch: this.deps.fetch,
        signal: controller.signal,
        onProgress: (progress) => this.updateProgress(record, progress),
      });

      this.setStatus(record, 'verifying');
      this.setStatus(record, 'installing');
      await this.deps.adapter.install({
        app: descriptor,
        artifact,
        artifactPath: destination,
        scope: this.deps.settings.get().installScope,
        signal: controller.signal,
        onStage: (stage) => {
          console.debug(`[operations] ${descriptor.productName} install: ${stage}`);
        },
      });

      await unlink(destination).catch(() => {});
      this.finish(record, 'done');
    } catch (error) {
      if (isAbortError(error)) {
        this.finish(record, 'cancelled');
      } else {
        this.fail(record, error);
      }
    }
  }

  private async runUninstall(
    record: OperationRecord,
    installed: InstalledApp,
    removeUserData: boolean,
  ): Promise<void> {
    const descriptor = suiteApp(record.app);
    const controller = new AbortController();
    record.controller = controller;
    this.setStatus(record, 'removing');

    try {
      await this.deps.adapter.uninstall({
        app: descriptor,
        installed,
        removeUserData,
        signal: controller.signal,
      });
      this.finish(record, 'done');
    } catch (error) {
      if (isAbortError(error)) {
        this.finish(record, 'cancelled');
      } else {
        this.fail(record, error);
      }
    }
  }

  private setStatus(record: OperationRecord, status: OperationStatus): void {
    record.status = status;
    this.emitChange(record);
  }

  private updateProgress(record: OperationRecord, progress: OperationProgress): void {
    record.progress = progress;
    this.emitChange(record);
  }

  private finish(record: OperationRecord, status: 'done' | 'cancelled'): void {
    record.status = status;
    record.finishedAt = (this.deps.now ? this.deps.now() : new Date()).toISOString();
    this.emitChange(record);
    this.trimFinished();
  }

  private fail(record: OperationRecord, error: unknown): void {
    record.status = 'failed';
    record.error = error instanceof Error ? error.message : String(error);
    record.finishedAt = (this.deps.now ? this.deps.now() : new Date()).toISOString();
    this.emitChange(record);
    this.trimFinished();
  }

  private trimFinished(): void {
    let finishedSeen = 0;
    for (let i = this.order.length - 1; i >= 0; i -= 1) {
      const record = this.records.get(this.order[i]!);
      if (!record || !TERMINAL_STATUSES.has(record.status)) continue;
      finishedSeen += 1;
      if (finishedSeen > MAX_FINISHED_OPERATIONS) {
        this.records.delete(this.order[i]!);
        this.order.splice(i, 1);
      }
    }
  }

  private toSnapshot(record: OperationRecord): OperationSnapshot {
    return {
      id: record.id,
      app: record.app,
      kind: record.kind,
      version: record.version,
      status: record.status,
      progress: { ...record.progress },
      error: record.error,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
    };
  }

  private emitChange(record: OperationRecord): void {
    this.emit('change', this.toSnapshot(record));
  }
}

// Exported for tests that want to assert cancellability rules without
// depending on OperationQueue's internals.
export function isCancellableStatus(status: OperationStatus): boolean {
  return CANCELLABLE_STATUSES.has(status);
}

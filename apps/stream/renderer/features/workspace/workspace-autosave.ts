import type { StreamAPI, StreamProject } from '../../../shared/desktop-api';

interface WorkspaceRevision {
  collectionId: string;
  profileId: string;
  project: StreamProject;
}

/** One API session owns its revisions, including revisions queued during a save. */
export class WorkspaceAutosave {
  private pending: WorkspaceRevision | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  onError: ((error: unknown) => void) | null = null;

  constructor(private readonly api: Pick<StreamAPI, 'saveProject'>) {}

  schedule(revision: WorkspaceRevision): void {
    this.pending = revision;
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch((error) => this.onError?.(error));
    }, 250);
  }

  flush(): Promise<void> {
    this.cancelTimer();
    if (this.saving) return this.saving;
    this.saving = this.drain().then(() => {
      this.saving = null;
      // A revision can arrive after drain's final await and before this task.
      if (this.pending) return this.flush();
    }, (error) => { this.saving = null; throw error; });
    return this.saving;
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const revision = this.pending;
      this.pending = null;
      try {
        await this.api.saveProject(revision.collectionId, revision.profileId, revision.project);
      } catch (error) {
        // A newer revision supersedes a failed write, but a failed final write
        // must remain available for the next close attempt or workspace action.
        this.pending ??= revision;
        throw error;
      }
    }
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

// Project file IO: reading/writing `.lumachord` files (delegated to the
// shared project schema for parsing/serializing), plus the recent-projects
// list persisted alongside them. Both writers go through a tmp-file-then-
// rename so a crash or a full disk mid-write never leaves a half-written
// file where the real one used to be (mirrors apps/flux/main/index.ts's
// settings/connection-file writes).
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseProjectFile, serializeProject } from '../shared/project-schema';
import {
  PROJECT_FILE_EXTENSION,
  type ChordProject,
  type ProjectDocument,
  type RecentProject,
} from '../shared/project';

/** electron dialog `filters` for opening/saving a `.lumachord` file. */
export const PROJECT_DIALOG_FILTERS = [
  { name: 'LumaChord Project', extensions: [PROJECT_FILE_EXTENSION] },
];

const MAX_RECENT_PROJECTS = 10;

async function writeFileAtomically(filePath: string, contents: string): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp-${randomUUID()}`);
  await writeFile(tmpPath, contents, 'utf8');
  try {
    await rename(tmpPath, filePath);
  } catch (error) {
    await unlink(tmpPath).catch(() => {});
    throw error;
  }
}

export async function readProjectFile(filePath: string): Promise<ProjectDocument> {
  const text = await readFile(filePath, 'utf8');
  const project = parseProjectFile(text);
  return { project, path: filePath };
}

export async function writeProjectFile(filePath: string, project: ChordProject): Promise<void> {
  await writeFileAtomically(filePath, serializeProject(project));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function isRecentProjectShape(value: unknown): value is RecentProject {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.path === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.openedAt === 'string'
  );
}

/**
 * `<userData>/recent-projects.json`: at most `MAX_RECENT_PROJECTS` entries,
 * newest first, deduped by path. `list()` drops entries whose file no longer
 * exists (and persists the pruned list back), so a moved/deleted project
 * silently falls out of Open Recent instead of erroring when clicked.
 */
export class RecentProjectsStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<RecentProject[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    const candidates = parsed.filter(isRecentProjectShape);
    const survivors: RecentProject[] = [];
    for (const entry of candidates) {
      if (await fileExists(entry.path)) survivors.push(entry);
    }

    if (survivors.length !== candidates.length) {
      await this.save(survivors);
    }
    return survivors;
  }

  /** Adds/moves `entry` to the front, deduped by path, capped at 10. */
  async push(entry: RecentProject): Promise<RecentProject[]> {
    const current = await this.list();
    const deduped = current.filter((item) => item.path !== entry.path);
    const next = [entry, ...deduped].slice(0, MAX_RECENT_PROJECTS);
    await this.save(next);
    return next;
  }

  private async save(entries: RecentProject[]): Promise<void> {
    await writeFileAtomically(this.filePath, JSON.stringify(entries, null, 2));
  }
}

/** Reads a UTF-8 text file, rejecting anything over `maxBytes` without
 *  reading its full contents into memory first. Used for cue-file imports,
 *  which are admitted media but must also stay small. */
export async function readTextFileWithLimit(filePath: string, maxBytes: number): Promise<string> {
  const stats = await stat(filePath);
  if (stats.size > maxBytes) {
    throw new Error(`File exceeds the ${maxBytes} byte limit: ${filePath}`);
  }
  return readFile(filePath, 'utf8');
}

export async function writeTextFile(filePath: string, text: string): Promise<void> {
  await writeFileAtomically(filePath, text);
}

export type ChangeScope = 'all' | 'none' | 'apps';

export interface ChangeDecision {
  scope: ChangeScope;
  /** Selected apps for `scope: 'apps'`; empty otherwise. */
  apps: string[];
  reason: string;
}

export interface ChangedFileDecision extends ChangeDecision {
  file: string;
}

export interface DependencyGraph {
  apps: string[];
  packages: string[];
  /** Each app's transitive package closure. */
  appPackages: Map<string, Set<string>>;
  /** Each package's direct package imports. */
  packageEdges: Map<string, Set<string>>;
  /** Each package's app dependents, through any depth. */
  dependents: Map<string, Set<string>>;
}

export interface AffectedApps {
  apps: string[];
  all: boolean;
  changes: ChangedFileDecision[];
}

export type DecisionMode = 'explicit' | 'diff' | 'no-baseline';

export interface AppsDecision extends AffectedApps {
  graph: DependencyGraph;
  mode: DecisionMode;
  baseline: string | null;
}

export const REPO_ROOT: string;

export function discoverWorkspaces(rootDir: string): { apps: string[]; packages: string[] };

export function scanWorkspaceImports(rootDir: string, workspaceDir: string): Set<string>;

export function buildDependencyGraph(rootDir: string): DependencyGraph;

export function classifyChangedFile(file: string, graph: DependencyGraph): ChangeDecision;

export function affectedAppsFor(changedFiles: Iterable<string>, graph: DependencyGraph): AffectedApps;

export function parseAppSelection(input: string | undefined, graph: DependencyGraph): string[];

export function testPathsFor(app: string, graph: DependencyGraph): string[];

/**
 * Changed paths from merge-base(base, head) to head, or null without a usable
 * baseline. With the default head (`HEAD`) unstaged and untracked files count.
 */
export function changedFilesBetween(rootDir: string, base: string | undefined, head?: string): string[] | null;

export function decideApps(options: { rootDir: string; apps?: string; base?: string; head?: string }): AppsDecision;

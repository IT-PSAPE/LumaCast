import type { DependencyGraph } from './affected-apps.mjs';
export interface RunOptions {
  apps: string[];
  all: boolean;
  affected: boolean;
  e2e: boolean;
  skip: Set<string>;
  only: Set<string> | null;
  head: string;
  base?: string;
  listSteps?: boolean;
  help?: boolean;
}
export interface PlanEntry { step: string; label: string; executable: string; args: string[]; env?: Record<string, string> }
export const STEPS: string[];
export const SHARED_STEPS: Set<string>;
export function parseArgs(argv: string[]): RunOptions;
export function planFor(app: string, graph: DependencyGraph, options: RunOptions): PlanEntry[];
export function commandSpec(executable: string, args: string[], platform?: NodeJS.Platform): { command: string; args: string[]; shell: boolean };
export function main(argv: string[]): number;

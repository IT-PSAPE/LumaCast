export interface PreparedElectron {
  binaryPath: string;
  packagePath: string;
  version: string;
  sandboxPath: string | null;
}
export function prepareAppElectron(app: string, options?: { rootDir?: string; platform?: NodeJS.Platform }): PreparedElectron;
export function main(argv: string[], env?: NodeJS.ProcessEnv, options?: { rootDir?: string; platform?: NodeJS.Platform }): PreparedElectron;

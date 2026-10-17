import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helperDirectory = path.join(appDirectory, 'native', 'audio-loopback');
const outputDirectory = path.join(helperDirectory, 'publish');
const projectPath = path.join(helperDirectory, 'AudioLoopback.csproj');

const result = spawnSync('dotnet', [
  'publish', projectPath,
  '--configuration', 'Release',
  '--runtime', 'win-x64',
  '--self-contained', 'true',
  '--output', outputDirectory,
  '-p:PublishSingleFile=true',
  '-p:IncludeNativeLibrariesForSelfExtract=true',
], { cwd: appDirectory, stdio: 'inherit', windowsHide: true });

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Stream application-audio helper is ready for Windows x64.');

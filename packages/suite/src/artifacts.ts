// Selects the one installer artifact Cloud downloads for a given host, by
// joining electron-builder's `latest*.yml` file list (which names files but
// not download URLs) with the GitHub release assets (which have both).
import type {
  AppRelease,
  HostArch,
  HostPlatform,
  InstallArtifact,
  InstallerKind,
  SuiteAppDescriptor,
  UpdateMetadata,
} from './types';

interface Candidate {
  name: string;
  url: string;
  sha512: string;
  size: number;
}

function joinCandidates(release: AppRelease, metadata: UpdateMetadata): Candidate[] {
  const candidates: Candidate[] = [];
  for (const file of metadata.files) {
    const asset = release.assets.find((candidate) => candidate.name === file.url);
    if (!asset) continue; // Metadata names a file this release did not attach.
    if (asset.size !== file.size) {
      throw new Error(
        `Update metadata size mismatch for "${file.url}": metadata says ${file.size}, asset says ${asset.size}.`,
      );
    }
    candidates.push({ name: asset.name, url: asset.browser_download_url, sha512: file.sha512, size: file.size });
  }
  return candidates;
}

type InstallerOs = 'mac' | 'win' | 'linux';

function isArchSpecific(name: string, ext: string, arch: HostArch, os: InstallerOs): boolean {
  return name.endsWith(`-${arch}-${os}${ext}`);
}

function isGenericForOs(name: string, ext: string, os: InstallerOs): boolean {
  if (!name.endsWith(`-${os}${ext}`)) return false;
  return !name.includes('-x64-') && !name.includes('-arm64-');
}

/** Never matches a `.blockmap` (checked explicitly: those never end in `ext`, but this keeps the rule visible). */
function pickByExtension(candidates: Candidate[], ext: string, arch: HostArch, os: InstallerOs): Candidate | null {
  const pool = candidates.filter((candidate) => candidate.name.endsWith(ext) && !candidate.name.endsWith('.blockmap'));
  const specific = pool.find((candidate) => isArchSpecific(candidate.name, ext, arch, os));
  if (specific) return specific;
  return pool.find((candidate) => isGenericForOs(candidate.name, ext, os)) ?? null;
}

function toArtifact(kind: InstallerKind, candidate: Candidate): InstallArtifact {
  return { kind, name: candidate.name, url: candidate.url, sha512: candidate.sha512, size: candidate.size };
}

function selectMac(candidates: Candidate[], arch: HostArch): InstallArtifact {
  const zip = pickByExtension(candidates, '.zip', arch, 'mac');
  if (zip) return toArtifact('mac-zip', zip);
  const dmg = pickByExtension(candidates, '.dmg', arch, 'mac');
  if (dmg) return toArtifact('mac-dmg', dmg);
  throw new Error(`No macOS installer for ${arch}`);
}

function selectWin(candidates: Candidate[], arch: HostArch): InstallArtifact {
  const exe = pickByExtension(candidates, '.exe', arch, 'win');
  if (exe) return toArtifact('win-nsis', exe);
  throw new Error(`No Windows installer for ${arch}`);
}

function selectLinux(candidates: Candidate[], arch: HostArch): InstallArtifact {
  const appImage = pickByExtension(candidates, '.AppImage', arch, 'linux');
  if (appImage) return toArtifact('linux-appimage', appImage);
  const deb = pickByExtension(candidates, '.deb', arch, 'linux');
  if (deb) return toArtifact('linux-deb', deb);
  throw new Error(`No Linux installer for ${arch}`);
}

export function selectInstallArtifact(input: {
  app: SuiteAppDescriptor;
  release: AppRelease;
  metadata: UpdateMetadata;
  platform: HostPlatform;
  arch: HostArch;
}): InstallArtifact {
  const candidates = joinCandidates(input.release, input.metadata);
  switch (input.platform) {
    case 'darwin':
      return selectMac(candidates, input.arch);
    case 'win32':
      return selectWin(candidates, input.arch);
    case 'linux':
      return selectLinux(candidates, input.arch);
    default: {
      const exhaustive: never = input.platform;
      throw new Error(`Unknown host platform: ${String(exhaustive)}`);
    }
  }
}

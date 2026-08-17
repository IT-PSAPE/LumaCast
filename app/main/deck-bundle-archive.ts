import { readFile, writeFile } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { validateDeckBundleManifest, validateProjectBackup } from '@core/deck-bundles';
import type { CodecContext } from '../contracts/codecs';
import type { DeckBundleManifest, ProjectBackup } from '@core/types';

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const MANIFEST_ENTRY_NAME = 'manifest.json';
const BACKUP_ENTRY_NAME = 'backup.json';

async function writeSingleEntryZip(filePath: string, entryName: string, data: Buffer): Promise<void> {
  const entryNameBuffer = Buffer.from(entryName, 'utf8');
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(LOCAL_FILE_HEADER_SIGNATURE, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(crc32(data), 14);
  localHeader.writeUInt32LE(data.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(entryNameBuffer.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const localSection = Buffer.concat([localHeader, entryNameBuffer, data]);
  const centralDirectory = Buffer.alloc(46);
  centralDirectory.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, 0);
  centralDirectory.writeUInt16LE(20, 4);
  centralDirectory.writeUInt16LE(20, 6);
  centralDirectory.writeUInt16LE(0, 8);
  centralDirectory.writeUInt16LE(0, 10);
  centralDirectory.writeUInt16LE(0, 12);
  centralDirectory.writeUInt16LE(0, 14);
  centralDirectory.writeUInt32LE(crc32(data), 16);
  centralDirectory.writeUInt32LE(data.length, 20);
  centralDirectory.writeUInt32LE(data.length, 24);
  centralDirectory.writeUInt16LE(entryNameBuffer.length, 28);
  centralDirectory.writeUInt16LE(0, 30);
  centralDirectory.writeUInt16LE(0, 32);
  centralDirectory.writeUInt16LE(0, 34);
  centralDirectory.writeUInt16LE(0, 36);
  centralDirectory.writeUInt32LE(0, 38);
  centralDirectory.writeUInt32LE(0, 42);

  const centralSection = Buffer.concat([centralDirectory, entryNameBuffer]);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(1, 8);
  endOfCentralDirectory.writeUInt16LE(1, 10);
  endOfCentralDirectory.writeUInt32LE(centralSection.length, 12);
  endOfCentralDirectory.writeUInt32LE(localSection.length, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  await writeFile(filePath, Buffer.concat([localSection, centralSection, endOfCentralDirectory]));
}

async function readSingleEntryZip(filePath: string): Promise<{ entryName: string; data: Buffer }> {
  const archive = await readFile(filePath);
  const endOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOffset < 0) {
    throw new Error('Invalid bundle archive.');
  }
  if (endOffset + 22 > archive.length) {
    throw new Error('Invalid bundle archive.');
  }

  const entryCountOnDisk = archive.readUInt16LE(endOffset + 8);
  const totalEntryCount = archive.readUInt16LE(endOffset + 10);
  if (entryCountOnDisk !== 1 || totalEntryCount !== 1) {
    throw new Error('Invalid bundle archive.');
  }

  const centralDirectorySize = archive.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(endOffset + 16);
  if (
    centralDirectorySize < 46 ||
    centralDirectoryOffset > endOffset - 46 ||
    centralDirectoryOffset + centralDirectorySize !== endOffset
  ) {
    throw new Error('Invalid bundle archive.');
  }

  if (archive.readUInt32LE(centralDirectoryOffset) !== CENTRAL_DIRECTORY_SIGNATURE) {
    throw new Error('Invalid bundle archive.');
  }

  const entryNameLength = archive.readUInt16LE(centralDirectoryOffset + 28);
  if (entryNameLength === 0 || 46 + entryNameLength > centralDirectorySize) {
    throw new Error('Invalid bundle archive.');
  }
  const localHeaderOffset = archive.readUInt32LE(centralDirectoryOffset + 42);
  if (localHeaderOffset + 30 > centralDirectoryOffset) {
    throw new Error('Invalid bundle archive.');
  }
  if (archive.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error('Invalid bundle archive.');
  }

  const localCrc = archive.readUInt32LE(localHeaderOffset + 14);
  const localCompressedSize = archive.readUInt32LE(localHeaderOffset + 18);
  const localUncompressedSize = archive.readUInt32LE(localHeaderOffset + 22);
  const centralCrc = archive.readUInt32LE(centralDirectoryOffset + 16);
  const centralCompressedSize = archive.readUInt32LE(centralDirectoryOffset + 20);
  const centralUncompressedSize = archive.readUInt32LE(centralDirectoryOffset + 24);
  if (
    localCompressedSize !== localUncompressedSize ||
    localCompressedSize !== centralCompressedSize ||
    centralCompressedSize !== centralUncompressedSize
  ) {
    throw new Error('Invalid bundle archive.');
  }
  const dataLength = centralCompressedSize;

  const compressionMethod = archive.readUInt16LE(localHeaderOffset + 8);
  if (compressionMethod !== 0) {
    throw new Error('Unsupported bundle compression.');
  }

  const localNameLength = archive.readUInt16LE(localHeaderOffset + 26);
  const extraFieldLength = archive.readUInt16LE(localHeaderOffset + 28);
  const dataOffset = localHeaderOffset + 30 + localNameLength + extraFieldLength;
  if (dataOffset > centralDirectoryOffset || dataOffset + dataLength > centralDirectoryOffset) {
    throw new Error('Invalid bundle archive.');
  }

  const centralEntryName = archive.subarray(centralDirectoryOffset + 46, centralDirectoryOffset + 46 + entryNameLength).toString('utf8');
  const localEntryName = archive.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localNameLength).toString('utf8');
  if (localEntryName !== centralEntryName) {
    throw new Error('Invalid bundle archive.');
  }

  const data = archive.subarray(dataOffset, dataOffset + dataLength);

  if (localCrc !== centralCrc || crc32(data) !== centralCrc) {
    throw new Error('Invalid bundle archive.');
  }

  return { entryName: centralEntryName, data };
}

export async function writeDeckBundleArchive(filePath: string, manifest: DeckBundleManifest): Promise<void> {
  validateDeckBundleManifest(manifest, archiveContext('writeDeckBundleArchive'));
  const data = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
  await writeSingleEntryZip(filePath, MANIFEST_ENTRY_NAME, data);
}

export async function readDeckBundleArchive(filePath: string): Promise<DeckBundleManifest> {
  const { entryName, data } = await readSingleEntryZip(filePath);
  if (entryName !== MANIFEST_ENTRY_NAME) {
    throw new Error('Invalid bundle entry.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString('utf8'));
  } catch (error) {
    throw new Error(`Invalid bundle manifest: ${(error as Error).message}`);
  }
  return validateDeckBundleManifest(parsed, archiveContext('readDeckBundleArchive'));
}

function archiveContext(operation: string): CodecContext {
  return { boundary: 'bundle-archive', operation, path: 'manifest' };
}

export async function writeProjectBackupArchive(filePath: string, backup: ProjectBackup): Promise<void> {
  validateProjectBackup(backup);
  const data = Buffer.from(JSON.stringify(backup, null, 2), 'utf8');
  await writeSingleEntryZip(filePath, BACKUP_ENTRY_NAME, data);
}

export async function readProjectBackupArchive(filePath: string): Promise<ProjectBackup> {
  const { entryName, data } = await readSingleEntryZip(filePath);
  if (entryName !== BACKUP_ENTRY_NAME) {
    throw new Error('Invalid backup entry.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString('utf8'));
  } catch (error) {
    throw new Error(`Invalid backup document: ${(error as Error).message}`);
  }
  return validateProjectBackup(parsed);
}
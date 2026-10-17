declare module 'yazl' {
  import type { Readable } from 'node:stream';

  export interface ZipEntryOptions {
    compress?: boolean;
    compressionLevel?: number;
    mtime?: Date;
    mode?: number;
  }

  export class ZipFile {
    readonly outputStream: Readable;
    addBuffer(buffer: Buffer, metadataPath: string, options?: ZipEntryOptions): void;
    addFile(realPath: string, metadataPath: string, options?: ZipEntryOptions): void;
    end(): void;
  }
}

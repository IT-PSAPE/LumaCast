import { safeStorage } from 'electron';

export interface SecureStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export const electronSecureStorage = safeStorage as SecureStorage;

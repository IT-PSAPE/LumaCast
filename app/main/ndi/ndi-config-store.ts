import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { NdiOutputConfigMap } from '@core/types';
import {
  createDefaultNdiOutputConfigs,
  migrateLegacyNdiOutputConfigs,
  normalizeNdiOutputConfigs,
} from '@core/ndi';
import { CodecError, decodeStoredNdiOutputConfigMap, type CodecContext } from '../../contracts/codecs';

const CONFIG_FILE = 'ndi-output-config.json';
const CURRENT_CONFIG_VERSION = 2;

interface StoredNdiOutputConfigFile {
  version: number;
  outputs: NdiOutputConfigMap;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function ndiConfigContext(operation: string, fieldPath = 'outputs'): CodecContext {
  return { boundary: 'ndi-config', operation, path: fieldPath };
}

export class NdiConfigStore {
  private filePath: string;

  constructor() {
    this.filePath = path.join(app.getPath('userData'), CONFIG_FILE);
  }

  /**
   * Loads and decodes the persisted config file (issue #150: a hand-edited
   * or corrupted file is a real decode boundary, not just a JSON.parse
   * check). A current-version file's `outputs` map is decoded per known field
   * (`senderName`/`withAlpha`) via `decodeStoredNdiOutputConfigMap`;
   * unrecognized keys are tolerated there, but a missing or wrong-typed known
   * field is not.
   *
   * A failed decode does NOT discard the file: this is compatibility-tolerant
   * stored preferences, not a security boundary, so it falls back to
   * `normalizeNdiOutputConfigs`, which heals field by field. Discarding the
   * whole map instead would reset BOTH outputs' sender names because one field
   * of one output was wrong, and an operator's NDI sender names are
   * configuration they chose for a live broadcast setup. The `CodecError` is
   * logged first, with its exact field path, so a bad file is diagnosable
   * rather than silently healed.
   *
   * Only an unreadable or unparseable file falls all the way back to defaults,
   * since then there is nothing left to heal.
   */
  load(): NdiOutputConfigMap {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as unknown;
    } catch {
      return createDefaultNdiOutputConfigs();
    }

    if (isRecord(parsed) && parsed.version === CURRENT_CONFIG_VERSION && 'outputs' in parsed) {
      const storedOutputs = isRecord(parsed.outputs) ? (parsed.outputs as NdiOutputConfigMap) : null;
      try {
        return decodeStoredNdiOutputConfigMap(parsed.outputs, ndiConfigContext('load'));
      } catch (error) {
        if (error instanceof CodecError) {
          console.error('[NdiConfigStore] Invalid config file, healing per field:', error.message);
        }
        return normalizeNdiOutputConfigs(storedOutputs);
      }
    }

    return migrateLegacyNdiOutputConfigs(isRecord(parsed) ? (parsed as NdiOutputConfigMap) : null);
  }

  save(configs: NdiOutputConfigMap): void {
    try {
      const payload: StoredNdiOutputConfigFile = {
        version: CURRENT_CONFIG_VERSION,
        outputs: normalizeNdiOutputConfigs(configs),
      };
      fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (error) {
      console.error('[NdiConfigStore] Failed to save config:', error);
    }
  }
}

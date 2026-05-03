import type { NdiOutputConfig, NdiOutputConfigMap, NdiOutputName } from './types';

export const NDI_OUTPUT_WIDTH = 1920;
export const NDI_OUTPUT_HEIGHT = 1080;
type PartialNdiOutputConfigMap = Partial<Record<NdiOutputName, Partial<NdiOutputConfig>>>;

export interface NdiOutputDefinition extends NdiOutputConfig {
  output: NdiOutputName;
  width: number;
  height: number;
}

export const NDI_OUTPUT_DEFINITIONS: Record<NdiOutputName, NdiOutputDefinition> = {
  audience: {
    output: 'audience',
    senderName: 'LumaCast - Audience',
    width: NDI_OUTPUT_WIDTH,
    height: NDI_OUTPUT_HEIGHT,
    withAlpha: false,
  },
  stage: {
    output: 'stage',
    senderName: 'LumaCast - Stage',
    width: NDI_OUTPUT_WIDTH,
    height: NDI_OUTPUT_HEIGHT,
    withAlpha: false,
  },
};

export const NDI_OUTPUT_ORDER: NdiOutputName[] = ['audience', 'stage'];

export function createDefaultNdiOutputConfigs(): NdiOutputConfigMap {
  return {
    audience: {
      senderName: NDI_OUTPUT_DEFINITIONS.audience.senderName,
      withAlpha: NDI_OUTPUT_DEFINITIONS.audience.withAlpha,
    },
    stage: {
      senderName: NDI_OUTPUT_DEFINITIONS.stage.senderName,
      withAlpha: NDI_OUTPUT_DEFINITIONS.stage.withAlpha,
    },
  };
}

function normalizeOutputConfigEntry(
  entry: Partial<NdiOutputConfig> | undefined,
  fallback: NdiOutputConfig,
): NdiOutputConfig {
  const senderName = typeof entry?.senderName === 'string' && entry.senderName.trim()
    ? entry.senderName.trim()
    : fallback.senderName;
  const withAlpha = typeof entry?.withAlpha === 'boolean'
    ? entry.withAlpha
    : fallback.withAlpha;
  return { senderName, withAlpha };
}

export function normalizeNdiOutputConfigs(configs?: PartialNdiOutputConfigMap | null): NdiOutputConfigMap {
  const defaults = createDefaultNdiOutputConfigs();
  return {
    audience: normalizeOutputConfigEntry(configs?.audience, defaults.audience),
    stage: normalizeOutputConfigEntry(configs?.stage, defaults.stage),
  };
}

export function migrateLegacyNdiOutputConfigs(configs?: PartialNdiOutputConfigMap | null): NdiOutputConfigMap {
  const normalized = normalizeNdiOutputConfigs(configs);
  return {
    audience: {
      senderName: normalized.audience.senderName,
      withAlpha: NDI_OUTPUT_DEFINITIONS.audience.withAlpha,
    },
    stage: {
      senderName: normalized.stage.senderName,
      withAlpha: NDI_OUTPUT_DEFINITIONS.stage.withAlpha,
    },
  };
}

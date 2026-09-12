import { Suspense, lazy, useEffect } from 'react';
import type { NdiOutputName } from '@lumacast/protocol';
import { useNdi } from '../../contexts/app-context';
import { setNdiAudioEnabledOutputs } from './ndi-audio-capture';

const NdiOutputs = lazy(() =>
  import('./ndi-outputs').then((module) => ({ default: module.NdiOutputs })),
);

export function NdiOutputsGate() {
  const { state: { outputState } } = useNdi();

  useEffect(() => {
    const enabled = new Set<NdiOutputName>();
    if (outputState.audience) enabled.add('audience');
    setNdiAudioEnabledOutputs(enabled);

    return () => {
      setNdiAudioEnabledOutputs(new Set<NdiOutputName>());
    };
  }, [outputState.audience]);

  if (!outputState.audience && !outputState.stage) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <NdiOutputs />
    </Suspense>
  );
}

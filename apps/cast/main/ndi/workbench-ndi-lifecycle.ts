import { NDI_OUTPUT_ORDER } from '@lumacast/protocol';
import type { NdiServiceLike } from '@lumacast/engine';

/** Operator loss must clear advertised enabled state after input leases drain. */
export async function stopWorkbenchNdi(gpu: { stop(): Promise<void> } | null, service: NdiServiceLike | null): Promise<void> {
  await gpu?.stop();
  if (!service) return;
  const state = service.getOutputState();
  for (const name of NDI_OUTPUT_ORDER) if (state[name]) service.setOutputEnabled(name, false);
}

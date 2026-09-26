// Permitted: an unrelated third-party package that happens to be called
// `photo-imaging` is not the Flux Node-side imaging layer, so the renderer/Node
// split does not apply to it. The ordinary external rules govern it instead.
import { contrast } from 'photo-imaging';
import { histogram } from 'photo-imaging/ops';

export const thirdParty = { contrast, histogram };

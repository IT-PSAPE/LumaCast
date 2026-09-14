// Vendor marks for the model picker (Settings and the chat composer both need
// this, hence its own module rather than a one-use inline component). Every
// SVG is bundled at build time from `@lobehub/icons-static-svg` (MIT) via
// Vite's `?raw` import — trusted, static asset content baked into the app
// bundle, never user- or network-supplied, so inlining it via
// `dangerouslySetInnerHTML` carries no injection risk.
import type { AgentModelVendor } from '@lumacast/protocol';
import { cn } from '@renderer/utils/cn';

import anthropicSvg from '@lobehub/icons-static-svg/icons/claude.svg?raw';
import openaiSvg from '@lobehub/icons-static-svg/icons/openai.svg?raw';
import googleSvg from '@lobehub/icons-static-svg/icons/gemini.svg?raw';
import deepseekSvg from '@lobehub/icons-static-svg/icons/deepseek.svg?raw';
import qwenSvg from '@lobehub/icons-static-svg/icons/qwen.svg?raw';
import mistralSvg from '@lobehub/icons-static-svg/icons/mistral.svg?raw';
import metaSvg from '@lobehub/icons-static-svg/icons/meta.svg?raw';
import xaiSvg from '@lobehub/icons-static-svg/icons/xai.svg?raw';
import moonshotSvg from '@lobehub/icons-static-svg/icons/kimi.svg?raw';
import zaiSvg from '@lobehub/icons-static-svg/icons/glmv.svg?raw';
import minimaxSvg from '@lobehub/icons-static-svg/icons/minimax.svg?raw';
import cohereSvg from '@lobehub/icons-static-svg/icons/cohere.svg?raw';
import microsoftSvg from '@lobehub/icons-static-svg/icons/microsoft.svg?raw';
import nvidiaSvg from '@lobehub/icons-static-svg/icons/nvidia.svg?raw';
import perplexitySvg from '@lobehub/icons-static-svg/icons/perplexity.svg?raw';
import opencodeSvg from '@lobehub/icons-static-svg/icons/opencode.svg?raw';

// Anthropic models show the Claude mark, not the Anthropic wordmark glyph —
// that's the mark users recognize from the model picker.
const VENDOR_LOGOS: Readonly<Record<AgentModelVendor, string>> = {
  anthropic: anthropicSvg,
  openai: openaiSvg,
  google: googleSvg,
  deepseek: deepseekSvg,
  qwen: qwenSvg,
  mistral: mistralSvg,
  meta: metaSvg,
  xai: xaiSvg,
  moonshot: moonshotSvg,
  zai: zaiSvg,
  minimax: minimaxSvg,
  cohere: cohereSvg,
  microsoft: microsoftSvg,
  nvidia: nvidiaSvg,
  perplexity: perplexitySvg,
  opencode: opencodeSvg,
};

export function ModelVendorLogo({ vendor, className }: { vendor: AgentModelVendor | null; className?: string }) {
  if (vendor === null) return null;
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex shrink-0 items-center justify-center [&>svg]:size-full', className)}
      dangerouslySetInnerHTML={{ __html: VENDOR_LOGOS[vendor] }}
    />
  );
}

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { AGENT_MODEL_VENDORS } from '@lumacast/protocol';
import { ModelVendorLogo } from '@renderer/features/agent/model-vendor-logo';

describe('ModelVendorLogo', () => {
  it.each(AGENT_MODEL_VENDORS)('renders an svg mark for vendor %s', (vendor) => {
    const { container } = render(<ModelVendorLogo vendor={vendor} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders nothing for a null vendor', () => {
    const { container } = render(<ModelVendorLogo vendor={null} />);
    expect(container.firstChild).toBeNull();
  });
});

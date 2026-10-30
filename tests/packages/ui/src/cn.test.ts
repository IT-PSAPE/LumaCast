import { describe, expect, it } from 'vitest';
import { cn } from '@lumacast/ui';

// tailwind-merge only drops an earlier class when it recognises both as the
// same property. The semantic radius scale is ours, not Tailwind's, so without
// the `extend` in cn.ts `rounded-control` and `rounded-full` both survive the
// merge and the winner is decided by stylesheet order instead of by the call
// site — a component's `className` override silently stops working. This is
// invisible until someone looks closely at one corner, so it is pinned here.
describe('cn', () => {
  it('lets a later radius override an earlier one, in either direction', () => {
    expect(cn('rounded-control', 'rounded-full')).toBe('rounded-full');
    expect(cn('rounded-full', 'rounded-control')).toBe('rounded-control');
    expect(cn('rounded-container', 'rounded-none')).toBe('rounded-none');
  });

  it('treats a per-corner radius as separate from the all-corner one', () => {
    expect(cn('rounded-surface', 'rounded-br-hairline')).toBe('rounded-surface rounded-br-hairline');
    expect(cn('rounded-br-control', 'rounded-br-hairline')).toBe('rounded-br-hairline');
  });

  it('still merges the Tailwind scales it already knew', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-primary', 'text-secondary')).toBe('text-secondary');
  });
});

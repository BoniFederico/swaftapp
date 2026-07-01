import { describe, it, expect } from 'vitest';
import { isAllowedOp, IPC_INVOKE_CHANNEL, ALLOWED_OPS } from './channels';

describe('IPC channel allow-list', () => {
  it('allows known ops only', () => {
    expect(isAllowedOp('system.ping')).toBe(true);
    expect(isAllowedOp('system.bogus')).toBe(false);
    expect(isAllowedOp('')).toBe(false);
  });

  it('exposes a single invoke channel', () => {
    expect(IPC_INVOKE_CHANNEL).toBe('swaft:invoke');
  });

  it('derives the allow-list from the op registry', () => {
    expect(ALLOWED_OPS.has('system.ping')).toBe(true);
  });
});

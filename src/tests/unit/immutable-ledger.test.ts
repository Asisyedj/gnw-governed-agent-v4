import { describe, expect, it } from 'vitest';
import { ImmutableLedger } from '../../core/ledger/ImmutableLedger';

describe('ImmutableLedger input integrity', () => {
  it('rejects an empty event type', async () => {
    const ledger = new ImmutableLedger();
    await expect(ledger.append('   ', { valid: true })).rejects.toThrow(TypeError);
    expect(ledger.getLength()).toBe(0);
    expect(ledger.verifyIntegrity()).toBe(true);
  });

  it('rejects a non-plain payload', async () => {
    const ledger = new ImmutableLedger();
    await expect(ledger.append('EVENT', null as never)).rejects.toThrow(TypeError);
    expect(ledger.getLength()).toBe(0);
    expect(ledger.verifyIntegrity()).toBe(true);
  });

  it('preserves the committed payload when the caller mutates it', async () => {
    const ledger = new ImmutableLedger();
    const payload = { status: 'planned' };
    const entry = await ledger.append('EVENT', payload);
    payload.status = 'changed';
    expect(entry.payload.status).toBe('planned');
    expect(ledger.getEntries()[0]?.payload.status).toBe('planned');
    expect(ledger.verifyIntegrity()).toBe(true);
  });
});

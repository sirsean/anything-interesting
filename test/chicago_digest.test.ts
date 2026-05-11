import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatChicagoDigestSlotFromIso, nextScheduledDigestLabel } from '../src/chicago_digest';
import * as chicago from '../src/chicago';

describe('chicago_digest', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('formatChicagoDigestSlotFromIso pads hour to two digits', () => {
    const slot = formatChicagoDigestSlotFromIso('2024-01-15T11:00:00.000Z');
    expect(slot).toBe('05:00 CT');
  });

  it('nextScheduledDigestLabel picks 05:00 when Chicago hour is before first digest', () => {
    vi.spyOn(chicago, 'getChicagoHour').mockReturnValue('3');
    expect(nextScheduledDigestLabel(new Date())).toBe('05:00 CT');
  });

  it('nextScheduledDigestLabel picks 15:00 in the mid-morning window', () => {
    vi.spyOn(chicago, 'getChicagoHour').mockReturnValue('10');
    expect(nextScheduledDigestLabel(new Date())).toBe('15:00 CT');
  });

  it('nextScheduledDigestLabel picks 18:00 after 15:00 digest', () => {
    vi.spyOn(chicago, 'getChicagoHour').mockReturnValue('16');
    expect(nextScheduledDigestLabel(new Date())).toBe('18:00 CT');
  });

  it('nextScheduledDigestLabel rolls to next day 05:00 after the last digest hour', () => {
    vi.spyOn(chicago, 'getChicagoHour').mockReturnValue('20');
    expect(nextScheduledDigestLabel(new Date())).toBe('05:00 CT');
  });
});

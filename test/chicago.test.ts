import { describe, expect, it } from 'vitest';
import { getChicagoHour, isDigestHour } from '../src/chicago';

describe('chicago', () => {
  it('getChicagoHour returns numeric hour string for a fixed UTC instant', () => {
    // 2024-01-15 11:00 UTC → 05:00 on that date in Chicago (CST, UTC-6)
    const d = new Date('2024-01-15T11:00:00.000Z');
    const h = getChicagoHour(d);
    expect(h).toMatch(/^\d+$/);
    expect(parseInt(h, 10)).toBe(5);
  });

  it('isDigestHour is true at 05, 15, 18 CT and false otherwise', () => {
    expect(isDigestHour(new Date('2024-01-15T11:00:00.000Z'))).toBe(true);
    expect(isDigestHour(new Date('2024-01-15T12:00:00.000Z'))).toBe(false);
    expect(isDigestHour(new Date('2024-01-15T21:00:00.000Z'))).toBe(true);
    expect(isDigestHour(new Date('2024-01-16T00:00:00.000Z'))).toBe(true);
  });
});

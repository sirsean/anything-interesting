import { describe, expect, it } from 'vitest';
import {
  DIGEST_SOURCE_WINDOW_HOURS,
  EXCEPTIONAL_SCORE,
  MIN_FINAL_SCORE,
  MIN_WEIGHTED_SOURCE_COVERAGE,
} from '../src/digest_constants';

describe('digest_constants', () => {
  it('exports expected gate values', () => {
    expect(DIGEST_SOURCE_WINDOW_HOURS).toBe(12);
    expect(MIN_WEIGHTED_SOURCE_COVERAGE).toBe(3.0);
    expect(MIN_FINAL_SCORE).toBe(0.6);
    expect(EXCEPTIONAL_SCORE).toBe(0.88);
  });
});

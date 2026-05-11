import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseJudgment, noveltyFromFirstSeen } from '../src/scoring';

describe('scoring helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('noveltyFromFirstSeen', () => {
    it('returns 0.5 for invalid timestamps', () => {
      expect(noveltyFromFirstSeen('not-a-date')).toBe(0.5);
    });

    it('interpolates novelty toward zero as the cluster ages', () => {
      const now = Date.parse('2024-06-01T12:00:00.000Z');
      vi.spyOn(Date, 'now').mockReturnValue(now);
      const fresh = noveltyFromFirstSeen('2024-06-01T11:00:00.000Z');
      const old = noveltyFromFirstSeen('2024-05-20T12:00:00.000Z');
      expect(fresh).toBeGreaterThan(old);
      expect(fresh).toBeLessThanOrEqual(1);
      expect(old).toBeGreaterThanOrEqual(0);
    });
  });

  describe('parseJudgment', () => {
    it('parses JSON score and reason from chat-shaped output', () => {
      const raw = {
        choices: [{ message: { content: 'prefix {"score":0.82,"reason":"Strong lead"} suffix' } }],
      };
      const j = parseJudgment(raw);
      expect(j.score).toBe(0.82);
      expect(j.reason).toContain('Strong');
    });

    it('uses reasoning field when reason is absent', () => {
      const raw = {
        choices: [{ message: { content: '{"score":0.5,"reasoning":"Because"}' } }],
      };
      expect(parseJudgment(raw).reason).toBe('Because');
    });

    it('clamps score to [0,1]', () => {
      const raw = { choices: [{ message: { content: '{"score":99}' } }] };
      expect(parseJudgment(raw).score).toBe(1);
    });

    it('falls back when no JSON object is found', () => {
      const raw = { choices: [{ message: { content: 'no json here' } }] };
      const j = parseJudgment(raw);
      expect(j.score).toBe(0.45);
      expect(j.reason).toContain('no json');
    });
  });
});

import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/hash';

describe('hash', () => {
  it('sha256Hex matches known vector', async () => {
    const h = await sha256Hex('');
    expect(h).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('sha256Hex is lowercase hex of fixed length', async () => {
    const h = await sha256Hex('anything-interesting');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/env';

const stubEnv = {} as Env;

describe('Worker fetch handler', () => {
  it('GET /health returns service JSON', async () => {
    const res = await worker.fetch(
      new Request('https://example.test/health'),
      stubEnv,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; service: string };
    expect(j.ok).toBe(true);
    expect(j.service).toBe('anything-interesting');
  });

  it('returns 404 for unknown paths', async () => {
    const res = await worker.fetch(
      new Request('https://example.test/unknown'),
      stubEnv,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(404);
  });
});

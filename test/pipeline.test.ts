import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { sqliteD1 } from './sqlite';

vi.mock('../src/ingest', () => ({ runIngest: vi.fn(async () => ({ inserted: 20 })) }));
vi.mock('../src/editorial', () => ({ analyzePendingStories: vi.fn(async () => ({ analyzed: 6, deferred: 0 })) }));
vi.mock('../src/news_discovery', () => ({ discoverNews: vi.fn(async () => ({ inserted: 0 })) }));
vi.mock('../src/reaction_sync', () => ({ syncDigestReactions: vi.fn() }));
vi.mock('../src/editions', async importOriginal => ({ ...await importOriginal<typeof import('../src/editions')>(), prepareEdition: vi.fn(), deliverEdition: vi.fn() }));
import worker, { runScheduledTick } from '../src/index';
import { runIngest } from '../src/ingest';
import { analyzePendingStories } from '../src/editorial';
import { prepareEdition, deliverEdition, claimLease } from '../src/editions';
import { syncDigestReactions } from '../src/reaction_sync';

beforeEach(() => vi.clearAllMocks());
describe('protected collection and pipeline isolation', () => {
  it('rejects collection requests without a matching operator credential', async () => {
    const response = await worker.fetch(new Request('https://example.test/ops/news/refresh', { method: 'POST' }), { OPS_TOKEN: 'test-only' } as Env, {} as ExecutionContext);
    expect(response.status).toBe(403);
    expect(runIngest).not.toHaveBeenCalled();
  });
  it('continues analysis after ingestion failure and never prepares or posts in collection mode', async () => {
    const { db } = sqliteD1(), env = { DB: db, DIGEST_TIMEZONE: 'America/Chicago', DIGEST_HOUR: '17' } as Env;
    vi.mocked(runIngest).mockRejectedValueOnce(new Error('feed subsystem unavailable'));
    const result = await runScheduledTick(env, { collectOnly: true, now: new Date('2026-10-11T23:00:00Z') });
    expect(result.status).toBe('failed');
    expect(analyzePendingStories).toHaveBeenCalledOnce();
    expect(prepareEdition).not.toHaveBeenCalled();
    expect(deliverEdition).not.toHaveBeenCalled();
    expect(syncDigestReactions).not.toHaveBeenCalled();
    expect(await db.prepare('SELECT status,error FROM pipeline_runs').first()).toMatchObject({ status: 'failed', error: expect.stringContaining('ingestion:') });
    expect((await db.prepare('SELECT COUNT(*) AS n FROM job_leases').first<{ n: number }>())?.n).toBe(0);
  });
  it('reports an overlapping tick as busy without doing work', async () => {
    const { db } = sqliteD1(), env = { DB: db, OPS_TOKEN: 'test-only' } as Env;
    await claimLease(env, 'hourly-pipeline', 60);
    const response = await worker.fetch(new Request('https://example.test/ops/news/refresh', { method: 'POST', headers: { 'X-Ops-Token': 'test-only' } }), env, {} as ExecutionContext);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ status: 'busy' });
    expect(runIngest).not.toHaveBeenCalled();
  });
});

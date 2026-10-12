import { researchThinEvidence } from '../src/news_research';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sqliteD1 } from './sqlite';
import type { Env } from '../src/env';
import { storeIncomingArticle, enrichPendingArticles, runIngest } from '../src/ingest';
import { analyzeStory, analyzePendingStories, EDITORIAL_POLICY_VERSION, parseBrief, briefScore, type Brief, type Evidence } from '../src/editorial';
import { prepareEdition, readEdition, deliverEdition, loadCandidates, onDemandStories, claimLease, newsHealth, reconcileDelivery, briefEmbed } from '../src/editions';
import { runLLM, MODEL_KIMI_JUDGE } from '../src/llm';
import { reserveTextCall } from '../src/model_usage';
import { parseFeedXml } from '../src/rss';
import { NEWS_FEEDS } from '../src/sources';
import { syncDigestReactions } from '../src/reaction_sync';
import { handleApiRequest } from '../src/api';
import { editionDue } from '../src/news_config';

const now = new Date().toISOString();
export const sampleBrief: Brief = { headline: 'A spacecraft maps a hidden ocean on a moon', what_happened: 'A spacecraft mapped evidence of an ocean beneath the ice.', why_interesting: 'It gives scientists a new place to investigate how oceans form.', detail: 'The instrument measured a change beneath the surface.', question: 'How could we explore an ocean under ice?', qualification: null, topic: 'space', event_key: 'moon-ocean-spacecraft-map', confidence: .9, curiosity: .9, significance: .8, explainability: .9, novelty: .9, new_development: true, material_update: false, evidence_ids: [1] };
const evidence: Evidence[] = [{ id: 1, title: sampleBrief.headline, publisher: 'NASA', kind: 'primary', url: 'https://www.nasa.gov/test', published_at: now, text: 'A'.repeat(200), trusted: true }];
function setup() {
  const data = sqliteD1(), kv = new Map<string, string>();
  const env = { DB: data.db, CONFIG: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); } }, AI: { run: vi.fn(async () => ({ choices: [{ message: { content: JSON.stringify(sampleBrief) } }] })) }, HEADLINES: { query: vi.fn(async () => ({ matches: [] })), upsert: vi.fn(async () => ({})) } } as unknown as Env;
  return { ...data, env, kv };
}
async function seed(env: Env, brief = sampleBrief) {
  await env.DB.prepare('INSERT INTO clusters (representative_title, topic, editorial_json, editorial_evidence_json, editorial_version, event_key, confidence, final_score, judgment_status, editorial_policy_version, last_development_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, \'ready\', ?, datetime(\'now\'))')
    .bind(brief.headline, brief.topic, JSON.stringify(brief), JSON.stringify(evidence), brief.event_key, brief.confidence, briefScore(brief), EDITORIAL_POLICY_VERSION).run();
  return (await env.DB.prepare('SELECT MAX(id) AS id FROM clusters').first<{ id: number }>())!.id;
}
afterEach(() => vi.unstubAllGlobals());

describe('family news evidence and durable ingestion', () => {
  it('migrates populated historical data without changing old posts or markets', async () => {
    const { sqlite, migrate } = sqliteD1('0008');
    sqlite.exec("INSERT INTO clusters (representative_title) VALUES ('Old story'); INSERT INTO articles (url_hash,url,title,source,cluster_id) VALUES ('a','https://example.com/a','Old story','Politico (Economics)',1); INSERT INTO posts (digest_timestamp,cluster_ids) VALUES ('2026-09-01','[1]'); UPDATE clusters SET posted_digest_id = 1 WHERE id = 1; INSERT INTO markets (slug,title) VALUES ('old-contract','Old market'); INSERT INTO market_snapshots (market_slug,price) VALUES ('old-contract',0.3);");
    migrate('migrations/0009_family_news.sql');
    migrate('migrations/0010_news_research.sql');
    migrate('migrations/0011_editorial_policy.sql');
    expect(sqlite.prepare('SELECT publisher,enrichment_status FROM articles').get()).toMatchObject({ publisher: 'Politico', enrichment_status: 'ready' });
    expect(sqlite.prepare('SELECT cluster_ids FROM posts').get()).toMatchObject({ cluster_ids: '[1]' });
    expect(sqlite.prepare('SELECT last_delivered_version FROM clusters').get()).toMatchObject({ last_delivered_version: 1 });
    expect(sqlite.prepare('SELECT title FROM markets').get()).toMatchObject({ title: 'Old market' });
    expect(sqlite.prepare('SELECT price FROM market_snapshots').get()).toMatchObject({ price: .3 });
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('keeps Atom/RSS evidence and canonicalizes tracking URLs', () => {
    const items = parseFeedXml('<rss><channel><item><title>Discovery</title><link>https://example.com/a?utm_source=rss#top</link><description><![CDATA[<p>A new discovery &amp; a useful detail.</p>]]></description></item></channel></rss>');
    expect(items[0]?.description).toBe('A new discovery & a useful detail.');
    expect(items[0]?.url).toBe('https://example.com/a');
  });
  it('archives before embedding and retries failed enrichment; detects same-URL changes', async () => {
    const { env } = setup(), source = NEWS_FEEDS.find(f => f.publisher === 'NASA')!;
    const item = { title: 'A new moon map', url: 'https://www.nasa.gov/map?utm_medium=rss', description: 'New map details', publishedAt: now };
    expect(await storeIncomingArticle(env, source, item)).toBe('inserted');
    vi.mocked(env.AI.run).mockRejectedValueOnce(new Error('offline'));
    expect(await enrichPendingArticles(env)).toBe(0);
    expect(await env.DB.prepare('SELECT enrichment_status FROM articles').first()).toMatchObject({ enrichment_status: 'pending' });
    vi.mocked(env.AI.run).mockResolvedValueOnce({ data: [[1, 0]] } as never);
    expect(await enrichPendingArticles(env)).toBe(1);
    expect(await storeIncomingArticle(env, source, item)).toBe('duplicate');
    expect(await storeIncomingArticle(env, source, { ...item, description: 'Material new detail' })).toBe('updated');
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM articles').first<{ n: number }>())?.n).toBe(1);
  });
  it('isolates a failed feed and preserves other articles when embedding fails', async () => {
    const { env } = setup();
    vi.mocked(env.AI.run).mockRejectedValue(new Error('AI offline'));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === NEWS_FEEDS[0]!.url ? new Response('', { status: 503 }) : new Response('<rss><channel><item><title>A useful discovery</title><link>https://example.com/discovery</link><description>A concrete news detail was reported.</description></item></channel></rss>')));
    const stats = await runIngest(env);
    expect(stats).toMatchObject({ feedsFailed: 1, inserted: 1, enriched: 0 });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM source_health').first<{ n: number }>())?.n).toBe(25);
    expect(await env.DB.prepare('SELECT enrichment_status FROM articles').first()).toMatchObject({ enrichment_status: 'pending' });
    const health = await newsHealth(env); expect(health.failed_feeds).toBe(1); expect(health.stale_feeds).toBe(24); expect(health.degraded).toBe(true);
  });
  it('caches optional thin-evidence research and enforces its daily quota', async () => {
    const { env } = setup(); env.ENABLE_NEWS_DISCOVERY = 'true'; env.BRAVE_SEARCH_API_KEY = 'fake-brave';
    for (let i = 0; i < 5; i++) await seed(env, { ...sampleBrief, event_key: 'test-discovery-' + i });
    const fetcher = vi.fn(async (url: string) => url.includes('api.search.brave.com') ? Response.json({ results: [{ title: 'Agency reports discovery', url: 'https://www.nasa.gov/new-discovery', description: 'Concrete supplied reporting. '.repeat(20) }] }) : new Response('<article>Concrete supplied evidence. '.repeat(20) + '</article>'));
    vi.stubGlobal('fetch', fetcher);
    const thin = [{ ...evidence[0]!, text: '' }];
    const result = await researchThinEvidence(env, 1, thin);
    expect(result[0]).toMatchObject({ id: -1, trusted: true, publisher: 'NASA' });
    await researchThinEvidence(env, 1, thin); expect(fetcher).toHaveBeenCalledTimes(2);
    for (let id = 2; id <= 4; id++) await researchThinEvidence(env, id, thin);
    expect(await researchThinEvidence(env, 5, thin)).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(8);
  });
  it('accepts a specialist source and rejects fabricated citation IDs and unsupported confidence', () => {
    expect(parseBrief(JSON.stringify(sampleBrief), evidence).confidence).toBe(.9);
    expect(() => parseBrief(JSON.stringify({ ...sampleBrief, evidence_ids: [999] }), evidence)).toThrow('unknown evidence');
    expect(parseBrief(JSON.stringify(sampleBrief), [{ ...evidence[0]!, trusted: false }]).confidence).toBe(.5);
    expect(parseBrief(JSON.stringify(sampleBrief), [{ ...evidence[0]!, text: '' }]).confidence).toBe(.5);
  });
  it('keeps version/copy for repeated reporting and increments only on material facts', async () => {
    const { env } = setup();
    await storeIncomingArticle(env, NEWS_FEEDS.find(f => f.publisher === 'NASA')!, { title: sampleBrief.headline, url: evidence[0]!.url, description: 'Concrete reporting '.repeat(60), publishedAt: now });
    expect(await analyzeStory(env, 1)).toBe('analyzed');
    expect(await analyzeStory(env, 1)).toBe('unchanged');
    await env.DB.prepare('UPDATE articles SET description = ? WHERE id = 1').bind('More reporting '.repeat(70)).run();
    vi.mocked(env.AI.run).mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ ...sampleBrief, headline: 'Rephrased headline' }) } }] } as never);
    await analyzeStory(env, 1);
    expect(await env.DB.prepare('SELECT editorial_version, editorial_json FROM clusters WHERE id = 1').first()).toMatchObject({ editorial_version: 1, editorial_json: JSON.stringify(sampleBrief) });
    await env.DB.prepare('UPDATE articles SET description = ? WHERE id = 1').bind('Changed findings '.repeat(70)).run();
    vi.mocked(env.AI.run).mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ ...sampleBrief, material_update: true, detail: 'A newly measured fact changes the finding.' }) } }] } as never);
    await analyzeStory(env, 1);
    expect(await env.DB.prepare('SELECT editorial_version FROM clusters WHERE id = 1').first()).toMatchObject({ editorial_version: 2 });
  });
  it('recalibrates an old policy without changing the event version or archived copy', async () => {
    const { env } = setup();
    await storeIncomingArticle(env, NEWS_FEEDS.find(f => f.publisher === 'NASA')!, { title: sampleBrief.headline, url: evidence[0]!.url, description: 'Concrete reporting '.repeat(60), publishedAt: now });
    await analyzeStory(env, 1);
    const edition = await prepareEdition(env);
    await env.DB.prepare('UPDATE articles SET enrichment_status = \'ready\' WHERE id = 1').run();
    await env.DB.prepare('UPDATE clusters SET editorial_policy_version = ? WHERE id = 1').bind('old-policy').run();
    const staleResponse = await handleApiRequest(new Request('https://local/api/clusters/1'), env);
    expect((await staleResponse!.json() as { cluster: { digest: { eligible: boolean; status_label: string } } }).cluster.digest).toMatchObject({ eligible: false, status_label: 'Awaiting analysis' });
    const revised = { ...sampleBrief, headline: 'A clearer explanation of the moon map', curiosity: .7 };
    vi.mocked(env.AI.run).mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(revised) } }] } as never);
    expect(await analyzePendingStories(env)).toEqual({ analyzed: 1, deferred: 0 });
    const row = await env.DB.prepare('SELECT editorial_version,editorial_json FROM clusters WHERE id = 1').first<{ editorial_version: number; editorial_json: string }>();
    expect(row?.editorial_version).toBe(1);
    expect(JSON.parse(row!.editorial_json).headline).toBe(revised.headline);
    expect((await readEdition(env, edition!.id))?.items[0]?.brief.headline).toBe(sampleBrief.headline);
  });
  it('updates confidence and interest assessment without requiring a material fact change', async () => {
    const { env } = setup();
    await storeIncomingArticle(env, NEWS_FEEDS.find(f => f.publisher === 'NASA')!, { title: sampleBrief.headline, url: evidence[0]!.url, description: 'Concrete reporting '.repeat(60), publishedAt: now });
    await analyzeStory(env, 1);
    await env.DB.prepare('UPDATE articles SET description = ? WHERE id = 1').bind('Additional confirmation '.repeat(70)).run();
    vi.mocked(env.AI.run).mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ ...sampleBrief, confidence: .95, curiosity: .7 }) } }] } as never);
    await analyzeStory(env, 1);
    const row = await env.DB.prepare('SELECT editorial_version,editorial_json FROM clusters WHERE id = 1').first<{ editorial_version: number; editorial_json: string }>();
    expect(row?.editorial_version).toBe(1);
    expect(JSON.parse(row!.editorial_json)).toMatchObject({ confidence: .95, curiosity: .7, headline: sampleBrief.headline });
  });
});

describe('shared intelligence adapter and budget', () => {
  it('reserves atomically across overlapping calls and keeps capacity for the edition', async () => {
    const { env } = setup(); env.AI_DAILY_CALL_LIMIT = '10';
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => reserveTextCall(env, 'story_analysis', 'openai', 'gpt-6-luna', 100)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(9);
    await reserveTextCall(env, 'edition_select', 'openai', 'gpt-6-luna', 100);
    await expect(reserveTextCall(env, 'edition_select', 'openai', 'gpt-6-luna', 100)).rejects.toThrow('budget');
  });
  it('uses Responses strict schemas and low reasoning without temperature; reconciles usage', async () => {
    const { env } = setup(); env.OPENAI_API_KEY = 'fake-test-key';
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }], usage: { input_tokens: 100, output_tokens: 20 } }));
    vi.stubGlobal('fetch', fetcher);
    const raw = await runLLM(env, 'story_analysis', MODEL_KIMI_JUDGE, [{ role: 'user', content: 'Return JSON.' }], { max_tokens: 1200, schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } });
    const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({ model: 'gpt-6-luna', reasoning: { effort: 'low' }, store: false, text: { format: { strict: true } } });
    expect(body.temperature).toBeUndefined();
    expect(raw).toMatchObject({ choices: [{ message: { content: '{"ok":true}' } }] });
    expect(await env.DB.prepare('SELECT tokens, status FROM llm_usage').first()).toMatchObject({ tokens: 120, status: 'complete' });
  });
  it('keeps incomplete/refused/provider failures out of editorial results and bounded in accounting', async () => {
    const { env } = setup(); env.OPENAI_API_KEY = 'fake-test-key';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'incomplete', output: [], usage: { input_tokens: 10 } })));
    await expect(runLLM(env, 'story_analysis', MODEL_KIMI_JUDGE, [{ role: 'user', content: 'x' }])).rejects.toThrow('incomplete');
    expect(await env.DB.prepare('SELECT status FROM llm_usage').first()).toMatchObject({ status: 'error' });
  });
});

describe('immutable editions and delivery', () => {
  it('formats legacy briefs as one concise paragraph without website-only sections', () => {
    const brief = { ...sampleBrief, qualification: 'Measurements remain preliminary.' };
    const embed = briefEmbed({ PUBLIC_SITE_URL: 'https://news.example' } as Env, { id: 1, version: 1, brief, evidence });
    expect(embed.description).toContain('ocean beneath the ice');
    expect(embed.description).toContain('how oceans form');
    expect(embed.description).not.toMatch(/\n|Context:|Talk about it:/);
    expect(embed.description).not.toContain(brief.detail);
    expect(embed.description).not.toContain(brief.question);
    expect(embed.description).not.toContain(brief.qualification);
    expect(embed.fields).toBeUndefined();
    expect(embed.url).toBe('https://news.example/cluster/1');
    expect(embed.description!.split(/\s+/).length).toBeLessThanOrEqual(60);
    const longer = briefEmbed({} as Env, { id: 1, version: 1, brief: { ...brief, why_interesting: 'This discovery ' + 'adds new possibilities '.repeat(30) + 'for understanding oceans.' }, evidence });
    expect(longer.description).toBe(brief.what_happened);
  });
  it('uses a dedicated short summary and bounds oversized model prose', () => {
    const summary = 'An experimental device adjusts nerve signals without surgical implantation, pointing to a possible simpler approach to nerve stimulation.';
    const brief = { ...sampleBrief, discord_summary: summary };
    expect(parseBrief(JSON.stringify(brief), evidence).discord_summary).toBe(summary);
    expect(() => parseBrief(JSON.stringify({ ...brief, discord_summary: [] }), evidence)).toThrow('Discord summary');
    const embed = briefEmbed({} as Env, { id: 1, version: 1, brief, evidence });
    expect(embed.description).toBe(summary);
    const long = briefEmbed({} as Env, { id: 1, version: 1, brief: { ...brief, discord_summary: ('discovery '.repeat(100) + '\n\nMore background.') }, evidence });
    expect(long.description!.length).toBeLessThanOrEqual(500);
    expect(long.description!.split(/\s+/).length).toBeLessThanOrEqual(60);
    expect(long.description).not.toContain('\n');
  });
  it('posts only the short paragraph while saving complete website explanations', async () => {
    const { env } = setup();
    const brief = { ...sampleBrief, discord_summary: 'A spacecraft found evidence of a hidden ocean, giving scientists a new way to explore how oceans form.', qualification: 'The measurements are preliminary.' };
    await seed(env, brief); const edition = (await prepareEdition(env))!;
    env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/fake';
    const fetcher = vi.fn(async () => Response.json({ id: 'message' })); vi.stubGlobal('fetch', fetcher);
    await deliverEdition(env, edition);
    const payload = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(payload.embeds[0].description).toBe(brief.discord_summary);
    expect(payload.embeds[0].fields).toBeUndefined();
    expect((await readEdition(env, edition.id))?.items[0]?.brief).toMatchObject({ what_happened: brief.what_happened, why_interesting: brief.why_interesting, detail: brief.detail, question: brief.question, qualification: brief.qualification });
  });
  it('enforces a lease and serves saved copy after a cluster changes', async () => {
    const { env } = setup(); await seed(env);
    vi.mocked(env.AI.run).mockResolvedValue({ choices: [{ message: { content: '{"ids":[1],"reason":"A useful discovery"}' } }] } as never);
    expect(await claimLease(env, 'test')).toBeTruthy(); expect(await claimLease(env, 'test')).toBeNull();
    const edition = (await prepareEdition(env))!;
    await env.DB.prepare('UPDATE clusters SET editorial_json = ? WHERE id = 1').bind(JSON.stringify({ ...sampleBrief, headline: 'Changed later' })).run();
    expect((await readEdition(env, edition.id))?.items[0]?.brief.headline).toBe(sampleBrief.headline);
    expect((await onDemandStories(env, 3, null))[0]?.brief.headline).toBe(sampleBrief.headline);
    const api = await handleApiRequest(new Request('https://local/api/edition'), env);
    expect((await api!.json() as { edition: { items: Array<{ brief: Brief }> } }).edition.items[0]?.brief.headline).toBe(sampleBrief.headline);
  });
  it('preserves successful partial posts and retries only known failures', async () => {
    const { env } = setup(); await seed(env); await seed(env, { ...sampleBrief, headline: 'A museum uncovers a lost portrait', topic: 'culture', event_key: 'lost-portrait-museum-discovery' });
    const edition = (await prepareEdition(env))!; env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/fake';
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ id: 'm1' })).mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(Response.json({ id: 'm2' })); vi.stubGlobal('fetch', fetcher);
    await deliverEdition(env, edition);
    expect((await readEdition(env, edition.id))?.items.map(i => i.delivery_status)).toEqual(['delivered', 'failed']);
    await deliverEdition(env, (await readEdition(env, edition.id))!);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect((await readEdition(env, edition.id))?.status).toBe('delivered');
    expect(await loadCandidates(env)).toEqual([]);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM post_cluster_messages').first<{ n: number }>())?.n).toBe(2);
  });
  it('does not resend an ambiguous timed-out delivery', async () => {
    const { env } = setup(); await seed(env); const edition = (await prepareEdition(env))!; env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/fake';
    const fetcher = vi.fn().mockRejectedValue(new Error('timeout')); vi.stubGlobal('fetch', fetcher);
    await deliverEdition(env, edition); await deliverEdition(env, (await readEdition(env, edition.id))!);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await readEdition(env, edition.id))?.items[0]?.delivery_status).toBe('uncertain');
  });
  it('retries incomplete preparation and never modifies a finalized edition', async () => {
    const { env } = setup(); const incomplete = (await prepareEdition(env))!;
    expect(incomplete.status).toBe('incomplete');
    await seed(env); const prepared = (await prepareEdition(env))!;
    expect(prepared.id).toBe(incomplete.id); expect(prepared.items).toHaveLength(1);
    await seed(env, { ...sampleBrief, event_key: 'later-discovery', headline: 'A later discovery' });
    expect((await prepareEdition(env))?.items).toHaveLength(1);
  });
  it('releases a confirmed unsent item through reconciliation before retrying', async () => {
    const { env } = setup(); await seed(env); const edition = (await prepareEdition(env))!; env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/fake';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(Response.json({ id: 'retried-message' })));
    await deliverEdition(env, edition);
    const reconciled = (await reconcileDelivery(env, { edition_id: edition.id, position: 0, confirm_not_sent: true }))!;
    expect(reconciled.items[0]?.delivery_status).toBe('pending');
    await deliverEdition(env, reconciled);
    expect((await readEdition(env, edition.id))?.status).toBe('delivered');
  });
  it('counts immediate reactions as interests without touching source credibility', async () => {
    const { env, kv } = setup(); await seed(env); const edition = (await prepareEdition(env))!; env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/fake';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'message' }))); await deliverEdition(env, edition);
    env.DISCORD_BOT_TOKEN = 'fake-bot'; kv.set('discord:webhook_channel_id', 'channel');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes(encodeURIComponent('👍')) ? [{ id: 'parent' }] : [])));
    await syncDigestReactions(env); await syncDigestReactions(env);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM interest_votes').first<{ n: number }>())?.n).toBe(1);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM source_weights').first<{ n: number }>())?.n).toBe(0);
  });
  it('uses configurable local time and retries after the daily slot', () => {
    const { env } = setup(); expect(editionDue(env, new Date('2026-10-11T21:00:00Z'))).toBe(false); expect(editionDue(env, new Date('2026-10-11T22:00:00Z'))).toBe(true);
    expect(editionDue(env, new Date('2026-10-12T01:00:00Z'))).toBe(true);
  });
});

import type { Env } from './env';
import type { Evidence } from './editorial';
import { searchBraveNews } from './brave_news';
import { trustedFeedForUrl } from './sources';
import { stripHtmlToText, fetchPageExcerpt } from './page_fetch';
import { sha256Hex } from './hash';
export async function researchThinEvidence(env: Env, clusterId: number, evidence: Evidence[]): Promise<Evidence[]> {
  if (env.ENABLE_NEWS_DISCOVERY !== 'true' || !env.BRAVE_SEARCH_API_KEY || evidence.some(e => e.text.length >= 200) || !evidence[0]) return [];
  const id = clusterId + ':' + await sha256Hex(JSON.stringify(evidence));
  const cached = await env.DB.prepare('SELECT evidence_json FROM news_research_requests WHERE id = ?').bind(id).first<{ evidence_json: string }>();
  if (cached) return JSON.parse(cached.evidence_json) as Evidence[];
  const day = new Date().toISOString().slice(0, 10);
  const reservation = await env.DB.prepare('INSERT INTO news_research_requests (id, cluster_id, day) SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM news_research_requests WHERE day = ?) < 4').bind(id, clusterId, day, day).run();
  if (!reservation.meta.changes) return [];
  const hits = await searchBraveNews(env.BRAVE_SEARCH_API_KEY, evidence[0].title, { count: 3, freshness: 'pd' });
  const extra: Evidence[] = [];
  for (const [index, hit] of hits.entries()) {
    if (evidence.some(e => e.url === hit.url)) continue;
    const source = trustedFeedForUrl(hit.url);
    const page = index === 0 ? await fetchPageExcerpt(hit.url, { maxBytes: 600000, excerptChars: 2000 }) : null;
    extra.push({ id: -index - 1, title: stripHtmlToText(hit.title), url: hit.url, publisher: source?.publisher ?? new URL(hit.url).hostname, kind: source?.kind ?? 'reporting', trusted: !!source,
      published_at: hit.pageAge && Number.isFinite(Date.parse(hit.pageAge)) ? new Date(hit.pageAge).toISOString() : null,
      text: [stripHtmlToText(hit.description), page?.excerpt].filter(Boolean).join('\n').slice(0, 3500) });
  }
  await env.DB.prepare('UPDATE news_research_requests SET status = \'complete\', evidence_json = ? WHERE id = ?').bind(JSON.stringify(extra), id).run();
  return extra;
}

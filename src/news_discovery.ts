import type { Env } from './env';
import { searchBraveNews } from './brave_news';
import { storeIncomingArticle } from './ingest';
import { trustedFeedForUrl } from './sources';
import { stripHtmlToText } from './page_fetch';
export async function discoverNews(env: Env, now = new Date()): Promise<{ queries: number; inserted: number }> {
  if (env.ENABLE_NEWS_DISCOVERY !== 'true' || !env.BRAVE_SEARCH_API_KEY) return { queries: 0, inserted: 0 };
  const key = 'news-discovery:' + now.toISOString().slice(0, 10);
  if (await env.CONFIG.get(key)) return { queries: 0, inserted: 0 };
  // Tick lease serializes this marker; failed search waits until the next day rather than looping.
  await env.CONFIG.put(key, 'attempted', { expirationTtl: 172800 });
  const queries = [
    { q: 'new science discovery space nature breakthrough', topic: 'science' as const },
    { q: 'new history archaeology culture discovery achievement', topic: 'culture' as const },
    ...(env.FAMILY_INTERESTS?.trim() ? [{ q: env.FAMILY_INTERESTS.slice(0, 200) + ' news', topic: 'general' as const }] : []),
    ...(env.LOCAL_NEWS_REGION?.trim() ? [{ q: env.LOCAL_NEWS_REGION.slice(0, 150) + ' local news community science culture', topic: 'local' as const }] : []),
  ];
  let inserted = 0;
  for (const query of queries) {
    const hits = await searchBraveNews(env.BRAVE_SEARCH_API_KEY, query.q, { count: 5, freshness: 'pd' });
    for (const hit of hits) {
      const host = new URL(hit.url).hostname.replace(/^www\./, '');
      const known = trustedFeedForUrl(hit.url);
      const date = hit.pageAge && Number.isFinite(Date.parse(hit.pageAge)) ? new Date(hit.pageAge).toISOString() : null;
      if (await storeIncomingArticle(env, { id: known?.id ?? 'discovery:' + host, label: known?.label ?? host, publisher: known?.publisher ?? host, url: hit.url, topic: query.topic },
        { title: stripHtmlToText(hit.title), url: hit.url, publishedAt: date, description: stripHtmlToText(hit.description) }) === 'inserted') inserted++;
    }
  }
  return { queries: queries.length, inserted };
}

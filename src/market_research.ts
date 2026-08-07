/**
 * External research for Strategy B market-driven clusters:
 * Brave News search → page excerpts → structured evidence for Kimi.
 */
import { searchBraveNewsRecent, type BraveNewsHit } from './brave_news';
import { fetchPageExcerpts } from './page_fetch';

export type ResearchSource = {
  title: string;
  url: string;
  source: string | null;
  age: string | null;
  snippet: string;
  fetched: boolean;
  /** Truncated page text when fetch succeeded; empty otherwise. */
  excerpt: string;
};

export type MarketResearchResult = {
  query: string;
  sources: ResearchSource[];
};

/** Build a Brave query from a Polymarket question (drop trailing ? / date fluff lightly). */
export function researchQueryFromMarketTitle(title: string): string {
  let q = title.trim();
  q = q.replace(/\?+\s*$/, '');
  // Drop common "by Month Day, Year" resolution tails that hurt news matching.
  q = q.replace(
    /\s+by\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s*\d{4}\s*$/i,
    '',
  );
  q = q.replace(/\s+\d{4}\s*$/, '').trim();
  return q.slice(0, 380);
}

/**
 * Always-on research for flagged market moves. Degrades to [] sources when the
 * Brave key is missing or search fails — Strategy B still runs on RSS hits alone.
 */
export async function researchMarketMove(
  apiKey: string | undefined,
  marketTitle: string,
  opts?: { newsCount?: number; fetchLimit?: number },
): Promise<MarketResearchResult> {
  const query = researchQueryFromMarketTitle(marketTitle);
  if (!query) return { query: '', sources: [] };

  const newsCount = opts?.newsCount ?? 5;
  const fetchLimit = opts?.fetchLimit ?? 3;

  let hits: BraveNewsHit[] = [];
  try {
    hits = await searchBraveNewsRecent(apiKey, query, newsCount);
  } catch (e) {
    console.error('Brave News research failed', e);
    return { query, sources: [] };
  }

  if (hits.length === 0) return { query, sources: [] };

  const fetches = await fetchPageExcerpts(
    hits.slice(0, fetchLimit).map((h) => h.url),
    fetchLimit,
  );
  const byUrl = new Map(fetches.map((f) => [f.url, f]));

  const sources: ResearchSource[] = hits.map((h) => {
    const f = byUrl.get(h.url);
    const fetched = f?.ok === true && (f.excerpt?.length ?? 0) > 0;
    return {
      title: h.title,
      url: h.url,
      source: h.source,
      age: h.age,
      snippet: h.description,
      fetched,
      excerpt: fetched ? f!.excerpt : '',
    };
  });

  return { query, sources };
}

/** Compact lines for the Kimi explainer user prompt. */
export function formatResearchForPrompt(sources: ResearchSource[], max = 4): string {
  if (sources.length === 0) return '';
  return sources
    .slice(0, max)
    .map((s, i) => {
      const bits = [
        `${i + 1}. ${s.title}`,
        s.source ? `Source: ${s.source}` : null,
        s.age ? `Age: ${s.age}` : null,
        `URL: ${s.url}`,
        s.snippet ? `Snippet: ${s.snippet.slice(0, 400)}` : null,
        s.excerpt ? `Excerpt: ${s.excerpt.slice(0, 1200)}` : null,
      ].filter(Boolean);
      return bits.join('\n');
    })
    .join('\n\n');
}

/** Persistable subset for llm_reasoning_log + API (omit long excerpts). */
export function researchSourcesForLog(sources: ResearchSource[]): Array<{
  title: string;
  url: string;
  source: string | null;
  age: string | null;
  fetched: boolean;
}> {
  return sources.map((s) => ({
    title: s.title.slice(0, 300),
    url: s.url,
    source: s.source,
    age: s.age,
    fetched: s.fetched,
  }));
}

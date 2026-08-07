/**
 * Brave News Search client for Strategy B market research.
 * @see https://api-dashboard.search.brave.com/app/documentation/news-search
 */

const BRAVE_NEWS_URL = 'https://api.search.brave.com/res/v1/news/search';

export type BraveNewsHit = {
  title: string;
  url: string;
  description: string;
  source: string | null;
  age: string | null;
  pageAge: string | null;
};

type BraveNewsApiResult = {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
  page_age?: string;
  meta_url?: { hostname?: string };
};

type BraveNewsApiResponse = {
  results?: BraveNewsApiResult[];
};

function sourceFromResult(r: BraveNewsApiResult): string | null {
  const host = r.meta_url?.hostname?.trim();
  if (host) return host.replace(/^www\./, '');
  return null;
}

function normalizeHit(r: BraveNewsApiResult): BraveNewsHit | null {
  const title = (r.title ?? '').trim();
  const url = (r.url ?? '').trim();
  if (!title || !url) return null;
  try {
    // Reject non-http(s) and obvious junk.
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return {
    title: title.slice(0, 500),
    url,
    description: (r.description ?? '').trim().slice(0, 2000),
    source: sourceFromResult(r),
    age: typeof r.age === 'string' ? r.age : null,
    pageAge: typeof r.page_age === 'string' ? r.page_age : null,
  };
}

/**
 * Query Brave News. Returns [] when the API key is missing, on HTTP errors,
 * or when the response has no usable results (caller should degrade gracefully).
 */
export async function searchBraveNews(
  apiKey: string | undefined,
  query: string,
  opts?: { count?: number; freshness?: string },
): Promise<BraveNewsHit[]> {
  const key = apiKey?.trim();
  if (!key) return [];
  const q = query.trim().slice(0, 400);
  if (!q) return [];

  const count = Math.max(1, Math.min(10, opts?.count ?? 5));
  const freshness = opts?.freshness ?? 'pd';
  const url = new URL(BRAVE_NEWS_URL);
  url.searchParams.set('q', q);
  url.searchParams.set('count', String(count));
  url.searchParams.set('freshness', freshness);
  url.searchParams.set('search_lang', 'en');
  url.searchParams.set('country', 'US');
  url.searchParams.set('safesearch', 'moderate');
  url.searchParams.set('spellcheck', 'true');

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': key,
        'User-Agent': 'anything-interesting/1.0 (+https://github.com/sirsean/anything-interesting)',
      },
    });
  } catch (e) {
    console.error('Brave News fetch failed', e);
    return [];
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`Brave News HTTP ${res.status}`, body.slice(0, 300));
    return [];
  }

  let json: BraveNewsApiResponse;
  try {
    json = (await res.json()) as BraveNewsApiResponse;
  } catch (e) {
    console.error('Brave News JSON parse failed', e);
    return [];
  }

  const hits: BraveNewsHit[] = [];
  const seen = new Set<string>();
  for (const r of json.results ?? []) {
    const hit = normalizeHit(r);
    if (!hit) continue;
    if (seen.has(hit.url)) continue;
    seen.add(hit.url);
    hits.push(hit);
  }
  return hits;
}

/** Prefer last-24h news; widen to 7d if the day window is empty. */
export async function searchBraveNewsRecent(
  apiKey: string | undefined,
  query: string,
  count = 5,
): Promise<BraveNewsHit[]> {
  const day = await searchBraveNews(apiKey, query, { count, freshness: 'pd' });
  if (day.length > 0) return day;
  return searchBraveNews(apiKey, query, { count, freshness: 'pw' });
}

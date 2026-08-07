/**
 * Lightweight HTML → plain-text extraction for market research page fetches.
 * Best-effort: paywalls and bot blocks are expected; callers keep Brave snippets.
 */

const DEFAULT_MAX_BYTES = 180_000;
const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_EXCERPT_CHARS = 3_500;

export type PageFetchResult = {
  url: string;
  ok: boolean;
  excerpt: string;
  status: number | null;
};

function stripHtmlToText(html: string): string {
  let s = html;
  // Drop non-content blocks early.
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<\/?(script|style|noscript)[^>]*>/gi, ' ');
  // Prefer article/main when present.
  const article =
    s.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    s.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    s;
  s = article.replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : ' ';
    });
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Fetch a URL and return a truncated plain-text excerpt. Never throws.
 */
export async function fetchPageExcerpt(
  url: string,
  opts?: { timeoutMs?: number; maxBytes?: number; excerptChars?: number },
): Promise<PageFetchResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  const excerptChars = opts?.excerptChars ?? DEFAULT_EXCERPT_CHARS;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'User-Agent':
          'anything-interesting/1.0 (+research; https://github.com/sirsean/anything-interesting)',
      },
    });
    if (!res.ok) {
      return { url, ok: false, excerpt: '', status: res.status };
    }
    const ctype = (res.headers.get('content-type') ?? '').toLowerCase();
    if (ctype && !ctype.includes('html') && !ctype.includes('text/plain') && !ctype.includes('xml')) {
      return { url, ok: false, excerpt: '', status: res.status };
    }
    const buf = await res.arrayBuffer();
    const slice = buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
    const html = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(slice);
    const text = stripHtmlToText(html);
    if (text.length < 80) {
      return { url, ok: false, excerpt: '', status: res.status };
    }
    return {
      url,
      ok: true,
      excerpt: text.slice(0, excerptChars),
      status: res.status,
    };
  } catch {
    return { url, ok: false, excerpt: '', status: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch up to `limit` pages in parallel; order matches input URLs. */
export async function fetchPageExcerpts(
  urls: string[],
  limit = 3,
): Promise<PageFetchResult[]> {
  const targets = urls.slice(0, Math.max(0, limit));
  return Promise.all(targets.map((u) => fetchPageExcerpt(u)));
}

/** Exported for unit tests. */
export { stripHtmlToText };

import { XMLParser } from 'fast-xml-parser';
import type { FeedSource } from './sources';

export type ParsedItem = {
  title: string;
  url: string;
  publishedAt: string | null;
};

const UA =
  'Mozilla/5.0 (compatible; news-alert-agent/1.0; +https://developers.cloudflare.com/workers/)';

function pickText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'object' && v !== null && '#text' in v) {
    const t = (v as { '#text'?: string })['#text'];
    return typeof t === 'string' ? t.trim() || null : null;
  }
  return null;
}

function pickLink(item: Record<string, unknown>): string | null {
  const link = item.link;
  if (typeof link === 'string') return link.trim() || null;
  if (link && typeof link === 'object') {
    const o = link as Record<string, unknown>;
    const href = o['@_href'] ?? o.href;
    if (typeof href === 'string') return href.trim() || null;
    const text = pickText(link);
    if (text) return text;
  }
  const guid = pickText(item.guid);
  if (guid && guid.startsWith('http')) return guid;
  return null;
}

export async function fetchFeedItems(source: FeedSource): Promise<ParsedItem[]> {
  const res = await fetch(source.url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
  });
  if (!res.ok) {
    console.error(`RSS fetch failed ${source.id}: ${res.status} ${source.url}`);
    return [];
  }
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const rss = (doc.rss as Record<string, unknown> | undefined)?.channel as
    | Record<string, unknown>
    | undefined;
  if (!rss) {
    console.error(`RSS parse: no channel for ${source.id}`);
    return [];
  }
  const rawItems = rss.item;
  const list: Record<string, unknown>[] = Array.isArray(rawItems)
    ? (rawItems as Record<string, unknown>[])
    : rawItems
      ? [rawItems as Record<string, unknown>]
      : [];

  const out: ParsedItem[] = [];
  for (const item of list) {
    const title = pickText(item.title);
    const url = pickLink(item);
    if (!title || !url) continue;
    const pub = pickText(item.pubDate) ?? pickText(item.published) ?? pickText(item.updated);
    let publishedAt: string | null = null;
    if (pub) {
      const d = new Date(pub);
      publishedAt = Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    out.push({ title, url, publishedAt });
  }
  return out;
}

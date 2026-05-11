import { XMLParser } from 'fast-xml-parser';
import type { FeedSource } from './sources';

export type ParsedItem = {
  title: string;
  url: string;
  publishedAt: string | null;
};

const UA =
  'Mozilla/5.0 (compatible; anything-interesting/1.0; +https://developers.cloudflare.com/workers/)';

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
  if (Array.isArray(link)) {
    for (const L of link) {
      if (L && typeof L === 'object') {
        const o = L as Record<string, unknown>;
        if (o['@_rel'] === 'alternate' && typeof o['@_href'] === 'string') return o['@_href'].trim();
      }
    }
    for (const L of link) {
      if (L && typeof L === 'object') {
        const href = (L as Record<string, unknown>)['@_href'];
        if (typeof href === 'string') return href.trim();
      }
    }
  }
  if (link && typeof link === 'object') {
    const o = link as Record<string, unknown>;
    const href = o['@_href'] ?? o.href;
    if (typeof href === 'string') return href.trim() || null;
    const text = pickText(link);
    if (text) return text;
  }
  const guid = pickText(item.guid);
  if (guid && guid.startsWith('http')) return guid;
  const id = pickText(item.id);
  if (id && id.startsWith('http')) return id;
  return null;
}

function normalizeItems(raw: unknown): Record<string, unknown>[] {
  if (raw == null) return [];
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [raw as Record<string, unknown>];
}

/** RFC 4287 Atom — `entry` lives under the feed root (often `feed`, sometimes `atom:feed`, etc.). */
function atomFeedCandidates(doc: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const push = (v: unknown) => {
    if (v && typeof v === 'object' && !out.includes(v as Record<string, unknown>)) {
      out.push(v as Record<string, unknown>);
    }
  };
  push(doc.feed);
  push(doc['atom:feed']);
  for (const [k, v] of Object.entries(doc)) {
    if (k === '?xml' || k === 'feed' || k === 'atom:feed' || !v || typeof v !== 'object') continue;
    if (/:feed$/i.test(k)) push(v);
  }
  return out;
}

function itemsFromAtom(doc: Record<string, unknown>): Record<string, unknown>[] | null {
  for (const root of atomFeedCandidates(doc)) {
    if (root.entry != null) return normalizeItems(root.entry);
  }
  return null;
}

function itemsFromParsedDoc(doc: Record<string, unknown>): Record<string, unknown>[] | null {
  const rss2 = doc.rss as Record<string, unknown> | undefined;
  const ch = rss2?.channel as Record<string, unknown> | undefined;
  if (ch?.item != null) {
    return normalizeItems(ch.item);
  }
  // RSS 1.0: root is `rdf:RDF` by default; with `removeNSPrefix` it becomes `RDF`.
  const rdf = (doc['rdf:RDF'] ?? doc.RDF) as Record<string, unknown> | undefined;
  if (rdf?.item != null) {
    return normalizeItems(rdf.item);
  }
  const atomEntries = itemsFromAtom(doc);
  if (atomEntries != null) return atomEntries;
  return null;
}

export async function fetchFeedItems(source: FeedSource): Promise<ParsedItem[]> {
  const res = await fetch(source.url, {
    headers: {
      'User-Agent': UA,
      Accept:
        'application/atom+xml, application/rss+xml, application/rdf+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
  });
  if (!res.ok) {
    console.error(`RSS fetch failed ${source.id}: ${res.status} ${source.url}`);
    return [];
  }
  const xml = await res.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
    // Strip xmlns so typical Atom roots stay `feed` / `entry`; RSS 1.0 may surface as `RDF`.
    removeNSPrefix: true,
  });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const list = itemsFromParsedDoc(doc);
  if (!list || list.length === 0) {
    console.error(`RSS parse: no recognized feed shape for ${source.id}`);
    return [];
  }

  const out: ParsedItem[] = [];
  for (const item of list) {
    const title = pickText(item.title);
    const url = pickLink(item);
    if (!title || !url) continue;
    const pub =
      pickText(item.pubDate) ??
      pickText(item.published) ??
      pickText(item.updated) ??
      pickText(item['dc:date']) ??
      // RSS 1.0 + removeNSPrefix: `dc:date` becomes `date`
      pickText(item.date);
    let publishedAt: string | null = null;
    if (pub) {
      const d = new Date(pub);
      publishedAt = Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    out.push({ title, url, publishedAt });
  }
  return out;
}

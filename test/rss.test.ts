import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFeedItems } from '../src/rss';
import type { FeedSource } from '../src/sources';

const source: FeedSource = { id: 'test', label: 'Test', url: 'https://example.com/feed.xml' };

describe('rss', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('parses channel items with string link and pubDate', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>  Alpha headline  </title>
    <link>https://news.example/a</link>
    <pubDate>Mon, 15 Jan 2024 12:00:00 GMT</pubDate>
  </item>
</channel></rss>`;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(xml, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } })),
    );

    const items = await fetchFeedItems(source);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Alpha headline');
    expect(items[0].url).toBe('https://news.example/a');
    expect(items[0].publishedAt).toBe('2024-01-15T12:00:00.000Z');
  });

  it('parses atom-style link href and guid URL fallback', async () => {
    const xml = `<?xml version="1.0"?><rss><channel><item>
      <title>T</title>
      <link href="https://atom.example/item/1"/>
      <guid>https://guid.example/x</guid>
    </item></channel></rss>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(xml, { status: 200 })));

    const items = await fetchFeedItems(source);
    expect(items[0].url).toBe('https://atom.example/item/1');
  });

  it('returns empty array on non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    expect(await fetchFeedItems(source)).toEqual([]);
  });

  it('returns empty array when feed has no items', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<rss></rss>', { status: 200 })));
    expect(await fetchFeedItems(source)).toEqual([]);
  });

  it('parses Atom feed entry with link alternate href', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Atom story</title>
    <link rel="alternate" type="text/html" href="https://example.com/a"/>
    <updated>2024-02-01T10:00:00Z</updated>
  </entry>
</feed>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(xml, { status: 200 })));

    const items = await fetchFeedItems(source);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Atom story');
    expect(items[0].url).toBe('https://example.com/a');
    expect(items[0].publishedAt).toBe('2024-02-01T10:00:00.000Z');
  });

  it('parses Verge-style Atom title (type html) and single link object', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title type="html">Verge &amp; special headline</title>
    <link rel="alternate" type="text/html" href="https://www.theverge.com/2026/5/11/12345/example"/>
    <published>2026-05-11T12:00:00Z</published>
  </entry>
</feed>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(xml, { status: 200 })));

    const items = await fetchFeedItems(source);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Verge & special headline');
    expect(items[0].url).toBe('https://www.theverge.com/2026/5/11/12345/example');
    expect(items[0].publishedAt).toBe('2026-05-11T12:00:00.000Z');
  });

  it('parses Atom when the feed element uses an atom: prefix', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
  <atom:entry>
    <atom:title>Prefixed feed</atom:title>
    <atom:link rel="alternate" href="https://example.com/p"/>
    <atom:updated>2024-04-01T00:00:00Z</atom:updated>
  </atom:entry>
</atom:feed>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(xml, { status: 200 })));

    const items = await fetchFeedItems(source);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Prefixed feed');
    expect(items[0].url).toBe('https://example.com/p');
  });

  it('parses RSS 1.0 RDF items with dc:date', async () => {
    const xml = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://ex/ch"><title>C</title></channel>
  <item rdf:about="https://ex/1">
    <title>RDF item</title>
    <link>https://ex/article</link>
    <dc:date>2024-03-01T12:00:00Z</dc:date>
  </item>
</rdf:RDF>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(xml, { status: 200 })));

    const items = await fetchFeedItems(source);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('RDF item');
    expect(items[0].url).toBe('https://ex/article');
    expect(items[0].publishedAt).toBe('2024-03-01T12:00:00.000Z');
  });
});

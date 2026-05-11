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

  it('returns empty array when channel is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<rss></rss>', { status: 200 })));
    expect(await fetchFeedItems(source)).toEqual([]);
  });
});

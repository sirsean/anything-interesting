// Public endpoint audit, run with Node 22's built-in TypeScript stripping.
import { NEWS_FEEDS } from '../src/sources.ts';
import { XMLParser } from 'fast-xml-parser';
const parser = new XMLParser({ ignoreAttributes: false });
const array = x => Array.isArray(x) ? x : x ? [x] : [];
const output = [];
for (let offset = 0; offset < NEWS_FEEDS.length; offset += 5) {
  output.push(...await Promise.all(NEWS_FEEDS.slice(offset, offset + 5).map(async f => {
    try {
      const res = await fetch(f.url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'anything-interesting/1.0' } });
      if (!res.ok) return { id: f.id, status: res.status, error: 'HTTP failure' };
      const text = await res.text(); if (text.length > 2000000) throw new Error('Oversize feed');
      const xml = parser.parse(text), items = array(xml.rss?.channel?.item ?? xml.feed?.entry ?? xml['rdf:RDF']?.item);
      const dates = items.map(i => Date.parse(i.pubDate ?? i.published ?? i.updated ?? i['dc:date'] ?? '')).filter(Number.isFinite);
      return { id: f.id, status: res.status, items: items.length, newest: dates.length ? new Date(Math.max(...dates)).toISOString() : null };
    } catch (e) { return { id: f.id, error: e.message }; }
  })));
}
console.log(JSON.stringify(output, null, 2));
if (output.some(f => f.error || !f.items)) process.exitCode = 1;

import type { NewsTopic } from './news_config';
export type FeedSource = {
  id: string; label: string; url: string;
  publisher?: string; topic?: NewsTopic;
  kind?: 'reporting' | 'primary' | 'research' | 'feature';
  expectedIntervalHours?: number;
};
const feed = (id: string, label: string, publisher: string, topic: NewsTopic, url: string,
  kind: FeedSource['kind'] = 'reporting', expectedIntervalHours = 48): FeedSource =>
  ({ id, label, publisher, topic, url, kind, expectedIntervalHours });

/** Publisher identities are shared across section feeds; feed count is not corroboration. */
export const NEWS_FEEDS: FeedSource[] = [
  feed('guardian', 'The Guardian', 'The Guardian', 'world', 'https://www.theguardian.com/world/rss'),
  feed('guardian-environment', 'Guardian Environment', 'The Guardian', 'nature', 'https://www.theguardian.com/environment/rss'),
  feed('guardian-culture', 'Guardian Culture', 'The Guardian', 'culture', 'https://www.theguardian.com/culture/rss', 'reporting', 96),
  feed('bbc', 'BBC News', 'BBC', 'world', 'https://feeds.bbci.co.uk/news/rss.xml'),
  feed('bbc-science', 'BBC Science', 'BBC', 'science', 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml'),
  feed('bbc-health', 'BBC Health', 'BBC', 'health', 'https://feeds.bbci.co.uk/news/health/rss.xml'),
  feed('bbc-culture', 'BBC Culture', 'BBC', 'culture', 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml'),
  feed('bbc-sport', 'BBC Sport', 'BBC', 'sports', 'https://feeds.bbci.co.uk/sport/rss.xml?edition=uk'),
  feed('npr', 'NPR', 'NPR', 'general', 'https://feeds.npr.org/1001/rss.xml'),
  feed('npr-science', 'NPR Science', 'NPR', 'science', 'https://feeds.npr.org/1007/rss.xml'),
  feed('npr-culture', 'NPR Culture', 'NPR', 'culture', 'https://feeds.npr.org/1008/rss.xml'),
  feed('npr-education', 'NPR Education', 'NPR', 'general', 'https://feeds.npr.org/1013/rss.xml', 'reporting', 96),
  feed('pbs', 'PBS NewsHour', 'PBS', 'general', 'https://www.pbs.org/newshour/feeds/rss/headlines'),
  feed('science-news', 'Science News', 'Science News', 'science', 'https://www.sciencenews.org/feed', 'reporting', 96),
  feed('smithsonian-smart', 'Smithsonian Smart News', 'Smithsonian', 'science', 'https://www.smithsonianmag.com/rss/smart-news/', 'reporting', 96),
  feed('smithsonian-history', 'Smithsonian History', 'Smithsonian', 'culture', 'https://www.smithsonianmag.com/rss/history/', 'feature', 168),
  feed('nasa', 'NASA', 'NASA', 'space', 'https://www.nasa.gov/feed/', 'primary'),
  feed('esa', 'European Space Agency', 'ESA', 'space', 'https://www.esa.int/rssfeed/Our_Activities/Space_Science', 'primary', 168),
  feed('quanta', 'Quanta Magazine', 'Quanta', 'science', 'https://www.quantamagazine.org/feed/', 'feature', 168),
  feed('phys', 'Phys.org', 'Phys.org', 'nature', 'https://phys.org/rss-feed/', 'research'),
  feed('science-daily', 'ScienceDaily', 'ScienceDaily', 'science', 'https://www.sciencedaily.com/rss/top/science.xml', 'research'),
  feed('ars', 'Ars Technica', 'Ars Technica', 'technology', 'https://feeds.arstechnica.com/arstechnica/index'),
  feed('verge', 'The Verge', 'The Verge', 'technology', 'https://www.theverge.com/rss/index.xml'),
  feed('aljazeera', 'Al Jazeera', 'Al Jazeera', 'world', 'https://www.aljazeera.com/xml/rss/all.xml'),
  feed('dw', 'DW', 'DW', 'world', 'https://rss.dw.com/rdf/rss-en-world'),
];
/** Historical export retained for scripts/tests; the active registry is NEWS_FEEDS. */
export const M1_FEEDS = NEWS_FEEDS;
export function publisherForSource(label: string): string {
  return NEWS_FEEDS.find(f => f.label === label)?.publisher ?? (label.startsWith('Politico (') ? 'Politico' : label);
}

/** Exact publisher domains and their subdomains; search labels alone confer no trust. */
export function trustedFeedForUrl(raw: string): FeedSource | undefined {
  let host: string; try { host = new URL(raw).hostname.toLowerCase(); } catch { return undefined; }
  const domains: Record<string, string> = { 'theguardian.com': 'guardian', 'bbc.com': 'bbc', 'bbc.co.uk': 'bbc', 'npr.org': 'npr', 'pbs.org': 'pbs', 'sciencenews.org': 'science-news', 'smithsonianmag.com': 'smithsonian-smart', 'nasa.gov': 'nasa', 'esa.int': 'esa', 'quantamagazine.org': 'quanta', 'phys.org': 'phys', 'sciencedaily.com': 'science-daily', 'arstechnica.com': 'ars', 'theverge.com': 'verge', 'aljazeera.com': 'aljazeera', 'dw.com': 'dw' };
  const id = Object.entries(domains).find(([domain]) => host === domain || host.endsWith('.' + domain))?.[1];
  return NEWS_FEEDS.find(f => f.id === id);
}

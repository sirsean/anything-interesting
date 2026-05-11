export type FeedSource = {
  id: string;
  /** Short label stored on articles and shown in Discord */
  label: string;
  url: string;
};

/**
 * RSS feeds (see INITIAL.md for more alternates).
 * Reuters / AP commonly return 401/530 to Workers-class clients. Politico `www.politico.com/rss/*`
 * often 403s from Workers; section feeds on `rss.politico.com` typically work — use distinct labels
 * per feed so D1 `COUNT(DISTINCT source)` reflects real outlet diversity.
 */
export const M1_FEEDS: FeedSource[] = [
  {
    id: 'guardian',
    label: 'The Guardian',
    url: 'https://www.theguardian.com/world/rss',
  },
  {
    id: 'bbc',
    label: 'BBC',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  },
  {
    id: 'npr',
    label: 'NPR',
    url: 'https://feeds.npr.org/1001/rss.xml',
  },
  {
    id: 'foreignpolicy',
    label: 'Foreign Policy',
    url: 'https://foreignpolicy.com/feed/',
  },
  {
    id: 'warontherocks',
    label: 'War on the Rocks',
    url: 'https://warontherocks.com/feed/',
  },
  {
    id: 'ars',
    label: 'Ars Technica',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
  },
  {
    id: 'verge',
    label: 'The Verge',
    url: 'https://www.theverge.com/rss/index.xml',
  },
  {
    id: 'aljazeera',
    label: 'Al Jazeera',
    url: 'https://www.aljazeera.com/xml/rss/all.xml',
  },
  {
    id: 'dw',
    label: 'DW',
    url: 'https://rss.dw.com/rdf/rss-en-world',
  },
  {
    id: 'politico-defense',
    label: 'Politico (Defense)',
    url: 'https://rss.politico.com/defense.xml',
  },
  {
    id: 'politico-economy',
    label: 'Politico (Economy)',
    url: 'https://rss.politico.com/economy.xml',
  },
  {
    id: 'politico-politics',
    label: 'Politico (Politics)',
    url: 'https://rss.politico.com/politics-news.xml',
  },
];

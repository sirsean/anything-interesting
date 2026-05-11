export type FeedSource = {
  id: string;
  /** Short label stored on articles and shown in Discord */
  label: string;
  url: string;
};

/**
 * M1 starter feeds (see INITIAL.md for more alternates).
 * Reuters (`feeds.reuters.com`, `reuters.com/rssFeed/*`) and AP (`apnews.com/index.rss`) commonly
 * return 401/530 to Workers-class clients; use outlets that allow open RSS fetches instead.
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
];

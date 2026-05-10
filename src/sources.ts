export type FeedSource = {
  id: string;
  /** Short label stored on articles and shown in Discord */
  label: string;
  url: string;
};

/**
 * M1 starter feeds from INITIAL.md.
 * AP’s canonical RSS often returns 401 to automated clients; if ingest logs show AP failures,
 * swap the URL for another INITIAL feed (e.g. Politico) without changing ingest logic.
 */
export const M1_FEEDS: FeedSource[] = [
  {
    id: 'reuters',
    label: 'Reuters',
    url: 'https://feeds.reuters.com/reuters/topNews',
  },
  {
    id: 'bbc',
    label: 'BBC',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  },
  {
    id: 'ap',
    label: 'AP',
    url: 'https://apnews.com/index.rss',
  },
];

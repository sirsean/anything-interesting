export type ClusterScores = {
  coverage: number;
  novelty: number;
  surprise: number;
  llm: number;
};

export type ClusterPolymarket = {
  slug: string;
  event_slug: string | null;
  title: string | null;
  event_title: string | null;
  outcome_label: string | null;
  url: string;
  price_now: number | null;
  price_24h_ago: number | null;
  match_score: number;
};

export type ClusterDigestStatus = {
  eligible: boolean;
  posted_digest_id: number | null;
  posted_at: string | null;
  status_label: string;
};

export type ClusterTopArticle = {
  title: string;
  url: string;
  source: string;
  fetched_at: string;
};

export type ClusterLlmReasoning = {
  score: number | null;
  reason: string;
  at: string | null;
};

export type ClusterResearchSource = {
  title: string;
  url: string;
  source: string | null;
  age: string | null;
  fetched: boolean;
};

export type ClusterItem = {
  id: number;
  representative_title: string;
  topic: string;
  flow_type: string;
  final_score: number;
  scores: ClusterScores;
  source_weight_sum: number;
  weighted_sources_12h: number;
  sources: string[];
  top_article: ClusterTopArticle | null;
  polymarket: ClusterPolymarket | null;
  digest: ClusterDigestStatus;
  llm_reasoning: ClusterLlmReasoning | null;
  research: ClusterResearchSource[];
  first_seen: string;
  last_updated: string;
};

export type TopNewsResponse = {
  items: ClusterItem[];
  meta: {
    count: number;
    topic: string | null;
    window_hours: number;
    generated_at: string;
    digest_threshold: number;
    digest_source_window_hours: number;
  };
};

export type ClusterDetailResponse = {
  cluster: ClusterItem;
  articles: Array<{
    id: number;
    title: string;
    url: string;
    source: string;
    fetched_at: string;
    published_at: string | null;
  }>;
};

export type DigestArchiveItem = {
  id: number;
  digest_timestamp: string;
  message_id: string | null;
  channel_kind: string;
  clusters: Array<{
    id: number;
    representative_title: string;
    final_score: number;
    topic: string;
    flow_type: string;
  }>;
};

export type DigestsResponse = {
  items: DigestArchiveItem[];
};

export type KimiJudgmentSnapshot = {
  day: string;
  used: number;
  cap: number;
  remaining: number;
};

export type KimiJudgmentDayResponse = {
  kimi: { judgment: KimiJudgmentSnapshot };
  generated_at: string;
};

export type KimiJudgmentHistoryResponse = {
  kimi: {
    judgment: {
      cap: number;
      items: Array<Pick<KimiJudgmentSnapshot, 'day' | 'used' | 'remaining'>>;
    };
  };
  generated_at: string;
};

export type StatsResponse = {
  articles_last_24h: number;
  distinct_sources_last_24h: number;
  clusters_above_threshold: number;
  polymarket_matched_count: number;
  watchlist_markets_count: number;
  snapshotted_markets_24h: number;
  watchlist_kv_slugs: number;
  last_digest_at: string | null;
  digest_threshold: number;
  kimi: {
    judgment: {
      /** UTC day key for the judgment budget (`YYYY-MM-DD`). */
      day: string;
      used: number;
      cap: number;
      remaining: number;
    };
  };
  generated_at: string;
};

export type MarketListItem = {
  slug: string;
  title: string;
  display_title: string;
  outcome_label: string | null;
  category: string | null;
  event_slug: string | null;
  event_title: string | null;
  yes_price: number | null;
  price_24h_ago: number | null;
  one_day_price_change: number | null;
  volume_24h: number | null;
  last_seen_in_watchlist: string;
  last_snapshot_at: string | null;
  linked_clusters: number;
  url: string;
};

export type MarketsResponse = {
  items: MarketListItem[];
  meta: {
    limit: number;
    lookback_hours: number;
    generated_at: string;
  };
};

export type MarketDetailResponse = {
  market: {
    slug: string;
    title: string;
    display_title: string;
    outcome_label: string | null;
    description: string | null;
    category: string | null;
    end_date: string | null;
    event_slug: string | null;
    event_title: string | null;
    group_item_title: string | null;
    yes_price: number | null;
    price_24h_ago: number | null;
    volume_24h: number | null;
    one_day_price_change: number | null;
    last_seen_in_watchlist: string;
    last_snapshot_at: string | null;
    first_seen: string;
    last_updated: string;
    url: string;
  };
  snapshots: Array<{ price: number; volume_24h: number | null; taken_at: string }>;
  linked_clusters: Array<{
    id: number;
    representative_title: string;
    final_score: number;
    flow_type: string;
    last_updated: string;
  }>;
};

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export type TopNewsParams = {
  count?: number;
  topic?: string | null;
  window?: number;
};

export function fetchTopNews(params: TopNewsParams = {}, signal?: AbortSignal): Promise<TopNewsResponse> {
  const qs = new URLSearchParams();
  if (params.count != null) qs.set('count', String(params.count));
  if (params.topic) qs.set('topic', params.topic);
  if (params.window != null) qs.set('window', String(params.window));
  const suffix = qs.toString();
  return fetchJson<TopNewsResponse>(`/api/topnews${suffix ? `?${suffix}` : ''}`, signal);
}

export function fetchCluster(id: number, signal?: AbortSignal): Promise<ClusterDetailResponse> {
  return fetchJson<ClusterDetailResponse>(`/api/clusters/${id}`, signal);
}

export function fetchStats(signal?: AbortSignal): Promise<StatsResponse> {
  return fetchJson<StatsResponse>('/api/stats', signal);
}

export function fetchKimiJudgmentDay(
  day: string,
  signal?: AbortSignal,
): Promise<KimiJudgmentDayResponse> {
  return fetchJson<KimiJudgmentDayResponse>(
    `/api/stats/kimi?day=${encodeURIComponent(day)}`,
    signal,
  );
}

export function fetchKimiJudgmentHistory(
  signal?: AbortSignal,
): Promise<KimiJudgmentHistoryResponse> {
  return fetchJson<KimiJudgmentHistoryResponse>('/api/stats/kimi', signal);
}

export function fetchDigests(limit: number, signal?: AbortSignal): Promise<DigestsResponse> {
  return fetchJson<DigestsResponse>(`/api/digests?limit=${encodeURIComponent(limit)}`, signal);
}

export function fetchMarkets(limit = 50, signal?: AbortSignal): Promise<MarketsResponse> {
  return fetchJson<MarketsResponse>(`/api/markets?limit=${encodeURIComponent(limit)}`, signal);
}

export function fetchMarket(slug: string, signal?: AbortSignal): Promise<MarketDetailResponse> {
  return fetchJson<MarketDetailResponse>(`/api/markets/${encodeURIComponent(slug)}`, signal);
}

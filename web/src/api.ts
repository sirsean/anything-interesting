export type ClusterScores = {
  coverage: number;
  novelty: number;
  surprise: number;
  llm: number;
};

export type ClusterPolymarket = {
  slug: string;
  title: string | null;
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

export type StatsResponse = {
  articles_last_24h: number;
  distinct_sources_last_24h: number;
  clusters_above_threshold: number;
  polymarket_matched_count: number;
  last_digest_at: string | null;
  digest_threshold: number;
  generated_at: string;
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

export function fetchDigests(limit: number, signal?: AbortSignal): Promise<DigestsResponse> {
  return fetchJson<DigestsResponse>(`/api/digests?limit=${encodeURIComponent(limit)}`, signal);
}

/**
 * In-memory clustering simulation for eval harnesses.
 * Mirrors production logic in `cluster_embed.ts` with configurable thresholds.
 */

export type ClusterConfig = {
  /** Auto-merge when cosine similarity exceeds this. */
  cosineSame: number;
  /** Always start a new cluster below this similarity. */
  cosineLow: number;
  /** Only consider headline vectors from the last N days. */
  corpusDays: number;
  /**
   * `glm_required` — gray band merges only when GLM says same (production).
   * `always_merge_gray` — gray band always merges (skip GLM).
   * `merge_at_midpoint` — gray band merges when score ≥ (low+same)/2 (eval fast path).
   */
  grayZonePolicy: 'glm_required' | 'always_merge_gray' | 'merge_at_midpoint';
};

export const PROD_CLUSTER_CONFIG: ClusterConfig = {
  cosineSame: 0.8,
  cosineLow: 0.74,
  corpusDays: 7,
  grayZonePolicy: 'always_merge_gray',
};

export const CLUSTER_EVAL_PRESETS: Record<string, ClusterConfig> = {
  prod: PROD_CLUSTER_CONFIG,
  tuned_a: {
    cosineSame: 0.8,
    cosineLow: 0.74,
    corpusDays: 7,
    grayZonePolicy: 'glm_required',
  },
  tuned_b: {
    cosineSame: 0.8,
    cosineLow: 0.74,
    corpusDays: 7,
    grayZonePolicy: 'always_merge_gray',
  },
  tuned_c: {
    cosineSame: 0.78,
    cosineLow: 0.72,
    corpusDays: 7,
    grayZonePolicy: 'glm_required',
  },
  tuned_d: {
    cosineSame: 0.78,
    cosineLow: 0.72,
    corpusDays: 7,
    grayZonePolicy: 'always_merge_gray',
  },
};

export type ArticleInput = {
  id: string;
  title: string;
  source: string;
  fetchedAt: string;
};

export type GrayZoneDecision = {
  articleTitle: string;
  repTitle: string;
  score: number;
  merged: boolean;
  policy: ClusterConfig['grayZonePolicy'];
};

export type SimCluster = {
  id: number;
  repTitle: string;
  firstSeenAt: string;
  articles: ArticleInput[];
};

export type SimStats = {
  articleCount: number;
  clusterCount: number;
  multiSourceClusters: number;
  threePlusSourceClusters: number;
  singleSourceClusters: number;
  singleSourcePct: number;
  multiSourcePct: number;
  threePlusPct: number;
  avgArticlesPerCluster: number;
  maxArticlesPerCluster: number;
  grayZoneCount: number;
  grayZoneMergeCount: number;
};

export type ClusterPick = { clusterId: number } | { newCluster: true };

export type RerankFn = (newTitle: string, repTitle: string) => Promise<boolean>;

export type TopMatch = {
  score: number;
  clusterId: number;
  repTitle: string;
};

type IndexedVector = {
  id: string;
  values: number[];
  clusterId: number;
  repTitle: string;
  ts: number;
};

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

export class InMemoryHeadlineIndex {
  private vectors: IndexedVector[] = [];

  upsert(args: {
    id: string;
    values: number[];
    clusterId: number;
    repTitle: string;
    ts: number;
  }): void {
    const idx = this.vectors.findIndex((v) => v.id === args.id);
    const row: IndexedVector = {
      id: args.id,
      values: args.values,
      clusterId: args.clusterId,
      repTitle: args.repTitle,
      ts: args.ts,
    };
    if (idx >= 0) this.vectors[idx] = row;
    else this.vectors.push(row);
  }

  query(
    values: number[],
    topK: number,
    cutoffTs: number,
  ): { score: number; clusterId: number; repTitle: string }[] {
    const scored = this.vectors
      .filter((v) => v.ts >= cutoffTs)
      .map((v) => ({
        score: cosineSimilarity(values, v.values),
        clusterId: v.clusterId,
        repTitle: v.repTitle,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    return scored;
  }
}

function tsFromIso(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 1000) : Math.floor(Date.now() / 1000);
}

export async function resolveClusterPick(args: {
  top: TopMatch | null;
  newTitle: string;
  config: ClusterConfig;
  rerank: RerankFn;
  clusterExists: (clusterId: number) => boolean | Promise<boolean>;
  resolveRep?: (clusterId: number, repFromMeta: string) => string | Promise<string>;
}): Promise<{ pick: ClusterPick; topScore: number | null; grayZone?: GrayZoneDecision }> {
  const top = args.top;
  if (!top || !Number.isFinite(top.score)) {
    return { pick: { newCluster: true }, topScore: null };
  }

  const score = top.score;
  if (score < args.config.cosineLow) {
    return { pick: { newCluster: true }, topScore: score };
  }

  if (!Number.isFinite(top.clusterId)) {
    return { pick: { newCluster: true }, topScore: score };
  }

  const exists = await args.clusterExists(top.clusterId);
  if (!exists) {
    return { pick: { newCluster: true }, topScore: score };
  }

  if (score > args.config.cosineSame) {
    return { pick: { clusterId: top.clusterId }, topScore: score };
  }

  const repFromMeta = top.repTitle;
  const rep = args.resolveRep
    ? await args.resolveRep(top.clusterId, repFromMeta)
    : repFromMeta || args.newTitle;

  let merged: boolean;
  if (args.config.grayZonePolicy === 'always_merge_gray') {
    merged = true;
  } else if (args.config.grayZonePolicy === 'merge_at_midpoint') {
    merged = score >= (args.config.cosineLow + args.config.cosineSame) / 2;
  } else {
    merged = (await args.rerank(args.newTitle, rep)) === true;
  }

  const grayZone: GrayZoneDecision = {
    articleTitle: args.newTitle,
    repTitle: rep,
    score,
    merged,
    policy: args.config.grayZonePolicy,
  };

  if (merged) {
    return { pick: { clusterId: top.clusterId }, topScore: score, grayZone };
  }
  return { pick: { newCluster: true }, topScore: score, grayZone };
}

export async function decideClusterAssignment(args: {
  index: InMemoryHeadlineIndex;
  embedding: number[];
  newTitle: string;
  config: ClusterConfig;
  rerank: RerankFn;
  tsSec: number;
  clusterExists: (clusterId: number) => boolean | Promise<boolean>;
  vectorTopK?: number;
}): Promise<{ pick: ClusterPick; topScore: number | null; grayZone?: GrayZoneDecision }> {
  const topK = args.vectorTopK ?? 20;
  const cutoff = args.tsSec - args.config.corpusDays * 86400;
  const matches = args.index.query(args.embedding, topK, cutoff);
  const topRaw = matches[0];
  const top: TopMatch | null = topRaw
    ? { score: topRaw.score, clusterId: topRaw.clusterId, repTitle: topRaw.repTitle }
    : null;

  return resolveClusterPick({
    top,
    newTitle: args.newTitle,
    config: args.config,
    rerank: args.rerank,
    clusterExists: args.clusterExists,
  });
}

export function computeSimStats(
  clusters: SimCluster[],
  grayZoneDecisions: GrayZoneDecision[],
): SimStats {
  const articleCount = clusters.reduce((n, c) => n + c.articles.length, 0);
  const clusterCount = clusters.length;
  let multiSourceClusters = 0;
  let threePlusSourceClusters = 0;
  let singleSourceClusters = 0;
  let maxArticlesPerCluster = 0;

  for (const c of clusters) {
    maxArticlesPerCluster = Math.max(maxArticlesPerCluster, c.articles.length);
    const sources = new Set(c.articles.map((a) => a.source));
    if (sources.size >= 3) threePlusSourceClusters += 1;
    if (sources.size >= 2) multiSourceClusters += 1;
    else singleSourceClusters += 1;
  }

  const grayZoneCount = grayZoneDecisions.length;
  const grayZoneMergeCount = grayZoneDecisions.filter((d) => d.merged).length;

  return {
    articleCount,
    clusterCount,
    multiSourceClusters,
    threePlusSourceClusters,
    singleSourceClusters,
    singleSourcePct: clusterCount === 0 ? 0 : (singleSourceClusters / clusterCount) * 100,
    multiSourcePct: clusterCount === 0 ? 0 : (multiSourceClusters / clusterCount) * 100,
    threePlusPct: clusterCount === 0 ? 0 : (threePlusSourceClusters / clusterCount) * 100,
    avgArticlesPerCluster: clusterCount === 0 ? 0 : articleCount / clusterCount,
    maxArticlesPerCluster,
    grayZoneCount,
    grayZoneMergeCount,
  };
}

export async function simulateClustering(args: {
  articles: ArticleInput[];
  embeddings: Map<string, number[]>;
  config: ClusterConfig;
  rerank: RerankFn;
}): Promise<{ clusters: SimCluster[]; stats: SimStats; grayZoneDecisions: GrayZoneDecision[] }> {
  const index = new InMemoryHeadlineIndex();
  const clusters = new Map<number, SimCluster>();
  const grayZoneDecisions: GrayZoneDecision[] = [];
  let nextId = 1;

  const sorted = [...args.articles].sort(
    (a, b) => Date.parse(a.fetchedAt) - Date.parse(b.fetchedAt),
  );

  for (const article of sorted) {
    const embedding = args.embeddings.get(article.id);
    if (!embedding?.length) continue;

    const tsSec = tsFromIso(article.fetchedAt);
    const decision = await decideClusterAssignment({
      index,
      embedding,
      newTitle: article.title,
      config: args.config,
      rerank: args.rerank,
      tsSec,
      clusterExists: (id) => clusters.has(id),
    });

    if (decision.grayZone) grayZoneDecisions.push(decision.grayZone);

    let clusterId: number;
    if ('clusterId' in decision.pick) {
      clusterId = decision.pick.clusterId;
    } else {
      clusterId = nextId;
      nextId += 1;
      clusters.set(clusterId, {
        id: clusterId,
        repTitle: article.title,
        firstSeenAt: article.fetchedAt,
        articles: [],
      });
    }

    const cluster = clusters.get(clusterId)!;
    cluster.articles.push(article);

    index.upsert({
      id: article.id,
      values: embedding,
      clusterId,
      repTitle: cluster.repTitle,
      ts: tsSec,
    });
  }

  const clusterList = [...clusters.values()].sort((a, b) => a.id - b.id);
  return {
    clusters: clusterList,
    stats: computeSimStats(clusterList, grayZoneDecisions),
    grayZoneDecisions,
  };
}

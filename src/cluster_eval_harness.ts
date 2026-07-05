/**
 * Offline clustering eval: replay D1 articles, simulate configs, Kimi-verify quality.
 */
import { makeGlmRerankFn } from './cluster_embed';
import { evaluateClustersWithKimi, findMissedMergePairs, type KimiEvalSummary } from './cluster_eval';
import type { Env } from './env';
import { runEmbed } from './llm';
import {
  CLUSTER_EVAL_PRESETS,
  PROD_CLUSTER_CONFIG,
  simulateClustering,
  type ArticleInput,
  type ClusterConfig,
  type SimStats,
} from './cluster_sim';

const EVAL_KV_PREFIX = 'cluster_eval:';
const EVAL_KV_TTL_SEC = 60 * 60;

export type EvalArticleRow = {
  url_hash: string;
  title: string;
  source: string;
  fetched_at: string;
};

export type EvalCachePayload = {
  hours: number;
  limit: number;
  articles: ArticleInput[];
  embeddings: Record<string, number[]>;
  createdAt: string;
};

export type PresetEvalResult = {
  preset: string;
  config: ClusterConfig;
  stats: SimStats;
  kimi?: KimiEvalSummary;
  topMultiSource: {
    id: number;
    sources: string[];
    articleCount: number;
    repTitle: string;
  }[];
};

export type ClusterEvalReport = {
  generatedAt: string;
  evalId?: string;
  articleWindow: { hours: number; limit: number; loaded: number; embedded: number };
  presets: PresetEvalResult[];
  recommendation: string;
};

export async function loadEvalArticles(
  db: D1Database,
  hours: number,
  limit: number,
): Promise<ArticleInput[]> {
  const { results } = await db
    .prepare(
      `SELECT url_hash, title, source, fetched_at
       FROM articles
       WHERE datetime(fetched_at) >= datetime('now', ?)
       ORDER BY fetched_at ASC
       LIMIT ?`,
    )
    .bind(`-${hours} hours`, limit)
    .all<EvalArticleRow>();

  return (results ?? []).map((r) => ({
    id: r.url_hash,
    title: r.title,
    source: r.source,
    fetchedAt: r.fetched_at,
  }));
}

export async function embedArticles(
  env: Env,
  articles: ArticleInput[],
  batchSize = 16,
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize);
    const vecs = await runEmbed(
      env,
      batch.map((a) => a.title.slice(0, 512)),
    );
    for (let j = 0; j < batch.length; j++) {
      const vec = vecs[j];
      if (vec?.length) out.set(batch[j]!.id, vec);
    }
  }
  return out;
}

function newEvalId(): string {
  return `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function prepareClusterEval(
  env: Env,
  opts: { hours?: number; limit?: number } = {},
): Promise<{ evalId: string; articleWindow: ClusterEvalReport['articleWindow'] }> {
  const hours = opts.hours ?? 72;
  const limit = opts.limit ?? 200;
  const articles = await loadEvalArticles(env.DB, hours, limit);
  const embeddingMap = await embedArticles(env, articles);
  const embeddings: Record<string, number[]> = {};
  for (const [id, vec] of embeddingMap) embeddings[id] = vec;

  const evalId = newEvalId();
  const payload: EvalCachePayload = {
    hours,
    limit,
    articles,
    embeddings,
    createdAt: new Date().toISOString(),
  };
  await env.CONFIG.put(`${EVAL_KV_PREFIX}${evalId}`, JSON.stringify(payload), {
    expirationTtl: EVAL_KV_TTL_SEC,
  });

  return {
    evalId,
    articleWindow: {
      hours,
      limit,
      loaded: articles.length,
      embedded: embeddingMap.size,
    },
  };
}

export async function loadEvalCache(env: Env, evalId: string): Promise<EvalCachePayload | null> {
  const raw = await env.CONFIG.get(`${EVAL_KV_PREFIX}${evalId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EvalCachePayload;
  } catch {
    return null;
  }
}

function configForPreset(name: string, skipGlm: boolean): ClusterConfig {
  const base = CLUSTER_EVAL_PRESETS[name] ?? PROD_CLUSTER_CONFIG;
  if (!skipGlm || base.grayZonePolicy === 'always_merge_gray') return base;
  return { ...base, grayZonePolicy: 'merge_at_midpoint' };
}

function topMultiSourceClusters(
  clusters: Awaited<ReturnType<typeof simulateClustering>>['clusters'],
  n = 5,
) {
  return clusters
    .filter((c) => new Set(c.articles.map((a) => a.source)).size >= 2)
    .sort((a, b) => b.articles.length - a.articles.length)
    .slice(0, n)
    .map((c) => ({
      id: c.id,
      sources: [...new Set(c.articles.map((a) => a.source))],
      articleCount: c.articles.length,
      repTitle: c.repTitle.slice(0, 120),
    }));
}

function scorePreset(r: PresetEvalResult): number {
  const s = r.stats;
  const kimi = r.kimi;
  let score = s.threePlusPct * 2 + s.multiSourcePct;
  score -= s.singleSourcePct * 0.25;
  if (kimi) {
    score += kimi.coherence.sameStoryRate * 25;
    score += kimi.missedMerges.kimiSameStoryRate * 10;
    score -= (1 - kimi.grayZone.glmAgreementRate) * 5;
  }
  return score;
}

function buildRecommendation(presets: PresetEvalResult[]): string {
  if (presets.length === 0) return 'No preset results.';
  const ranked = [...presets].sort((a, b) => scorePreset(b) - scorePreset(a));
  const best = ranked[0]!;
  const prod = presets.find((p) => p.preset === 'prod');
  if (!prod) return `Best preset: ${best.preset}`;

  const delta3 = best.stats.threePlusPct - prod.stats.threePlusPct;
  const deltaMulti = best.stats.multiSourcePct - prod.stats.multiSourcePct;
  const coherence =
    best.kimi != null
      ? `${(best.kimi.coherence.sameStoryRate * 100).toFixed(0)}% Kimi within-cluster coherence`
      : 'Kimi eval skipped';

  return (
    `Recommend preset "${best.preset}" over prod: ` +
    `+${deltaMulti.toFixed(1)}pp multi-source clusters, ` +
    `+${delta3.toFixed(1)}pp with ≥3 sources (${coherence}). ` +
    `Config: cosineLow=${best.config.cosineLow}, cosineSame=${best.config.cosineSame}, ` +
    `grayZonePolicy=${best.config.grayZonePolicy}.`
  );
}

async function simulatePreset(
  env: Env,
  cache: EvalCachePayload,
  name: string,
  opts: { kimiBudget: number; skipKimi: boolean; skipGlm: boolean },
): Promise<PresetEvalResult> {
  const config = configForPreset(name, opts.skipGlm);
  const embeddings = new Map(Object.entries(cache.embeddings));

  const rerankCache = new Map<string, boolean>();
  const baseGlm = makeGlmRerankFn(env);
  const cachedGlmRerank = async (a: string, b: string): Promise<boolean> => {
    const key = `${a.slice(0, 200)}\n↔\n${b.slice(0, 200)}`;
    const hit = rerankCache.get(key);
    if (hit != null) return hit;
    const verdict = await baseGlm(a, b);
    rerankCache.set(key, verdict);
    return verdict;
  };

  const rerank =
    config.grayZonePolicy === 'always_merge_gray' || config.grayZonePolicy === 'merge_at_midpoint'
      ? async () => true
      : cachedGlmRerank;

  const sim = await simulateClustering({
    articles: cache.articles,
    embeddings,
    config,
    rerank,
  });

  let kimi: KimiEvalSummary | undefined;
  if (!opts.skipKimi && opts.kimiBudget > 0) {
    kimi = await evaluateClustersWithKimi(env, {
      clusters: sim.clusters,
      grayZoneDecisions: sim.grayZoneDecisions,
      missedPairs: findMissedMergePairs({
        clusters: sim.clusters,
        embeddings,
        cosineLow: config.cosineLow,
      }),
      glmRerank: cachedGlmRerank,
      budget: opts.kimiBudget,
    });
  }

  return {
    preset: name,
    config,
    stats: sim.stats,
    kimi,
    topMultiSource: topMultiSourceClusters(sim.clusters),
  };
}

export async function runClusterEvalPreset(
  env: Env,
  opts: {
    evalId: string;
    preset: string;
    kimiBudget?: number;
    skipKimi?: boolean;
    skipGlm?: boolean;
  },
): Promise<PresetEvalResult & { articleWindow: ClusterEvalReport['articleWindow'] }> {
  const cache = await loadEvalCache(env, opts.evalId);
  if (!cache) throw new Error(`Eval cache not found: ${opts.evalId}`);

  const result = await simulatePreset(env, cache, opts.preset, {
    kimiBudget: opts.kimiBudget ?? 24,
    skipKimi: opts.skipKimi === true,
    skipGlm: opts.skipGlm !== false,
  });

  return {
    ...result,
    articleWindow: {
      hours: cache.hours,
      limit: cache.limit,
      loaded: cache.articles.length,
      embedded: Object.keys(cache.embeddings).length,
    },
  };
}

/** One-shot eval (embed + all presets). Prefer prepare + runClusterEvalPreset for large windows. */
export async function runClusterEval(
  env: Env,
  opts: {
    hours?: number;
    limit?: number;
    presetNames?: string[];
    preset?: string;
    kimiBudget?: number;
    skipKimi?: boolean;
    skipGlm?: boolean;
  } = {},
): Promise<ClusterEvalReport> {
  const prepared = await prepareClusterEval(env, {
    hours: opts.hours,
    limit: opts.limit,
  });
  const presetNames =
    opts.preset != null
      ? [opts.preset]
      : (opts.presetNames ?? ['prod', 'tuned_a', 'tuned_b', 'tuned_c']);

  const presets: PresetEvalResult[] = [];
  for (const name of presetNames) {
    const r = await runClusterEvalPreset(env, {
      evalId: prepared.evalId,
      preset: name,
      kimiBudget: opts.kimiBudget,
      skipKimi: opts.skipKimi,
      skipGlm: opts.skipGlm,
    });
    presets.push(r);
  }

  return {
    generatedAt: new Date().toISOString(),
    evalId: prepared.evalId,
    articleWindow: prepared.articleWindow,
    presets,
    recommendation: buildRecommendation(presets),
  };
}

export function presetToProdConfig(presetName: string): ClusterConfig | null {
  const c = CLUSTER_EVAL_PRESETS[presetName];
  if (!c) return null;
  if (c.grayZonePolicy === 'merge_at_midpoint') {
    return { ...c, grayZonePolicy: 'glm_required' };
  }
  return c;
}

export { CLUSTER_EVAL_PRESETS, PROD_CLUSTER_CONFIG, buildRecommendation, scorePreset };

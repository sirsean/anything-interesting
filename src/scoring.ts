import type { Env } from './env';
import { MIN_WEIGHTED_SOURCE_COVERAGE } from './digest_constants';
import { getKimiJudgmentUsage, recordKimiJudgmentCall } from './kimi_budget';
import { MODEL_KIMI_JUDGE, runLLM, textFromChatOut } from './llm';
import { matchClusterToMarkets } from './match_markets';
import { weightedDistinctSourceSum } from './source_weights';
import { inferTopicFromTitle, topicalWeight } from './topic';

export function noveltyFromFirstSeen(firstSeen: string): number {
  const t = Date.parse(firstSeen);
  if (!Number.isFinite(t)) return 0.5;
  const hours = (Date.now() - t) / 3600000;
  return Math.max(0, Math.min(1, 1 - hours / 120));
}

type ClusterRow = {
  representative_title: string;
  llm_score: number;
  judged_distinct_sources: number;
  llm_reasoning_log: string | null;
};

export function parseJudgment(raw: unknown): { score: number; reason: string } {
  const txt = textFromChatOut(raw);
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return { score: 0.45, reason: txt.slice(0, 500) };
  try {
    const j = JSON.parse(m[0]) as { score?: number; reason?: string; reasoning?: string };
    const s = typeof j.score === 'number' ? j.score : 0.45;
    const reason = (j.reason ?? j.reasoning ?? '').toString().slice(0, 1800);
    return { score: Math.max(0, Math.min(1, s)), reason };
  } catch {
    return { score: 0.45, reason: txt.slice(0, 500) };
  }
}

async function maybeRunJudgment(
  env: Env,
  row: ClusterRow,
  distinct: number,
  weightedSum: number,
  coverage: number,
  novelty: number,
  polymarketStrong: boolean,
  polymarketContext: string,
): Promise<{ llm: number; log: string | null; judgedDistinct: number }> {
  const candidacy = weightedSum >= MIN_WEIGHTED_SOURCE_COVERAGE || polymarketStrong;
  if (!candidacy) {
    return { llm: row.llm_score, log: null, judgedDistinct: row.judged_distinct_sources };
  }

  const shouldRerun =
    row.llm_reasoning_log == null || distinct > row.judged_distinct_sources;

  if (!shouldRerun) {
    return { llm: row.llm_score, log: null, judgedDistinct: row.judged_distinct_sources };
  }

  const { remaining } = await getKimiJudgmentUsage(env);
  if (remaining <= 0) {
    console.warn('Kimi judgment skipped: daily budget exhausted');
    return { llm: row.llm_score, log: null, judgedDistinct: row.judged_distinct_sources };
  }

  const judgeModel = env.JUDGMENT_MODEL?.trim() || MODEL_KIMI_JUDGE;

  let raw: unknown;
  try {
    raw = await runLLM(
      env,
      'judgment',
      judgeModel,
      [
        {
          role: 'system',
          content:
            'You score how interesting and newsworthy this story cluster is for a precision-first geopolitics/politics/econ/tech digest (0=skip,1=must-run). Reply JSON only: {"score":0.73,"reason":"brief"}',
        },
        {
          role: 'user',
          content: `Representative headline: ${row.representative_title.slice(0, 500)}\nDistinct outlets: ${distinct} · weighted coverage sum: ${weightedSum.toFixed(2)} (gate ≥ ${MIN_WEIGHTED_SOURCE_COVERAGE})\nCoverage signal (0-1): ${coverage.toFixed(2)}\nNovelty (0-1): ${novelty.toFixed(2)}\nPolymarket context: ${polymarketContext}`,
        },
      ],
      { max_tokens: 400, temperature: 0.3, response_format: { type: 'json_object' } },
    );
  } catch (e) {
    console.error('Kimi judgment error', e);
    return { llm: row.llm_score, log: null, judgedDistinct: row.judged_distinct_sources };
  }

  if (!raw) {
    return { llm: row.llm_score, log: null, judgedDistinct: row.judged_distinct_sources };
  }

  await recordKimiJudgmentCall(env);
  const { score, reason } = parseJudgment(raw);
  const log = JSON.stringify({ score, reason, at: new Date().toISOString() }).slice(0, 4000);
  return { llm: score, log, judgedDistinct: distinct };
}

export async function refreshClusterScores(env: Env, clusterId: number): Promise<void> {
  const row = await env.DB
    .prepare(
      `SELECT c.representative_title, c.first_seen, c.llm_score, c.flow_type,
              c.judged_distinct_sources, c.surprise_score, c.llm_reasoning_log,
              c.polymarket_slug, c.polymarket_match_score
       FROM clusters c WHERE c.id = ?`,
    )
    .bind(clusterId)
    .first<{
      representative_title: string;
      first_seen: string;
      llm_score: number;
      flow_type: string;
      judged_distinct_sources: number;
      surprise_score: number;
      llm_reasoning_log: string | null;
      polymarket_slug: string | null;
      polymarket_match_score: number;
    }>();

  if (!row) return;

  // Market-driven clusters are owned by `snapshots.ts`; don't second-guess them.
  if (row.flow_type === 'market_driven') return;

  const distinctRow = await env.DB
    .prepare(`SELECT COUNT(DISTINCT source) AS d FROM articles WHERE cluster_id = ?`)
    .bind(clusterId)
    .first<{ d: number }>();
  const distinct = distinctRow?.d ?? 0;

  const weightedSum = await weightedDistinctSourceSum(env.DB, clusterId, 'all');
  const coverage = Math.min(1, weightedSum / 5);
  const novelty = noveltyFromFirstSeen(row.first_seen);
  const topic = inferTopicFromTitle(row.representative_title);
  const tw = topicalWeight(topic);

  // Strategy A — only spend embeddings/LLM once a cluster crosses candidacy.
  let market: Awaited<ReturnType<typeof matchClusterToMarkets>> = null;
  if (weightedSum >= MIN_WEIGHTED_SOURCE_COVERAGE) {
    try {
      market = await matchClusterToMarkets(env, row.representative_title, '');
    } catch (e) {
      console.error('Strategy A match failed', clusterId, e);
    }
  }

  const polymarketStrong = market != null && market.surprise >= 0.4;
  const polymarketContext =
    market == null
      ? 'no Polymarket match.'
      : `${market.title} (similarity ${market.similarity.toFixed(2)}, YES ${
          market.priceNow != null ? (market.priceNow * 100).toFixed(0) + '%' : 'n/a'
        }, 24h ago ${
          market.price24hAgo != null ? (market.price24hAgo * 100).toFixed(0) + '%' : 'n/a'
        }).`;

  const j = await maybeRunJudgment(
    env,
    {
      representative_title: row.representative_title,
      llm_score: row.llm_score,
      judged_distinct_sources: row.judged_distinct_sources,
      llm_reasoning_log: row.llm_reasoning_log,
    },
    distinct,
    weightedSum,
    coverage,
    novelty,
    polymarketStrong,
    polymarketContext,
  );

  const llm = j.llm;
  const surprise = market?.surprise ?? 0;
  // Strategy A Polymarket match is often sparse; keep surprise on the row for UI
  // but do not fold it into digest ranking until the signal is reliable again.
  const inner = 0.15 * coverage + 0.25 * novelty + 0.6 * llm;
  const final = Math.min(1, inner * tw);

  await env.DB
    .prepare(
      `UPDATE clusters
       SET last_updated = datetime('now'),
           source_weight_sum = ?,
           coverage_score = ?,
           novelty_score = ?,
           surprise_score = ?,
           llm_score = ?,
           final_score = ?,
           topic = ?,
           llm_reasoning_log = COALESCE(?, llm_reasoning_log),
           judged_distinct_sources = ?,
           polymarket_slug = COALESCE(?, polymarket_slug),
           polymarket_match_score = ?,
           polymarket_price = ?,
           polymarket_price_24h_ago = ?
       WHERE id = ?`,
    )
    .bind(
      weightedSum,
      coverage,
      novelty,
      surprise,
      llm,
      final,
      topic,
      j.log,
      j.judgedDistinct,
      market?.slug ?? null,
      market?.similarity ?? row.polymarket_match_score,
      market?.priceNow ?? null,
      market?.price24hAgo ?? null,
      clusterId,
    )
    .run();
}

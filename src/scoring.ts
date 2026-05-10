import type { Env } from './env';
import { MODEL_KIMI_JUDGE, runLLM, textFromChatOut } from './llm';
import { inferTopicFromTitle, topicalWeight } from './topic';

/** ~3 digests × few judgments + buffer; aligns with INITIAL ~10–20/day target. */
const KIMI_DAILY_CAP = 22;

function utcDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function kimiBudgetRemaining(env: Env): Promise<number> {
  const day = utcDayKey();
  const key = `llm:kimi_count:${day}`;
  const raw = await env.CONFIG.get(key);
  const n = raw ? parseInt(raw, 10) : 0;
  return Math.max(0, KIMI_DAILY_CAP - (Number.isFinite(n) ? n : 0));
}

async function recordKimiCall(env: Env): Promise<void> {
  const day = utcDayKey();
  const key = `llm:kimi_count:${day}`;
  const raw = await env.CONFIG.get(key);
  const n = (raw ? parseInt(raw, 10) : 0) || 0;
  await env.CONFIG.put(key, String(n + 1), { expirationTtl: 86400 * 2 });
}

function noveltyFromFirstSeen(firstSeen: string): number {
  const t = Date.parse(firstSeen);
  if (!Number.isFinite(t)) return 0.5;
  const hours = (Date.now() - t) / 3600000;
  return Math.max(0, Math.min(1, 1 - hours / 120));
}

/**
 * Polymarket-driven surprise stays 0 until M3 (no market match / price pipeline yet).
 */
const SURPRISE_STUB = 0;

type ClusterRow = {
  representative_title: string;
  llm_score: number;
  judged_distinct_sources: number;
  llm_reasoning_log: string | null;
};

function parseJudgment(raw: unknown): { score: number; reason: string } {
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
  coverage: number,
  novelty: number,
): Promise<{ llm: number; log: string | null; judgedDistinct: number }> {
  const polymarketStrong = false;
  const candidacy = distinct >= 3 || polymarketStrong;
  if (!candidacy) {
    return { llm: row.llm_score, log: null, judgedDistinct: row.judged_distinct_sources };
  }

  const shouldRerun =
    row.llm_reasoning_log == null || distinct > row.judged_distinct_sources;

  if (!shouldRerun) {
    return { llm: row.llm_score, log: null, judgedDistinct: row.judged_distinct_sources };
  }

  const budget = await kimiBudgetRemaining(env);
  if (budget <= 0) {
    console.warn('Kimi judgment skipped: daily budget exhausted');
    return { llm: row.llm_score, log: null, judgedDistinct: row.judged_distinct_sources };
  }

  let raw: unknown;
  try {
    raw = await runLLM(
      env,
      'judgment',
      MODEL_KIMI_JUDGE,
      [
        {
          role: 'system',
          content:
            'You score how interesting and newsworthy this story cluster is for a precision-first geopolitics/politics/econ/tech digest (0=skip,1=must-run). Reply JSON only: {"score":0.73,"reason":"brief"}',
        },
        {
          role: 'user',
          content: `Representative headline: ${row.representative_title.slice(0, 500)}\nDistinct major outlets (unweighted count): ${distinct}\nCoverage signal (0-1): ${coverage.toFixed(2)}\nNovelty (0-1): ${novelty.toFixed(2)}\nPolymarket context: none (stub until M3).`,
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

  await recordKimiCall(env);
  const { score, reason } = parseJudgment(raw);
  const log = JSON.stringify({ score, reason, at: new Date().toISOString() }).slice(0, 4000);
  return { llm: score, log, judgedDistinct: distinct };
}

export async function refreshClusterScores(env: Env, clusterId: number): Promise<void> {
  const row = await env.DB
    .prepare(
      `SELECT c.representative_title, c.first_seen, c.llm_score,
              c.judged_distinct_sources, c.surprise_score, c.llm_reasoning_log
       FROM clusters c WHERE c.id = ?`,
    )
    .bind(clusterId)
    .first<{
      representative_title: string;
      first_seen: string;
      llm_score: number;
      judged_distinct_sources: number;
      surprise_score: number;
      llm_reasoning_log: string | null;
    }>();

  if (!row) return;

  const distinctRow = await env.DB
    .prepare(`SELECT COUNT(DISTINCT source) AS d FROM articles WHERE cluster_id = ?`)
    .bind(clusterId)
    .first<{ d: number }>();
  const distinct = distinctRow?.d ?? 0;

  const coverage = Math.min(1, distinct / 5);
  const novelty = noveltyFromFirstSeen(row.first_seen);
  const topic = inferTopicFromTitle(row.representative_title);
  const tw = topicalWeight(topic);

  const j = await maybeRunJudgment(
    env,
    {
      representative_title: row.representative_title,
      llm_score: row.llm_score,
      judged_distinct_sources: row.judged_distinct_sources,
      llm_reasoning_log: row.llm_reasoning_log,
    },
    distinct,
    coverage,
    novelty,
  );

  const llm = j.llm;
  const surprise = SURPRISE_STUB;
  const final = tw * (0.1 * coverage + 0.15 * novelty + 0.3 * surprise + 0.45 * llm);

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
           judged_distinct_sources = ?
       WHERE id = ?`,
    )
    .bind(
      distinct,
      coverage,
      novelty,
      surprise,
      llm,
      final,
      topic,
      j.log,
      j.judgedDistinct,
      clusterId,
    )
    .run();
}

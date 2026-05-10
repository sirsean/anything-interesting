import { DIGEST_SOURCE_WINDOW_HOURS } from './digest_constants';

/** Per INITIAL / M5: clamp after ±0.02 feedback step. */
export const WEIGHT_LO = 0.5;
export const WEIGHT_HI = 1.5;
export const FEEDBACK_STEP = 0.02;

/** Bayesian smoothing toward 1.0 when reaction counts are low. */
export function effectiveWeight(weight: number, posCount: number, negCount: number): number {
  const n = posCount + negCount;
  const alpha = Math.min(1, n / 20);
  return (1 - alpha) * 1.0 + alpha * weight;
}

/**
 * Subquery for `SUM(effectiveWeight)` over distinct outlets in a time window.
 * Expects outer alias `c` (clusters). Binds one param: e.g. `-12 hours`.
 */
export function sqlWeightedSourceSumInWindow(): string {
  return `(
    SELECT COALESCE(SUM(
      (1.0 - MIN(1.0, (t.pc + t.nc) / 20.0)) * 1.0
      + MIN(1.0, (t.pc + t.nc) / 20.0) * MIN(1.5, MAX(0.5, t.w))
    ), 0)
    FROM (
      SELECT MAX(COALESCE(sw.weight, 1.0)) AS w,
             MAX(COALESCE(sw.pos_count, 0)) AS pc,
             MAX(COALESCE(sw.neg_count, 0)) AS nc
      FROM articles a
      LEFT JOIN source_weights sw ON sw.source = a.source
      WHERE a.cluster_id = c.id
        AND datetime(a.fetched_at) >= datetime('now', ?)
      GROUP BY a.source
    ) t
  )`;
}

export function bindDigestSourceWindow(): string {
  return `-${DIGEST_SOURCE_WINDOW_HOURS} hours`;
}

export async function weightedDistinctSourceSum(
  db: D1Database,
  clusterId: number,
  window: 'all' | { hours: number },
): Promise<number> {
  const timeClause =
    window === 'all' ? '' : `AND datetime(a.fetched_at) >= datetime('now', ?)`;
  const binds: unknown[] = [clusterId];
  if (window !== 'all') binds.push(`-${window.hours} hours`);

  const { results } = await db
    .prepare(
      `SELECT
         MAX(COALESCE(sw.weight, 1.0)) AS w,
         MAX(COALESCE(sw.pos_count, 0)) AS pc,
         MAX(COALESCE(sw.neg_count, 0)) AS nc
       FROM articles a
       LEFT JOIN source_weights sw ON sw.source = a.source
       WHERE a.cluster_id = ? ${timeClause}
       GROUP BY a.source`,
    )
    .bind(...binds)
    .all<{ w: number; pc: number; nc: number }>();

  let sum = 0;
  for (const r of results ?? []) {
    sum += effectiveWeight(r.w, r.pc, r.nc);
  }
  return sum;
}

export async function distinctSourcesForCluster(db: D1Database, clusterId: number): Promise<string[]> {
  const { results } = await db
    .prepare(`SELECT DISTINCT source FROM articles WHERE cluster_id = ?`)
    .bind(clusterId)
    .all<{ source: string }>();
  return (results ?? []).map((r) => r.source);
}

export async function applySourceFeedbackDelta(
  db: D1Database,
  source: string,
  direction: 'up' | 'down',
): Promise<void> {
  const row = await db
    .prepare(`SELECT weight, pos_count, neg_count FROM source_weights WHERE source = ?`)
    .bind(source)
    .first<{ weight: number; pos_count: number; neg_count: number }>();

  const w0 = row?.weight ?? 1.0;
  const pc0 = row?.pos_count ?? 0;
  const nc0 = row?.neg_count ?? 0;
  const step = direction === 'up' ? FEEDBACK_STEP : -FEEDBACK_STEP;
  const w1 = Math.min(WEIGHT_HI, Math.max(WEIGHT_LO, w0 + step));
  const pc1 = direction === 'up' ? pc0 + 1 : pc0;
  const nc1 = direction === 'down' ? nc0 + 1 : nc0;

  await db
    .prepare(
      `INSERT INTO source_weights (source, weight, pos_count, neg_count, last_updated)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(source) DO UPDATE SET
         weight = excluded.weight,
         pos_count = excluded.pos_count,
         neg_count = excluded.neg_count,
         last_updated = excluded.last_updated`,
    )
    .bind(source, w1, pc1, nc1)
    .run();
}

export async function clusterIdsTouchingSources(
  db: D1Database,
  sources: string[],
): Promise<number[]> {
  if (sources.length === 0) return [];
  const ph = sources.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT DISTINCT cluster_id FROM articles WHERE source IN (${ph})`)
    .bind(...sources)
    .all<{ cluster_id: number }>();
  const ids = new Set<number>();
  for (const r of results ?? []) ids.add(r.cluster_id);
  return [...ids];
}

/** Record one new reaction and bump weights for every distinct outlet in the cluster. */
export async function recordClusterReaction(
  db: D1Database,
  messageId: string,
  clusterId: number,
  userId: string,
  direction: 'up' | 'down',
): Promise<{ applied: boolean; sources: string[] }> {
  const reaction = direction === 'up' ? 'up' : 'down';
  const ins = await db
    .prepare(
      `INSERT OR IGNORE INTO feedback (message_id, cluster_id, user_id, reaction, ts)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    )
    .bind(messageId, clusterId, userId, reaction)
    .run();

  if ((ins.meta?.changes ?? 0) < 1) {
    return { applied: false, sources: [] };
  }

  const sources = await distinctSourcesForCluster(db, clusterId);
  for (const s of sources) {
    await applySourceFeedbackDelta(db, s, direction);
  }
  return { applied: true, sources };
}

import { formatChicagoDigestSlotFromIso, nextScheduledDigestLabel } from './chicago_digest';
import { MIN_FINAL_SCORE, MIN_WEIGHTED_SOURCE_COVERAGE } from './digest_constants';

/**
 * Minimal cluster shape needed to derive eligibility and the human status
 * label. Shared between `/topnews` (Discord) and `/api/topnews` (web UI) so
 * both surfaces always agree with the digest gate.
 *
 * `grace_ok` is the SQL-side flag; we accept number/boolean/null since SQLite
 * returns 0/1 ints but in-memory tests may set booleans.
 */
export type DigestStatusRow = {
  final_score: number;
  flow_type: string;
  posted_digest_id: number | null;
  posted_digest_at: string | null;
  weighted_sources_12h: number;
  grace_ok: number | boolean | null;
};

export function isDigestEligible(r: DigestStatusRow): boolean {
  if (r.posted_digest_id != null) return false;
  if (r.final_score < MIN_FINAL_SCORE) return false;
  if (!r.grace_ok) return false;
  if (r.flow_type === 'market_driven') return true;
  const w = Number(r.weighted_sources_12h);
  return Number.isFinite(w) && w >= MIN_WEIGHTED_SOURCE_COVERAGE;
}

export function digestStatusLabel(r: DigestStatusRow, now: Date = new Date()): string {
  if (r.posted_digest_id != null) {
    if (r.posted_digest_at) {
      const slot = formatChicagoDigestSlotFromIso(r.posted_digest_at);
      return `Posted in ${slot} digest`;
    }
    return 'Posted in a recent digest';
  }
  if (isDigestEligible(r)) {
    return `In upcoming ${nextScheduledDigestLabel(now)} digest`;
  }
  return 'Below digest threshold';
}

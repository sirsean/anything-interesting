import { prepareEdition, deliverEdition } from './editions';
import type { Env } from './env';
import type { ClusterRowForEmbed } from './discord_cluster_embed';
import { EXCEPTIONAL_SCORE } from './digest_constants';

export type DigestCandidateRow = ClusterRowForEmbed & { source_weight_sum: number };

/** Caps digest items at 3, or 4 when the fourth cluster is exceptionally scored. */
export function pickDigestRows(rows: DigestCandidateRow[]): DigestCandidateRow[] {
  if (rows.length <= 3) return rows;
  const fourth = rows[3];
  if (fourth && fourth.final_score >= EXCEPTIONAL_SCORE) {
    return rows.slice(0, 4);
  }
  return rows.slice(0, 3);
}

export function formatDigestLabel(hourCT: string): string {
  const padded = hourCT.padStart(2, '0');
  return `${padded}:00 CT`;
}

export { digestClusterTitleLink } from './story_link';

/** Legacy entry point delegates to the saved family edition pipeline. */
export async function deliverDigest(env: Env, _hourCT: string): Promise<void> {
  const edition = await prepareEdition(env);
  if (edition) await deliverEdition(env, edition);
}

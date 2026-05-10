import { jaccard, tokenizeTitle } from './tokens';

const MATCH_MIN = 0.22;

export type ClusterRow = { id: number; representative_title: string };

export function bestMatchingClusterId(
  title: string,
  candidates: ClusterRow[],
): number | null {
  const t = tokenizeTitle(title);
  let bestId: number | null = null;
  let best = 0;
  for (const c of candidates) {
    const score = jaccard(t, tokenizeTitle(c.representative_title));
    if (score > best) {
      best = score;
      bestId = c.id;
    }
  }
  if (bestId != null && best >= MATCH_MIN) return bestId;
  return null;
}

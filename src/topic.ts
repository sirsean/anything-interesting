/**
 * Per-topic multipliers on the inner [0,1] score (centered ~1.0).
 * Slightly favor geopolitics vs uncategorized; all values stay near 1 so
 * `final_score` can reach digest thresholds (unlike legacy 0.2–0.4 weights).
 */
const TOPICAL_MULT: Record<string, number> = {
  geopolitics: 1.04,
  politics: 1.02,
  economics: 1.02,
  technology: 1.02,
  general: 0.98,
};

export function topicalWeight(topic: string): number {
  const k = topic.toLowerCase().trim();
  return TOPICAL_MULT[k] ?? TOPICAL_MULT.general;
}

/**
 * Cheap deterministic topic hint (M2). GLM topic_infer can refine later if needed.
 */
export function inferTopicFromTitle(title: string): string {
  const t = title.toLowerCase();
  if (
    /\b(ukraine|gaza|israel|nato|iran|syria|taiwan|china|defense|military|war|kremlin|pentagon)\b/.test(
      t,
    )
  ) {
    return 'geopolitics';
  }
  if (/\b(congress|senate|election|trump|biden|gop|democrat|republican|vote)\b/.test(t)) {
    return 'politics';
  }
  if (/\b(fed|gdp|inflation|jobs|ecb|economy|market|stocks|trade|tariff)\b/.test(t)) {
    return 'economics';
  }
  if (/\b(ai|chip|software|apple|google|microsoft|crypto|cyber|tech)\b/.test(t)) {
    return 'technology';
  }
  return 'general';
}

/** Topical multipliers from INITIAL.md (multiplicative on final_score). */
const TOPICAL: Record<string, number> = {
  geopolitics: 0.4,
  politics: 0.2,
  economics: 0.2,
  technology: 0.2,
  general: 0.2,
};

export function topicalWeight(topic: string): number {
  const k = topic.toLowerCase().trim();
  return TOPICAL[k] ?? TOPICAL.general;
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

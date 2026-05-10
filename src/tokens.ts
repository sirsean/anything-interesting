const STOP = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'as',
  'is',
  'was',
  'are',
  'were',
  'be',
  'been',
  'being',
  'with',
  'by',
  'from',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'has',
  'have',
  'had',
  'not',
  'no',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'about',
  'into',
  'over',
  'after',
  'before',
  'out',
  'up',
  'down',
  'more',
  'most',
  'some',
  'such',
  'than',
  'then',
  'also',
  'just',
  'only',
  'says',
  'say',
]);

export function tokenizeTitle(title: string): Set<string> {
  const raw = title
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const parts = raw.split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
  return new Set(parts);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

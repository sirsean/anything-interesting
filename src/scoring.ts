import type { Env } from './env';
import { textFromChatOut } from './llm';

export function noveltyFromFirstSeen(firstSeen: string): number {
  const t = Date.parse(firstSeen);
  if (!Number.isFinite(t)) return 0.5;
  const hours = (Date.now() - t) / 3600000;
  return Math.max(0, Math.min(1, 1 - hours / 120));
}

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

/** Shared editorial policy replaces headline/outlet/market-based judgment. */
export async function refreshClusterScores(env: Env, clusterId: number): Promise<void> {
  const { analyzeStory } = await import('./editorial');
  await analyzeStory(env, clusterId);
}

import type { Env } from './env';
import { MODEL_KIMI_JUDGE, runLLM, textFromChatOut } from './llm';
import type { GrayZoneDecision, SimCluster } from './cluster_sim';
import { cosineSimilarity } from './cluster_sim';

export type KimiSameStoryVerdict = {
  same: boolean;
  reason: string;
};

export type ClusterCoherenceSample = {
  clusterId: number;
  articleCount: number;
  sourceCount: number;
  titles: string[];
  kimiSame: boolean;
  kimiReason: string;
};

export type GrayZoneAudit = {
  articleTitle: string;
  repTitle: string;
  score: number;
  simMerged: boolean;
  glmWouldMerge: boolean;
  kimiSame: boolean;
  kimiAgreesWithSim: boolean;
  kimiReason: string;
};

export type MissedMergeCandidate = {
  titleA: string;
  sourceA: string;
  titleB: string;
  sourceB: string;
  cosine: number;
  kimiSame: boolean;
  kimiReason: string;
};

export type KimiEvalSummary = {
  coherence: {
    sampled: number;
    sameStoryRate: number;
    samples: ClusterCoherenceSample[];
  };
  grayZone: {
    sampled: number;
    glmAgreementRate: number;
    kimiAgreementWithSimRate: number;
    audits: GrayZoneAudit[];
  };
  missedMerges: {
    sampled: number;
    kimiSameStoryRate: number;
    candidates: MissedMergeCandidate[];
  };
  kimiCalls: number;
};

function parseSameStoryJson(raw: unknown): KimiSameStoryVerdict {
  const txt = textFromChatOut(raw);
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return { same: false, reason: txt.slice(0, 300) };
  try {
    const j = JSON.parse(m[0]) as { same?: boolean; reason?: string; reasoning?: string };
    return {
      same: j.same === true,
      reason: (j.reason ?? j.reasoning ?? '').toString().slice(0, 400),
    };
  } catch {
    return { same: false, reason: txt.slice(0, 300) };
  }
}

/** Kimi judge for eval harness — higher token budget than prod GLM rerank. */
export async function kimiSameStory(
  env: Env,
  a: string,
  b: string,
): Promise<KimiSameStoryVerdict> {
  const raw = await runLLM(
    env,
    'cluster_rerank',
    MODEL_KIMI_JUDGE,
    [
      {
        role: 'system',
        content:
          'You judge whether two news headlines refer to the same developing news story (same event, not merely same broad topic). Reply JSON only: {"same":true|false,"reason":"one sentence"}',
      },
      {
        role: 'user',
        content: `Headline A: ${a.slice(0, 450)}\nHeadline B: ${b.slice(0, 450)}`,
      },
    ],
    { max_tokens: 256, temperature: 0.1, response_format: { type: 'json_object' } },
  );
  return parseSameStoryJson(raw);
}

export async function kimiSameStoryBatch(
  env: Env,
  titles: string[],
): Promise<KimiSameStoryVerdict> {
  const body = titles.map((t, i) => `${i + 1}. ${t.slice(0, 350)}`).join('\n');
  const raw = await runLLM(
    env,
    'cluster_rerank',
    MODEL_KIMI_JUDGE,
    [
      {
        role: 'system',
        content:
          'You judge whether ALL listed headlines refer to the same developing news story. Reply JSON only: {"same":true|false,"reason":"one sentence"}',
      },
      { role: 'user', content: body },
    ],
    { max_tokens: 300, temperature: 0.1, response_format: { type: 'json_object' } },
  );
  return parseSameStoryJson(raw);
}

export async function evaluateClustersWithKimi(
  env: Env,
  args: {
    clusters: SimCluster[];
    grayZoneDecisions: GrayZoneDecision[];
    missedPairs: { titleA: string; sourceA: string; titleB: string; sourceB: string; cosine: number }[];
    glmRerank: (a: string, b: string) => Promise<boolean>;
    budget: number;
  },
): Promise<KimiEvalSummary> {
  let kimiCalls = 0;
  const take = <T>(arr: T[], n: number): T[] => {
    if (arr.length <= n) return arr;
    const step = arr.length / n;
    const out: T[] = [];
    for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]!);
    return out;
  };

  const multi = args.clusters.filter((c) => c.articles.length >= 2);
  const coherenceSamples = take(multi, Math.min(12, Math.max(4, Math.floor(args.budget * 0.4))));
  const coherenceResults: ClusterCoherenceSample[] = [];

  for (const c of coherenceSamples) {
    if (kimiCalls >= args.budget) break;
    const titles = c.articles.map((a) => a.title);
    const v = await kimiSameStoryBatch(env, titles);
    kimiCalls += 1;
    coherenceResults.push({
      clusterId: c.id,
      articleCount: c.articles.length,
      sourceCount: new Set(c.articles.map((a) => a.source)).size,
      titles: titles.slice(0, 4),
      kimiSame: v.same,
      kimiReason: v.reason,
    });
  }

  const graySamples = take(args.grayZoneDecisions, Math.min(10, Math.max(3, Math.floor(args.budget * 0.35))));
  const grayAudits: GrayZoneAudit[] = [];
  for (const g of graySamples) {
    if (kimiCalls >= args.budget) break;
    const kimi = await kimiSameStory(env, g.articleTitle, g.repTitle);
    kimiCalls += 1;
    const glmWouldMerge = await args.glmRerank(g.articleTitle, g.repTitle);
    grayAudits.push({
      articleTitle: g.articleTitle,
      repTitle: g.repTitle,
      score: g.score,
      simMerged: g.merged,
      glmWouldMerge,
      kimiSame: kimi.same,
      kimiAgreesWithSim: g.merged === kimi.same,
      kimiReason: kimi.reason,
    });
  }

  const missedSamples = take(args.missedPairs, Math.min(8, Math.max(2, Math.floor(args.budget * 0.25))));
  const missedResults: MissedMergeCandidate[] = [];
  for (const p of missedSamples) {
    if (kimiCalls >= args.budget) break;
    const kimi = await kimiSameStory(env, p.titleA, p.titleB);
    kimiCalls += 1;
    missedResults.push({
      titleA: p.titleA,
      sourceA: p.sourceA,
      titleB: p.titleB,
      sourceB: p.sourceB,
      cosine: p.cosine,
      kimiSame: kimi.same,
      kimiReason: kimi.reason,
    });
  }

  const coherenceSame = coherenceResults.filter((c) => c.kimiSame).length;
  const grayGlmAgree =
    grayAudits.length === 0
      ? 0
      : grayAudits.filter((g) => g.glmWouldMerge === g.kimiSame).length / grayAudits.length;
  const graySimAgree =
    grayAudits.length === 0
      ? 0
      : grayAudits.filter((g) => g.kimiAgreesWithSim).length / grayAudits.length;
  const missedSame =
    missedResults.length === 0
      ? 0
      : missedResults.filter((m) => m.kimiSame).length / missedResults.length;

  return {
    coherence: {
      sampled: coherenceResults.length,
      sameStoryRate: coherenceResults.length === 0 ? 0 : coherenceSame / coherenceResults.length,
      samples: coherenceResults,
    },
    grayZone: {
      sampled: grayAudits.length,
      glmAgreementRate: grayGlmAgree,
      kimiAgreementWithSimRate: graySimAgree,
      audits: grayAudits,
    },
    missedMerges: {
      sampled: missedResults.length,
      kimiSameStoryRate: missedSame,
      candidates: missedResults,
    },
    kimiCalls,
  };
}

export function findMissedMergePairs(args: {
  clusters: SimCluster[];
  embeddings: Map<string, number[]>;
  cosineLow: number;
  maxPairs?: number;
}): { titleA: string; sourceA: string; titleB: string; sourceB: string; cosine: number }[] {
  const pairs: { titleA: string; sourceA: string; titleB: string; sourceB: string; cosine: number }[] =
    [];

  const articles = args.clusters.flatMap((c) =>
    c.articles.map((a) => ({ ...a, clusterId: c.id })),
  );

  for (let i = 0; i < articles.length; i++) {
    const ai = articles[i]!;
    const veci = args.embeddings.get(ai.id);
    if (!veci) continue;
    for (let j = i + 1; j < articles.length; j++) {
      const aj = articles[j]!;
      if (ai.clusterId === aj.clusterId) continue;
      if (ai.source === aj.source) continue;
      const vecj = args.embeddings.get(aj.id);
      if (!vecj) continue;
      const cos = cosineSimilarity(veci, vecj);
      if (cos >= args.cosineLow) {
        pairs.push({
          titleA: ai.title,
          sourceA: ai.source,
          titleB: aj.title,
          sourceB: aj.source,
          cosine: cos,
        });
      }
    }
  }

  pairs.sort((a, b) => b.cosine - a.cosine);
  return pairs.slice(0, args.maxPairs ?? 30);
}

import type { Env } from './env';
import {
  PROD_CLUSTER_CONFIG,
  resolveClusterPick,
  type ClusterConfig,
  type ClusterPick,
  type RerankFn,
  type TopMatch,
} from './cluster_sim';
import { MODEL_GLM_FLASH, runEmbed, runLLM, textFromChatOut } from './llm';

const VECTOR_TOPK = 20;

export type { ClusterPick, ClusterConfig };
export { PROD_CLUSTER_CONFIG };

function tsCutoff(corpusDays: number): number {
  return Math.floor(Date.now() / 1000) - corpusDays * 86400;
}

function metaTs(m: VectorizeMatch): number {
  const ts = m.metadata?.ts;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') return parseFloat(ts) || 0;
  return 0;
}

async function glmSameStory(env: Env, a: string, b: string): Promise<boolean> {
  const raw = await runLLM(
    env,
    'cluster_rerank',
    MODEL_GLM_FLASH,
    [
      {
        role: 'system',
        content:
          'You decide if two news headlines describe the same developing story. Reply JSON only: {"same":true} or {"same":false}.',
      },
      {
        role: 'user',
        content: `A: ${a.slice(0, 400)}\nB: ${b.slice(0, 400)}`,
      },
    ],
    { max_tokens: 64, temperature: 0 },
  );
  const txt = textFromChatOut(raw);
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return false;
  try {
    const j = JSON.parse(m[0]) as { same?: boolean };
    return j.same === true;
  } catch {
    return false;
  }
}

export function makeGlmRerankFn(env: Env): RerankFn {
  return (a, b) => glmSameStory(env, a, b);
}

/**
 * Vectorize + cosine thresholds; GLM rerank in the gray band (configurable).
 * Match metadata must include `cluster_id` (number) and optional `rep_title`.
 */
export async function pickClusterForHeadline(
  env: Env,
  embedding: number[],
  newTitle: string,
  db: D1Database,
  config: ClusterConfig = PROD_CLUSTER_CONFIG,
  rerank: RerankFn = makeGlmRerankFn(env),
): Promise<ClusterPick> {
  const cutoff = tsCutoff(config.corpusDays);
  const matches = await env.HEADLINES.query(embedding, {
    topK: VECTOR_TOPK,
    returnMetadata: true,
  });

  const recent = (matches.matches ?? []).filter((m) => metaTs(m) >= cutoff);
  const topRaw = recent[0];
  if (!topRaw || typeof topRaw.score !== 'number') {
    return { newCluster: true };
  }

  const cid = topRaw.metadata?.cluster_id;
  const clusterId =
    typeof cid === 'number' ? cid : typeof cid === 'string' ? parseInt(cid, 10) : NaN;
  const repMeta = topRaw.metadata?.rep_title;
  const repFromMeta = typeof repMeta === 'string' ? repMeta : '';

  const top: TopMatch = {
    score: topRaw.score,
    clusterId,
    repTitle: repFromMeta,
  };

  const clusterExists = async (id: number): Promise<boolean> => {
    const row = await db
      .prepare('SELECT 1 AS x FROM clusters WHERE id = ?')
      .bind(id)
      .first<{ x: number }>();
    return row != null;
  };

  const resolveRep = async (id: number, fallback: string): Promise<string> => {
    if (fallback) return fallback;
    const row = await db
      .prepare(`SELECT representative_title FROM clusters WHERE id = ?`)
      .bind(id)
      .first<{ representative_title: string }>();
    return row?.representative_title ?? '';
  };

  const { pick } = await resolveClusterPick({
    top,
    newTitle,
    config,
    rerank,
    clusterExists,
    resolveRep,
  });
  return pick;
}

export async function embedHeadline(env: Env, title: string): Promise<number[]> {
  const [vec] = await runEmbed(env, [title.slice(0, 512)]);
  if (!vec?.length) throw new Error('empty embedding');
  return vec;
}

export async function upsertHeadlineVector(
  env: Env,
  args: {
    vectorId: string;
    values: number[];
    clusterId: number;
    repTitle: string;
  },
): Promise<void> {
  const ts = Math.floor(Date.now() / 1000);
  await env.HEADLINES.upsert([
    {
      id: args.vectorId,
      values: args.values,
      metadata: {
        cluster_id: args.clusterId,
        rep_title: args.repTitle.slice(0, 400),
        ts,
      },
    },
  ]);
}

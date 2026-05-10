import type { Env } from './env';
import { MODEL_GLM_FLASH, runEmbed, runLLM, textFromChatOut } from './llm';

const COSINE_SAME = 0.82;
const COSINE_LOW = 0.78;
const VECTOR_TOPK = 20;
const CORPUS_DAYS = 7;

export type ClusterPick = { clusterId: number } | { newCluster: true };

function tsCutoff(): number {
  return Math.floor(Date.now() / 1000) - CORPUS_DAYS * 86400;
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

/**
 * Vectorize + cosine thresholds; GLM rerank in the 0.78–0.82 band.
 * Match metadata must include `cluster_id` (number) and optional `rep_title`.
 */
function metaTs(m: VectorizeMatch): number {
  const ts = m.metadata?.ts;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') return parseFloat(ts) || 0;
  return 0;
}

export async function pickClusterForHeadline(
  env: Env,
  embedding: number[],
  newTitle: string,
  db: D1Database,
): Promise<ClusterPick> {
  const cutoff = tsCutoff();
  const matches = await env.HEADLINES.query(embedding, {
    topK: VECTOR_TOPK,
    returnMetadata: true,
  });

  const recent = matches.matches.filter((m) => metaTs(m) >= cutoff);
  const top = recent[0];
  if (!top || typeof top.score !== 'number') {
    return { newCluster: true };
  }

  const score = top.score;
  if (score < COSINE_LOW) {
    return { newCluster: true };
  }

  const cid = top.metadata?.cluster_id;
  const clusterId = typeof cid === 'number' ? cid : typeof cid === 'string' ? parseInt(cid, 10) : NaN;
  if (!Number.isFinite(clusterId)) {
    return { newCluster: true };
  }

  if (score > COSINE_SAME) {
    return { clusterId };
  }

  const repMeta = top.metadata?.rep_title;
  let rep = typeof repMeta === 'string' ? repMeta : '';
  if (!rep) {
    const row = await db
      .prepare(`SELECT representative_title FROM clusters WHERE id = ?`)
      .bind(clusterId)
      .first<{ representative_title: string }>();
    rep = row?.representative_title ?? '';
  }

  const same = await glmSameStory(env, newTitle, rep || newTitle);
  return same ? { clusterId } : { newCluster: true };
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

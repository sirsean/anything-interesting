import type { Env } from './env';

/** Verified 2026-05 against developers.cloudflare.com/workers-ai/models/ */
export const MODEL_EMBED = '@cf/baai/bge-large-en-v1.5' as const;
export const MODEL_GLM_FLASH = '@cf/zai-org/glm-4.7-flash' as const;
export const MODEL_KIMI_JUDGE = '@cf/moonshotai/kimi-k2.6' as const;

export type LlmTaskTag =
  | 'embed'
  | 'cluster_rerank'
  | 'judgment'
  | 'digest_summary'
  | 'topic_infer';

type AiRunOptions = {
  tags?: string[];
};

function gatewayOpts(env: Env, task: LlmTaskTag): Record<string, unknown> | undefined {
  const id = env.AI_GATEWAY_ID?.trim();
  if (!id) return undefined;
  return {
    gateway: { id },
    tags: [`task:${task}`, 'svc:anything-interesting'],
  };
}

type BgeResponse = { data: number[][]; shape?: number[] };

/**
 * Single entry for Workers AI text/chat models (GLM, Kimi, …).
 * All chat completions should go through here so gateway + tags stay consistent.
 */
export async function runLLM(
  env: Env,
  task: LlmTaskTag,
  model: string,
  messages: RoleMessage[],
  extra?: { max_tokens?: number; temperature?: number; response_format?: { type: 'json_object' } },
): Promise<unknown> {
  const opts = gatewayOpts(env, task);
  const body = {
    messages,
    max_tokens: extra?.max_tokens ?? 512,
    temperature: extra?.temperature ?? 0.2,
    ...(extra?.response_format ? { response_format: extra.response_format } : {}),
  };
  return (env.AI as Ai).run(model as keyof AiModels, body, opts as AiOptions);
}

/**
 * Embeddings — same gateway path as chat for observability.
 */
export async function runEmbed(env: Env, texts: string[]): Promise<number[][]> {
  const opts = gatewayOpts(env, 'embed');
  const out = (await (env.AI as Ai).run(
    MODEL_EMBED,
    { text: texts },
    opts as AiOptions,
  )) as BgeResponse;
  return out.data ?? [];
}

export type RoleMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export function textFromChatOut(raw: unknown): string {
  const o = raw as {
    choices?: Array<{ message?: { content?: string | null } | null }>;
  };
  const c = o.choices?.[0]?.message?.content;
  return typeof c === 'string' ? c : '';
}

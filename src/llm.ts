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
  | 'topic_infer'
  | 'watchlist_filter'
  | 'market_match'
  | 'market_explain';

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

/** Kimi K2.6 defaults to thinking mode; without disabling it, `content` is often empty. */
export function isKimiModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes('moonshotai/kimi') || m.includes('kimi-k2');
}

/** GLM-4.7-Flash defaults to extended thinking; `content` is often null and prose lands in `reasoning`. */
export function isGlmModel(model: string): boolean {
  return model.toLowerCase().includes('glm');
}

function chatTemplateKwargsForModel(model: string): Record<string, unknown> | undefined {
  if (isKimiModel(model)) return { thinking: false };
  if (isGlmModel(model)) return { thinking: { type: 'disabled' } };
  return undefined;
}

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
  const templateKwargs = chatTemplateKwargsForModel(model);
  const body = {
    messages,
    max_tokens: extra?.max_tokens ?? 512,
    temperature: extra?.temperature ?? 0.2,
    ...(extra?.response_format ? { response_format: extra.response_format } : {}),
    ...(templateKwargs ? { chat_template_kwargs: templateKwargs } : {}),
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

type ChatMessageOut = {
  content?: string | null;
  /** Kimi K2.6 thinking output when `chat_template_kwargs.thinking` is enabled. */
  reasoning?: string | null;
  reasoning_content?: string | null;
};

export function textFromChatOut(raw: unknown): string {
  if (raw == null || typeof raw !== 'object') return '';
  const o = raw as { choices?: Array<{ message?: ChatMessageOut | null }> };
  const msg = o.choices?.[0]?.message;
  if (!msg) return '';
  const content = typeof msg.content === 'string' ? msg.content : '';
  if (content.trim().length > 0) return content;
  if (typeof msg.reasoning === 'string' && msg.reasoning.trim().length > 0) return msg.reasoning;
  if (typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim().length > 0) {
    return msg.reasoning_content;
  }
  return '';
}

/** User-facing prose — never surface chain-of-thought from `reasoning` fields. */
export function textFromChatContentOnly(raw: unknown): string {
  if (raw == null || typeof raw !== 'object') return '';
  const o = raw as { choices?: Array<{ message?: ChatMessageOut | null }> };
  const content = o.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

import type { Env } from './env';
import { reserveTextCall, finishTextCall } from './model_usage';
import { readBoundedText } from './http';

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
  | 'market_explain'
  | 'story_analysis'
  | 'edition_select';

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
export type TextOptions = {
  max_tokens?: number; temperature?: number; response_format?: { type: 'json_object' };
  schema?: Record<string, unknown>; schemaName?: string;
};
export function textProvider(env: Env): 'openai' | 'workers-ai' {
  if (env.LLM_PROVIDER === 'openai') return 'openai';
  if (env.LLM_PROVIDER === 'workers-ai') return 'workers-ai';
  return env.OPENAI_API_KEY?.trim() ? 'openai' : 'workers-ai';
}
function usageFrom(raw: unknown): { input: number; output: number } | null {
  const u = (raw as { usage?: { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number } })?.usage;
  const input = u?.input_tokens ?? u?.prompt_tokens, output = u?.output_tokens ?? u?.completion_tokens;
  return typeof input === 'number' && typeof output === 'number' && Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0 ? { input, output } : null;
}
async function openAI(env: Env, messages: RoleMessage[], extra: TextOptions, model: string): Promise<unknown> {
  if (!env.OPENAI_API_KEY?.trim()) throw new Error('OPENAI_API_KEY is not configured');
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 45_000);
  try {
    const body = {
      model, input: messages, reasoning: { effort: 'low' }, store: false,
      max_output_tokens: extra.max_tokens ?? 1600,
      ...(extra.schema ? { text: { format: { type: 'json_schema', name: extra.schemaName ?? 'news_result', strict: true, schema: extra.schema } } }
        : extra.response_format ? { text: { format: { type: 'json_object' } } } : {}),
    };
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal: ctl.signal, headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const text = await readBoundedText(response, 300_000);
    // Do not log provider error bodies, which may echo submitted content.
    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
    const raw = JSON.parse(text) as { status?: string; output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>; usage?: unknown };
    if (raw.status !== 'completed') throw new Error(`OpenAI response ${raw.status ?? 'missing status'}`);
    const content = (raw.output ?? []).flatMap(item => item.type === 'message' ? item.content ?? [] : []);
    if (content.some(c => c.type === 'refusal')) throw new Error('OpenAI declined this analysis');
    const answer = content.filter(c => c.type === 'output_text').map(c => c.text ?? '').join('');
    if (!answer.trim()) throw new Error('OpenAI returned no usable text');
    return { choices: [{ message: { content: answer } }], usage: raw.usage };
  } finally { clearTimeout(timer); }
}
async function deadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([work, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('Workers AI deadline exceeded')), ms); })]); }
  finally { clearTimeout(timer!); }
}
/** All text tasks share provider routing, budget reservations, and output accounting. */
export async function runLLM(env: Env, task: LlmTaskTag, model: string, messages: RoleMessage[], extra: TextOptions = {}): Promise<unknown> {
  const provider = textProvider(env), effectiveModel = provider === 'openai' ? env.OPENAI_MODEL?.trim() || 'gpt-6-luna' : model;
  // UTF-8 byte count plus envelope overhead is a conservative upper bound for prompt tokens.
  const maxTokens = extra.max_tokens ?? 1600;
  const estimate = new TextEncoder().encode(JSON.stringify([messages, extra.schema ?? null])).length + 1024 + maxTokens;
  for (let attempt = 0; attempt < 2; attempt++) {
    const reservation = await reserveTextCall(env, task, provider, effectiveModel, estimate);
    try {
      let raw: unknown;
      if (provider === 'openai') raw = await openAI(env, messages, { ...extra, max_tokens: maxTokens }, effectiveModel);
      else {
        const body = { messages, max_tokens: maxTokens, temperature: extra.temperature ?? 0.2,
          ...(extra.response_format || extra.schema ? { response_format: { type: 'json_object' } } : {}),
          ...(chatTemplateKwargsForModel(model) ? { chat_template_kwargs: chatTemplateKwargsForModel(model) } : {}) };
        raw = await deadline((env.AI as Ai).run(model as keyof AiModels, body, gatewayOpts(env, task) as AiOptions), 45_000);
      }
      await finishTextCall(env, reservation, usageFrom(raw), null);
      return raw;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Text inference failed';
      await finishTextCall(env, reservation, null, message.slice(0, 200));
      // Retry only explicit retryable HTTP failures; unknown/timeout requests may already be billed.
      if (attempt === 0 && /HTTP (429|5\d\d)/.test(message)) continue;
      throw error;
    }
  }
  throw new Error('Text inference failed');
}

/**
 * Embeddings — same gateway path as chat for observability.
 */
export async function runEmbed(env: Env, texts: string[]): Promise<number[][]> {
  const opts = gatewayOpts(env, 'embed');
  const out = (await deadline((env.AI as Ai).run(
    MODEL_EMBED,
    { text: texts },
    opts as AiOptions,
  ), 45_000)) as BgeResponse;
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

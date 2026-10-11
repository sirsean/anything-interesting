import type { Env } from './env';
import { configInt } from './news_config';
export class ModelBudgetError extends Error { constructor() { super('Daily intelligence budget exhausted; work remains pending'); } }
export async function reserveTextCall(env: Env, task: string, provider: string, model: string, tokens: number): Promise<string> {
  const id = crypto.randomUUID(), day = new Date().toISOString().slice(0, 10);
  const edition = task === 'edition_select';
  const callLimit = configInt(env.AI_DAILY_CALL_LIMIT, 200, 10, 1000);
  const tokenLimit = configInt(env.AI_DAILY_TOKEN_LIMIT, 600_000, 10_000, 5_000_000);
  const reservedCalls = edition ? 0 : Math.min(5, Math.floor(callLimit / 10));
  const reservedTokens = edition ? 0 : Math.min(30_000, Math.floor(tokenLimit / 10));
  const result = await env.DB.prepare(`INSERT INTO llm_usage (id, day, task, provider, model, tokens)
    SELECT ?, ?, ?, ?, ?, ? WHERE
    (SELECT COUNT(*) FROM llm_usage WHERE day = ?) < ? AND
    (SELECT COALESCE(SUM(tokens), 0) FROM llm_usage WHERE day = ?) + ? <= ?`)
    .bind(id, day, task, provider, model, tokens, day, callLimit - reservedCalls, day, tokens, tokenLimit - reservedTokens).run();
  if (!result.meta.changes) throw new ModelBudgetError();
  return id;
}
export async function finishTextCall(env: Env, id: string, usage: { input: number; output: number } | null, error: string | null): Promise<void> {
  await env.DB.prepare(`UPDATE llm_usage SET status = ?, tokens = CASE WHEN ? IS NULL THEN tokens ELSE ? END,
    input_tokens = ?, output_tokens = ?, cost_usd = CASE WHEN provider = 'openai' AND model = 'gpt-6-luna' THEN ? ELSE 0 END, error = ? WHERE id = ?`)
    .bind(error ? 'error' : 'complete', usage ? usage.input + usage.output : null, usage ? usage.input + usage.output : null,
      usage?.input ?? 0, usage?.output ?? 0, (usage?.input ?? 0) * 0.0000001 + (usage?.output ?? 0) * 0.0000005, error, id).run();
}

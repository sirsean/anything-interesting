/**
 * Worker bindings + vars. Optional `AI_GATEWAY_ID` routes all Workers AI calls
 * through AI Gateway when set (dashboard / `wrangler vars put`).
 */
export type Env = {
  DB: D1Database;
  CONFIG: KVNamespace;
  HEADLINES: Vectorize;
  MARKETS: Vectorize;
  AI: Ai;
  DISCORD_WEBHOOK_URL?: string;
  /** Hex-encoded Discord application public key (Interactions verify). `wrangler secret put DISCORD_PUBLIC_KEY`. */
  DISCORD_PUBLIC_KEY?: string;
  /** Cloudflare AI Gateway id; empty = direct Workers AI (no gateway). */
  AI_GATEWAY_ID?: string;
};

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
  /** Optional: bot token for polling 👍/👎 on digest messages (`syncDigestReactions`). `wrangler secret put DISCORD_BOT_TOKEN`. */
  DISCORD_BOT_TOKEN?: string;
  /** Hex-encoded Discord application public key (Interactions verify). `wrangler secret put DISCORD_PUBLIC_KEY`. */
  DISCORD_PUBLIC_KEY?: string;
  /** Optional Workers AI model id for Kimi judgment; empty = default Kimi K2.6 (`wrangler vars put JUDGMENT_MODEL`). */
  JUDGMENT_MODEL?: string;
  /** Cloudflare AI Gateway id; empty = direct Workers AI (no gateway). */
  AI_GATEWAY_ID?: string;
};

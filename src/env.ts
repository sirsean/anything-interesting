/**
 * Worker bindings + vars. Optional `AI_GATEWAY_ID` routes all Workers AI calls
 * through AI Gateway when set (dashboard / `wrangler vars put`).
 */
export type Env = {
  /** Static SPA assets (`wrangler.toml` `[assets] binding = "ASSETS"`). */
  ASSETS?: Fetcher;
  DB: D1Database;
  CONFIG: KVNamespace;
  HEADLINES: Vectorize;
  MARKETS: Vectorize;
  AI: Ai;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  LLM_PROVIDER?: 'auto' | 'openai' | 'workers-ai';
  AI_DAILY_CALL_LIMIT?: string;
  AI_DAILY_TOKEN_LIMIT?: string;
  DIGEST_TIMEZONE?: string;
  DIGEST_HOUR?: string;
  DIGEST_MAX_ITEMS?: string;
  FAMILY_INTERESTS?: string;
  LOCAL_NEWS_REGION?: string;
  ENABLE_MARKET_ENRICHMENT?: string;
  ENABLE_NEWS_DISCOVERY?: string;
  DISCORD_WEBHOOK_URL?: string;
  /** Application ID (public). `wrangler.toml` [vars] / `.env` for `discord:register-topnews`. */
  DISCORD_APPLICATION_ID?: string;
  /** Optional: bot token for polling 👍/👎 on digest messages (`syncDigestReactions`). `wrangler secret put DISCORD_BOT_TOKEN`. */
  DISCORD_BOT_TOKEN?: string;
  /** Hex-encoded Discord application public key (Interactions verify). `wrangler secret put DISCORD_PUBLIC_KEY`. */
  DISCORD_PUBLIC_KEY?: string;
  /** Optional Workers AI model id for Kimi judgment; empty = default Kimi K2.6 (`wrangler vars put JUDGMENT_MODEL`). */
  JUDGMENT_MODEL?: string;
  /** Cloudflare AI Gateway id; empty = direct Workers AI (no gateway). */
  AI_GATEWAY_ID?: string;
  /**
   * Public origin of the M6 SPA (no trailing slash), e.g. `https://anything-interesting.example.workers.dev`.
   * When set, scheduled digest embed titles link to `/cluster/:id` here instead of the top article URL.
   */
  PUBLIC_SITE_URL?: string;
  /** `wrangler secret put OPS_TOKEN` — required for `POST /ops/refresh-watchlist`. */
  OPS_TOKEN?: string;
  /**
   * Brave Search API subscription token for Strategy B market research
   * (`wrangler secret put BRAVE_SEARCH_API_KEY`). Optional — research is skipped when unset.
   */
  BRAVE_SEARCH_API_KEY?: string;
};

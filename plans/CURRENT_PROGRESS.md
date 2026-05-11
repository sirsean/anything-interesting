# Current progress

**Project:** News Alerting Agent (Cloudflare Worker + D1 + Vectorize + KV + Discord). Full vision and decisions: `INITIAL.md`.

**Agent workflow:** Work milestones **in order** (M1 → M5). Each milestone file is a self-contained checklist. Update this file when you **start** or **finish** a milestone (date, branch, notes, blockers).

---

## Milestone index

| Order | File | Summary |
| ----- | ---- | ------- |
| M1 | [`MILESTONE-01-cloudflare-mvp.md`](MILESTONE-01-cloudflare-mvp.md) | Wrangler, D1/KV/Vectorize bindings, hourly cron, 3× RSS, dedup, naive clustering, webhook digest @ 05/15/18 CT |
| M2 | [`MILESTONE-02-workers-ai-scoring.md`](MILESTONE-02-workers-ai-scoring.md) | AI Gateway, BGE + Vectorize clustering, GLM rerank/summary, Kimi judgment, topical weights, 0.60 / cap-3 digest |
| M3 | [`MILESTONE-03-polymarket.md`](MILESTONE-03-polymarket.md) | Gamma + CLOB, watchlist, market embeddings, Strategy A + B, 📈 market-driven items |
| M4 | [`MILESTONE-04-discord-slash-topnews.md`](MILESTONE-04-discord-slash-topnews.md) | Slash `/topnews`, ed25519 verify, PING/PONG, D1 queries, embeds + status badges |
| M5 | [`MILESTONE-05-feedback-source-weighting.md`](MILESTONE-05-feedback-source-weighting.md) | Reactions → `feedback`, dynamic `source_weights`, optional prompt / provider upgrades |

---

## Status

| Milestone | State | Owner / notes |
| --------- | ----- | ------------- |
| M1 | **Implementation complete; prod smoke optional** | Code matches M1 checklist (cron, D1/KV, 3× RSS, dedup, Jaccard clusters, CT digest gate, webhook + ≥3 sources / 12h). Vectorize deferred to M2. **2026-05-10:** Verified `Intl` returns padded hours (`"05"`); digest gate updated to numeric compare so 05:00 CT runs. |
| M2 | **Implementation complete; prod smoke optional** | Shipped: `[ai]`, optional `AI_GATEWAY_ID`, Vectorize `headlines` (1024 cosine), BGE + NN clustering + GLM rerank band, Kimi judgment + INITIAL scoring + digest rules (≥0.60, grace, cap 3/4), GLM summaries. **2026-05-10:** Vectorize index created, D1 `0002` applied local+remote, Worker deployed (`anything-interesting`). Optional: `wrangler tail` once at a digest hour to confirm webhook + logs. |
| M3 | **Implementation complete; deployed; prod smoke optional** | Shipped 2026-05-10: Gamma + CLOB clients (`src/polymarket.ts`), watchlist with deterministic+Kimi filter (`src/watchlist.ts`), hourly `market_snapshots` writer + Strategy B sweep (`src/snapshots.ts`), Strategy A match wired into `refreshClusterScores` (`src/match_markets.ts`), digest embeds with Polymarket field + 📈 prefix + relaxed source gate for market-driven items, `0003_m3_polymarket.sql` migration, `MARKETS` Vectorize binding. **2026-05-10:** Vectorize `markets` index created; D1 `0003` applied local + remote; Worker deployed (version `cd7e14c5-ed29-49b3-8bf3-3cffbd6e0d8c`); `/health` 200. Optional: `npx wrangler tail` next hour to confirm `watchlist refresh persisted=…` + `snapshots done …` lines. |
| M4 | **Implementation + operator wiring complete; smoke pending** | Code: `POST /interactions` (`src/interactions.ts`) — Web Crypto ed25519 verify (`DISCORD_PUBLIC_KEY`), PING `type: 1`, `/topnews` deferred `type: 5` + follow-up to `webhooks/{app}/{token}` (no bot token in Worker), D1 last-12h query + optional topic, embeds via shared `discord_cluster_embed.ts`, Digest status badges (`posted` / `upcoming` / `below threshold`). Registration: `npm run discord:register-topnews` (`scripts/register-topnews.mjs`, bot token env-only). Migration `0004_m4_topnews_index.sql`. **2026-05-10:** operator wiring completed: Discord app + bot, Interactions URL, `DISCORD_PUBLIC_KEY`, command registration, bot install, D1 `0004`, and deploy. Waiting on live `/topnews` / log smoke evidence. |
| M5 | **Implementation + operator wiring complete; cron smoke pending** | Shipped: `feedback` + `source_weights` + `post_cluster_messages` (`0005_m5_feedback.sql`); digest = one Discord message per cluster + footer hint; hourly `syncDigestReactions` (`src/reaction_sync.ts`) with optional `DISCORD_BOT_TOKEN` + webhook channel resolve; weighted coverage gate (`MIN_WEIGHTED_SOURCE_COVERAGE` 3.0) in `digest.ts`, `interactions.ts`, `scoring.ts`; `JUDGMENT_MODEL` var for optional Kimi swap. **2026-05-10:** operator wiring completed: D1 `0005` local + remote, `DISCORD_BOT_TOKEN` secret, bot channel access, and deploy. Waiting for scheduled cron smoke to confirm digest/reaction polling and source-weight updates. Optional: `wrangler vars put JUDGMENT_MODEL=<slug>`. |

### M5 setup (operator)

1. **D1:** applied `0005_m5_feedback.sql` — `npm run db:local` and `npm run db:remote`.
2. **Discord bot token in Worker:** configured via `npx wrangler secret put DISCORD_BOT_TOKEN` — same bot installed in the digest channel as for slash commands. Needed only so the hourly job can `GET …/reactions` on digest messages (webhook posts are visible to the bot). Scope: channel access + Read Message History.
3. **Deploy:** completed via `npm run deploy`.
4. **Behavior:** First poll after a digest **baselines** existing reactors (no weight change); **new** 👍/👎 after that adjust `source_weights` and re-score clusters that touch those outlets. Weights stay in `[0.5, 1.5]` with Bayesian smoothing toward 1.0 until 20+ feedback events per outlet.
5. **Optional:** `npx wrangler vars put JUDGMENT_MODEL` — Workers AI model slug for the judgment step (default Kimi K2.6).
6. **Tuning loop (manual):** Query `feedback` for 👎 on `post_cluster_messages` rows tied to posted digests; spot-check `llm_reasoning_log` on those clusters; adjust prompts in `scoring.ts` / `llm.ts` as needed.

### M4 setup (operator)

1. **Discord Developer Portal:** application + bot user created. **Interactions Endpoint URL:** `https://anything-interesting.sirsean.workers.dev/interactions` (replace host if your worker name/route differs).
2. **Secret:** `DISCORD_PUBLIC_KEY` configured with `npx wrangler secret put DISCORD_PUBLIC_KEY`. The Worker never stores the bot token.
3. **Register slash command (one-time, from laptop/CI):** completed with `npm run discord:register-topnews` using repo-root `.env` (gitignored; see `.env.example` and `AGENTS.md`). The bot token is only used for this HTTP call to Discord’s API (`PUT /applications/.../commands`).
4. **D1:** applied `0004_m4_topnews_index.sql` — `npm run db:local` and `npm run db:remote`.
5. **Deploy:** completed via `npm run deploy`.
6. **Install** the bot to your server — completed.
7. **Verify:** Portal “Interactions” test / first `/topnews` in Discord; `npx wrangler tail anything-interesting` on errors. PING succeeds when URL + public key are correct.
8. **Behavior notes:** `/topnews` always responds with a **deferred** acknowledgement (`type: 5`) then posts the real message via the **interaction webhook** within 15 minutes so slow D1/embed work never misses Discord’s 3s window. Descriptions match digest *fields*; copy uses the same truncated rep line as the digest GLM fallback (no extra Workers AI on the hot path).

### M2 setup (operator)

1. **Vectorize:** index `headlines` (`--dimensions=1024 --metric=cosine`) — created **2026-05-10**.
2. **D1:** migration `0002_m2_cluster_scoring.sql` — applied remote + local.
3. **Deploy:** `npm run deploy` — production Worker updated with `HEADLINES` + `AI` bindings.
4. **Optional prod check:** at 05:00 / 15:00 / 18:00 CT, `npx wrangler tail anything-interesting` and confirm digest or quiet run; same RSS/DNS caveats as M1 for local `wrangler dev`.

### M3 setup (operator)

1. **Vectorize:** create the new index — `npx wrangler vectorize create markets --dimensions=1024 --metric=cosine`.
2. **D1 migrations:** `npm run db:local` and `npm run db:remote` to apply `0003_m3_polymarket.sql` (adds `markets`, `market_snapshots`, and three `clusters` columns).
3. **Deploy:** `npm run deploy`. The new `MARKETS` binding in `wrangler.toml` will publish on next deploy.
4. **First-hour expectations** (visible via `npx wrangler tail anything-interesting`):
   - `watchlist refresh persisted=…` once per ~24h (cursor `cursors:watchlist_refreshed_at`).
   - `snapshots done snapshotted=… flagged=… market_driven=…` every hour.
   - News-driven clusters with ≥3 distinct sources may now show a Polymarket field; market-driven items appear with a 📈 prefix and `market-driven` footer flavor.
5. **Outbound dependencies:** `gamma-api.polymarket.com` + `clob.polymarket.com`. Same RSS/DNS caveats as M1 if testing locally with `wrangler dev`.
6. **Cost guardrails baked in:** Kimi watchlist disambiguation cap = 30/refresh; Strategy B Kimi cap = 4/run; Strategy A Kimi rerank only when distinct sources ≥ 3 *and* top similarity ≥ 0.70. Existing `KIMI_DAILY_CAP=22` from M2 still bounds the judgment step.

---

## M1 setup (operator)

1. **Discord webhook (digest):** configured (`DISCORD_WEBHOOK_URL`). To rotate: `npx wrangler secret put DISCORD_WEBHOOK_URL`.
2. **Remote D1 migrations:** already applied once; after new migration files run `npm run db:remote` (and `db:local` for dev).
3. **Deploy:** `npm run deploy` from repo root.
4. **Health:** `GET https://anything-interesting.sirsean.workers.dev/health` → JSON `{ ok: true }`.
5. **Cron:** hourly `0 * * * *` — `scheduled()` runs ingest every hour; digest runs only when America/Chicago hour is **5, 15, or 18** (see `src/chicago.ts`).

### M1 verification — first digest at 05:00 CT

- **Production:** At the top of an hour when Chicago is 05:00, 15:00, or 18:00, confirm a single webhook message with header like `05:00 CT digest — N items` (or a quiet run if no cluster has ≥3 distinct sources with `fetched_at` in the last 12h).
- **Logs:** `npx wrangler tail anything-interesting` and look for `scheduled tick Chicago hour=…`, `ingest done …`, and either `Digest: no eligible clusters` or `Digest posted post_id=…`.
- **Local / `wrangler dev`:** use `npx wrangler dev --local --test-scheduled` and open `/__scheduled`. Outbound RSS fetches require working DNS from the machine running workerd (some environments block or fail lookups).

### RSS note

Starter feeds in `src/sources.ts` are **The Guardian** World (`theguardian.com/world/rss`), **BBC** World, and **NPR** Topics: News (`feeds.npr.org/1001/rss.xml`). Reuters and AP canonical RSS URLs were dropped (401/530 from Workers); swap in other `INITIAL.md` feeds if any of these degrade.

---

**2026-05-10:** Added Vitest unit suite (`npm test` / `npm run test:watch`) covering time gates, RSS/Discord helpers, Polymarket normalization, digest selection, scoring/LLM parsing, source-weight math, Discord interactions (signature + `/topnews` options), and Worker `/health`.

---

_Last updated: 2026-05-10 — M4/M5 operator wiring complete. Waiting on scheduled cron smoke checks via `npx wrangler tail anything-interesting`: ingest/snapshot logs, digest post or quiet run, and M5 reaction polling/source-weight update after reactions._

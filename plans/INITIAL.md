# News Alerting Agent — Implementation Plan (v3)

## Goal

A Cloudflare-hosted system that ingests news hourly, scores candidate stories continuously against multi-source coverage and Polymarket prediction-market signals, and:

- delivers a curated digest to a Discord channel at three fixed times daily (05:00 / 15:00 / 18:00 America/Chicago);
- answers on-demand `/topnews` queries in Discord at any time from the same scored pool.

Optimize for **high precision** over recall. Better to ship a quiet channel than a noisy one.

## Architecture

Two flows on the same hourly cron, plus an interactions endpoint:

```
                                ┌─────────────────────────────────┐
                                │     Hourly Cron Trigger         │
                                └───────────┬─────────────────────┘
                                            ▼
                              ┌─────────────────────────────┐
                              │  Ingest pipeline (always)   │
                              │  - Fetch RSS + JSON sources │
                              │  - Dedup + cluster          │
                              │  - Score candidates         │
                              │  - Snapshot Polymarket      │
                              └───────────┬─────────────────┘
                                          ▼
                                ┌─────────────────────┐
                                │  Candidate pool     │
                                │  (D1 + Vectorize)   │
                                └───────┬──────┬──────┘
                                        │      │
                                        ▼      ▼
            ┌──────────────────────────────┐  ┌─────────────────────────────┐
            │  Digest delivery (gated by   │  │  On-demand /topnews         │
            │  America/Chicago hour ∈      │  │  - Discord interaction POST │
            │  {5,15,18})                  │  │  - Signature verify         │
            │  - Pick top-N since last     │  │  - Pick top-N from pool     │
            │    digest                    │  │  - Respond inline           │
            │  - Webhook POST to Discord   │  │                             │
            └──────────────────────────────┘  └─────────────────────────────┘
```

Same Worker handles both `scheduled()` events (cron) and `fetch()` events (Discord interactions).

## Cadence

**Ingest cadence**: hourly (`0 * * * *`). Every hour we fetch new items, update clusters, re-score, and snapshot Polymarket prices.

**Digest delivery times** (Chicago): 05:00, 15:00, 18:00.

The hourly cron runs in UTC. Inside the handler, gate digest delivery on local hour:

```ts
const hourCT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: 'numeric', hour12: false,
}).format(new Date());

await runIngest(env);                          // every hour
if (['5','15','18'].includes(hourCT)) {
  await deliverDigest(env, hourCT);            // three times a day
}
```

Hourly cron sidesteps DST entirely — no need for paired UTC slots. The local-hour check handles the shift automatically.

## Hosting & Stack

Fully Cloudflare-native:

- **Cloudflare Workers** (TypeScript) — single Worker handles cron + Discord interactions
- **Cron Triggers** — hourly schedule in `wrangler.toml`
- **D1** — relational state (articles, clusters, scores, market snapshots, posts, feedback)
- **Vectorize** — headline and market embeddings
- **KV** — config, watchlist cache, cursors
- **Workers AI** — LLM inference via AI Gateway
- **Wrangler** — local dev and deploy
- **Wrangler secrets** — Discord webhook URL, Discord bot token (setup only), Discord public key (for verifying interactions)

Workers Paid plan ($5/mo) recommended for D1 volume and Workers AI usage.

## Workers AI Model Choices

| Task                            | Model                                                | Why                                                        |
| ------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| Headline & market embeddings    | `@cf/baai/bge-large-en-v1.5`                         | 1024-dim, fast, Vectorize-native                           |
| Article summary (1–2 sentences) | `@cf/zai/glm-4-7-flash`                              | Cheap, 131k context for full articles                      |
| Cluster rerank (close calls)    | `@cf/zai/glm-4-7-flash`                              | Light reasoning                                            |
| Final interestingness judgment  | `@cf/moonshotai/kimi-k2-6` *(or `gpt-oss-120b`)*     | Frontier-scale, 262k context, well-calibrated reasoning    |
| Market-matching rerank          | Kimi K2.6                                            | Same                                                       |
| Watchlist disambiguation        | Kimi K2.6                                            | Filter top-volume markets to relevant categories           |
| Discord message copy            | GLM-4.7-Flash                                        | Cheap, good enough for short copy                          |

Always invoke via `env.AI.run('...')` so AI Gateway captures every call (cache, retry, fallback, observability). Verify exact model slugs at `https://developers.cloudflare.com/workers-ai/models/` before wiring — model IDs rotate.

**Upgrade escape hatch**: if precision plateaus, route just the judgment step through AI Gateway to Anthropic Sonnet. Same `env.AI.run()` binding, one-line change.

## Data Sources

### News

RSS feeds (free, no keys). Starter set:

- Reuters Top News / World / Politics / Business
- AP News top stories: `https://apnews.com/index.rss`
- BBC World: `http://feeds.bbci.co.uk/news/world/rss.xml`
- Financial Times World: `https://www.ft.com/world?format=rss`
- The Economist (per-section feeds)
- Politico: `https://www.politico.com/rss/politicopicks.xml`
- Foreign Policy: `https://foreignpolicy.com/feed/`
- War on the Rocks: `https://warontherocks.com/feed/` (geopolitics depth)
- Ars Technica: `http://feeds.arstechnica.com/arstechnica/index`
- The Verge: `https://www.theverge.com/rss/index.xml`

JSON APIs:

- HackerNews Firebase API (tech signal, free)
- Reddit JSON (`/r/worldnews`, `/r/geopolitics`, `/r/economics`, `/r/technology` hot.json) — user-agent required, rate-limited

Fetch in parallel; use `If-Modified-Since` / `ETag` to minimize traffic.

### Polymarket

- **Gamma API** (`https://gamma-api.polymarket.com`) — markets & events, sortable by volume
- **CLOB API** (`https://clob.polymarket.com`) — orderbook, prices, history

Verify endpoint shapes at `https://docs.polymarket.com` before wiring. We need: active markets sorted by 24h volume; current YES probability; 24h price history; single-market lookup by slug.

## Scoring Pipeline (continuous)

The ingest pipeline runs every hour, but scoring is event-driven within it:

1. **Fetch & ingest**: pull new articles from all sources; store with URL-hash dedup.
2. **Embed**: each new headline embedded via BGE; written to Vectorize and D1.
3. **Cluster**: nearest-neighbor lookup against recent (7-day) headline embeddings. Cosine > 0.82 = same cluster. Close calls (0.78–0.82) get a GLM-4.7-Flash rerank.
4. **Update cluster signals** as new articles join:
   - source count (weighted by source weights — see Phase 5)
   - novelty (first_seen recency)
   - Polymarket match (Vectorize lookup against market index)
   - Polymarket surprise (price delta on matched markets)
5. **Candidacy gate**: a cluster becomes a "candidate" when source-weight-sum ≥ 3.0 OR it has a strong Polymarket match. Sub-threshold clusters skip the LLM judgment to save cost.
6. **LLM judgment** (Kimi K2.6): runs once when a cluster enters candidacy, and re-runs when signals change materially (e.g. a new strong source joins, or matched Polymarket moves significantly). Result cached on the cluster row.

Cluster gets a current `final_score` updated whenever signals change:

```
final_score = topical_weight * (
  0.10 * coverage_score +
  0.15 * novelty_score  +
  0.30 * surprise_score +
  0.45 * llm_score
)
```

Topical weights:
- Geopolitics: **0.40**
- Politics: 0.20
- Economics: 0.20
- Technology: 0.20

Multiplicative, not a hard filter — major tech stories still get through with a higher bar.

LLM call budget: ~10–20 judgments per day, plus summaries when posting. Comfortably under 100 LLM calls/day total.

## Digest Delivery (scheduled)

At 05:00 / 15:00 / 18:00 CT:

1. Query D1 for clusters with `final_score ≥ 0.60` AND `posted = false` AND `first_seen ≥ last_digest_time - 24h grace`.
2. Order by score, take top 3 (allow up to 4 if there's an unusually strong cluster).
3. For each, generate Discord embed (summary via GLM, market context if matched).
4. Post a single Discord message with multiple embeds via webhook. Lead with header: `"05:00 CT digest — 3 items"`.
5. Mark posted in D1 with the digest timestamp and message ID.
6. Quiet days post nothing.

## On-Demand `/topnews` (Discord slash command)

Same Worker, `fetch()` handler.

### Setup

1. Create Discord application in the developer portal.
2. Register slash command via API (one-time script, uses bot token):
   ```
   /topnews [count: 1-5] [topic: geopolitics|politics|economics|technology]
   ```
3. Set the application's **Interactions Endpoint URL** to the Worker's public URL. Discord pings it with a PING during setup; the Worker must respond with a signed PONG.
4. Install the bot to the user's server.

The bot token is used only during command registration. The Worker only stores the Discord application's **public key** to verify incoming interaction signatures (ed25519). No persistent bot connection needed.

### Runtime

On a Discord interaction POST:

1. Verify ed25519 signature against the public key. Reject 401 on failure.
2. If `type == PING (1)`: reply `{ type: 1 }`.
3. If `type == APPLICATION_COMMAND (2)`:
   - Parse options (count, optional topic filter).
   - Query D1 for clusters scored in last 12h, filtered by topic if specified, sorted by `final_score` desc, top N.
   - Generate response embeds. Mark each: "in upcoming 18:00 digest" / "posted in 15:00 digest" / "below digest threshold" based on `posted` status and score.
   - Respond with `{ type: 4, data: { embeds: [...] } }`.

Discord requires a response within 3 seconds. If queries get slow, return a deferred response (`type: 5`) immediately and follow up via webhook within 15 minutes.

Possible extensions for later: `/why <market>` to explain a recent Polymarket move; `/source on|off` to toggle a source; `/digest now` to force-trigger a digest.

## Polymarket Surprise Signal

### Auto-generated watchlist

- Daily job pulls top **50 markets by 24h volume** from Gamma API.
- Deterministic filter on category tags: drop sports, pop culture, entertainment. Keep elections, geopolitics, economics, policy, tech, science.
- Ambiguous categories: Kimi K2.6 classifies "keep / drop."
- Persist curated list in KV (24h TTL) and Vectorize (market embeddings).

### Strategy A — News → Markets

For each candidate cluster:

1. Embed representative headline + summary.
2. Query Vectorize markets index, top-10.
3. If top similarity > 0.70, Kimi K2.6 reranks to pick truly-relevant markets (usually 0–2).
4. Compute surprise: `|price_now - price_24h_ago|`, scaled, with bonus when prior was near 50%.

### Strategy B — Markets → News (catches what news hasn't framed yet)

On each hourly ingest:

- Fetch current prices for the watchlist; compare to snapshots.
- Flag any with movement > 4% absolute or > 25% relative.
- For each flagged market, search recent articles (last 24h) using keywords from market title.
- Kimi K2.6 writes a "what likely happened" explainer.
- Goes into the same candidate pool with a flag `flow_type = market_driven`; surfaces in digests and on-demand alongside news-driven items, with a 📈 prefix in the embed title.

## LLM vs Deterministic Boundary

**LLM (Workers AI)**: article summaries, close-call clustering reranks, watchlist disambiguation, market-matching reranks, final interestingness judgment, Discord copy.

**Plain code**: feed parsing, HTTP, dedup, hashing, storage, Polymarket calls, price math, cron handling, DST gating, Discord webhook posting, interaction signature verification, scoring math.

## Discord Output

Single channel, two posting paths:

- **Digest** (scheduled): webhook POST, single message with up to 4 embeds.
- **On-demand**: slash command response, embeds rendered by Discord from the interaction reply.

Embed format:

```json
{
  "title": "Headline (max 256 chars)",
  "url": "https://source.example/article",
  "description": "1–2 sentence summary from Kimi.",
  "color": 15844367,
  "fields": [
    {"name": "Topic", "value": "Geopolitics", "inline": true},
    {"name": "Sources", "value": "Reuters, AP, FT", "inline": true},
    {"name": "Polymarket", "value": "[Will X happen by Y?](url) — 34% (↑8% today)", "inline": false}
  ],
  "footer": {"text": "Score: 0.82 · news-driven"}
}
```

Market-driven embeds get title prefix 📈.

## State / Storage

**D1**:

```
articles(id, url_hash UNIQUE, title, source, fetched_at, published_at,
         cluster_id, vec_id)

clusters(id, first_seen, last_updated, representative_title,
         topic, source_weight_sum, novelty_score, surprise_score,
         llm_score, final_score, polymarket_slug, flow_type,
         posted_digest_id, llm_reasoning_log)

market_snapshots(market_slug, price, volume_24h, taken_at)  -- 14d retention

markets(slug PRIMARY KEY, title, description, category, end_date,
        vec_id, last_seen_in_watchlist)

posts(id, digest_timestamp, cluster_ids JSON, message_id, channel_kind)

feedback(message_id, cluster_id, user_id, reaction, ts)

source_weights(source TEXT PRIMARY KEY, weight REAL DEFAULT 1.0,
               pos_count INT DEFAULT 0, neg_count INT DEFAULT 0,
               last_updated)
```

Add indices for: `clusters(final_score DESC, posted_digest_id IS NULL)`, `clusters(topic, final_score DESC)`, `articles(cluster_id)`.

**Vectorize**:

- `headlines` — recent headline embeddings (TTL 30d for dedup/clustering)
- `markets` — market title+description embeddings

**KV**:

- `config:topic_weights`
- `watchlist:current`
- `cursors:last_digest_at`
- `cursors:last_ingest_per_source`

## Implementation Phases

### Phase 1 — MVP on Cloudflare (~2 days)

- `wrangler init` TypeScript Worker.
- D1, KV, Vectorize bindings; schema migration.
- Hourly cron handler.
- RSS fetcher for 3 starter sources (Reuters, AP, BBC).
- URL-hash dedup.
- Naive clustering: substring overlap on titles.
- Discord webhook poster.
- Digest delivery gated on Chicago local hour.
- Threshold: ≥3 sources within 12h.
- Verify first digest fires at 05:00 CT.

### Phase 2 — Workers AI scoring (~2 days)

- `env.AI` binding with AI Gateway.
- BGE embeddings into Vectorize.
- Real clustering with cosine + GLM rerank on close calls.
- Kimi K2.6 interestingness judgment with explicit criteria prompt. Log reasoning.
- GLM article summaries in embed descriptions.
- Topical weighting; 0.60 threshold; hard cap of 3 items.

### Phase 3 — Polymarket integration (~2–3 days)

- Gamma API client; auto-watchlist with category filter + Kimi disambiguation.
- CLOB price fetcher; hourly snapshot loop.
- Market embeddings into Vectorize.
- Strategy A (news → markets) — augment candidates with market match + surprise score.
- Strategy B (markets → news) — movement detector + news search + Kimi explainer + 📈 entries in the pool.

### Phase 4 — On-demand Discord bot (~1–2 days)

- Discord application + bot user setup.
- Slash command registration script (`/topnews [count] [topic]`).
- Worker `fetch()` handler with ed25519 signature verification.
- PING/PONG handshake to pass Discord's endpoint validation.
- Query D1 for top-N from last 12h; respond inline with embeds.
- Status badges on results ("in upcoming digest", "already posted", "below threshold").

### Phase 5 — Feedback loop & dynamic source weighting (~ongoing)

- Listen for reactions: extend the bot to handle Message Components or a separate ingest of reaction events via Discord webhook events.
- Write reactions into `feedback` table with cluster + source attribution.
- Per-source weight update on each reaction:
  ```
  weight_new = weight_old + (reaction == 👍 ? +0.02 : -0.02)
  weight_new = clamp(weight_new, 0.5, 1.5)
  // Bayesian smoothing toward 1.0 when pos_count + neg_count < 10
  effective_weight = (1 - α) * 1.0 + α * weight_new
  where α = min(1, (pos_count + neg_count) / 20)
  ```
- Source weights feed back into `source_weight_sum` in cluster scoring on next ingest.
- Periodic prompt refinement using logged `llm_reasoning` of false positives (👎'd posts) and false negatives (high-engagement posts that scored low historically).
- Optional AI Gateway swap to Anthropic Sonnet for judgment step if precision plateaus.

## Resolved Decisions

- Cadence: hourly ingest + digest delivery at 05:00 / 15:00 / 18:00 CT
- Hosting: Cloudflare (Workers + D1 + Vectorize + KV)
- LLM: Workers AI (Kimi K2.6 primary, GLM-4.7-Flash for cheap tasks); AI Gateway in front
- Topic weights: Geopolitics 0.40, Politics/Economics/Tech 0.20 each
- Polymarket watchlist: auto-generated from top 50 markets by 24h volume, category-filtered
- Precision: 0.60 threshold, hard cap of 3 items/digest, quiet runs post nothing
- Discord: single channel; webhook for digests + bot interactions for `/topnews`
- Source weighting: start equal at 1.0, drift dynamically based on reactions (Phase 5)

## Non-goals

- Multi-user / multi-channel support
- Web UI
- Trading on Polymarket
- Comprehensive news coverage — curated signal feed, not a reader

## Notes for the Coding Agent

- Workers Cron Triggers fire `scheduled()` events; Discord interactions arrive as `fetch()` POSTs. The same Worker handles both.
- Discord requires interaction signature verification using ed25519. Cloudflare's `Web Crypto API` supports this natively — no third-party library needed.
- Discord requires a response within 3s; use `type: 5` (deferred) if you need longer and follow up via webhook within 15 min.
- Vectorize queries are eventually consistent — writes may take a few seconds to be queryable. For same-run dedup, also check D1 by URL hash.
- D1 has per-query row limits; use pagination for the headline embedding history if it grows large.
- Test the DST gate at the actual hour transition (Mar/Nov) — it's the most likely place for a bug.
- Keep all model invocations behind a `runLLM(env, task, prompt)` wrapper so swapping models or providers later is a one-file change.

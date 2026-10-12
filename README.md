# anything-interesting

A small family newspaper: collect useful reporting, find a few things worth talking about, and send an afternoon Discord briefing. Browse the same explanations and their sources on the website.

The hourly Cloudflare Worker collects 25 feeds across science, space, nature, health, engineering, culture, sport and public affairs. Each tick archives up to six newest entries per feed (150 total), enriches up to 40 pending articles and analyzes up to 16 stories with topic fairness. It saves reporting before AI work, clusters stories using Workers AI embeddings, and analyzes evidence with **OpenAI `gpt-6-luna`** when configured. The explicit Workers AI fallback follows the same editorial policy. Confidence is separate from interest; specialist and primary reporting can qualify without three publishers.

One daily edition, by default **5 p.m. America/Chicago**, aims for **3–5 distinct stories**. Discord shows a linked headline and one short paragraph explaining what happened and why it is interesting (usually 25–45 words, at most 60). The website retains useful details, qualifications, conversation questions and evidence links. Fewer stories are fine. Failed collection is distinguished from a quiet day. Polymarket is a separate browseable section; odds and market contracts cannot enter the main briefing.

## Start locally

Workers Paid is required for the hourly pipeline’s database workload. Node **22.17+** is required for the real SQLite integration tests and source audit.

```bash
npm install
npm run db:local
npm run dev
```

Local Worker secrets belong in **`.dev.vars`** (gitignored), rather than `.env`:

```dotenv
OPENAI_API_KEY=your-key
```

`.env` is for local operator scripts such as Discord slash command registration. The Vite plugin serves React and Worker routes together and shares project-root `.wrangler/state/`. `npm run build` and `npm run preview` serve a production-shaped local build.

`GET /__scheduled` triggers the real pipeline only on loopback. It can use real AI bindings and deliver Discord messages if local secrets are configured; use mocked tests for offline verification.

## Configuration

Worker variables are in `wrangler.toml`:

| Variable | Default / purpose |
| --- | --- |
| `LLM_PROVIDER` | `auto`: OpenAI when a key exists, otherwise Workers AI. `openai` requires the key; `workers-ai` pins the fallback. |
| `OPENAI_MODEL` | `gpt-6-luna`, verified API model identifier |
| `AI_DAILY_CALL_LIMIT` | `200` text calls per UTC day, including retries and optional market tasks |
| `AI_DAILY_TOKEN_LIMIT` | `600000` reserved/actual text tokens per UTC day |
| `DIGEST_TIMEZONE`, `DIGEST_HOUR` | `America/Chicago`, `17`; later hourly ticks retry that day's preparation/delivery |
| `DIGEST_MAX_ITEMS` | `5` (1–5); no minimum forces weak stories into an edition |
| `FAMILY_INTERESTS` | Optional plain-language preferences; no assumed ages |
| `LOCAL_NEWS_REGION` | Optional location; local discovery requires search enabled |
| `ENABLE_NEWS_DISCOVERY` | `false`; enable up to four daily Brave discovery queries plus four cached thin-evidence research queries for discoveries, culture, configured interests/locality |
| `ENABLE_MARKET_ENRICHMENT` | `false`; opt into legacy market watchlist/snapshot/research work separately |
| `PUBLIC_SITE_URL` | Website origin for Discord story links |
| `JUDGMENT_MODEL`, `AI_GATEWAY_ID` | Workers AI fallback model override and optional gateway |

Text calls use atomic D1 budget reservations, conservative UTF-8 token bounds and actual usage reconciliation when available. Capacity is reserved for the final edition editor. Unknown billing outcomes retain their reservation. Embeddings, search, D1 and hosting have separate provider costs. Displayed dollar estimates cover successful Luna calls at the verified October 2026 prices, excluding infrastructure and uncertain calls; changing the model requires updating the price estimate.

| Worker secret | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI Responses API intelligence |
| `DISCORD_WEBHOOK_URL` | Edition delivery |
| `DISCORD_PUBLIC_KEY` | Interaction signature verification |
| `DISCORD_BOT_TOKEN` | Poll story-interest reactions; never changes publisher reliability |
| `OPS_TOKEN` | Protect operator routes |
| `BRAVE_SEARCH_API_KEY` | Optional bounded discovery and opt-in market research |

The OpenAI adapter uses low reasoning, strict JSON schemas for editorial tasks, `store: false`, deadlines and bounded retries. It omits temperature. Embeddings stay in Cloudflare.

## Deploy this revision

Existing D1/KV/Vectorize/AI bindings are preserved. Migrations `0009_family_news.sql`, `0010_news_research.sql` and `0011_editorial_policy.sql` are additive and keep historical articles, posts and markets.

```bash
npx wrangler secret put OPENAI_API_KEY
npm run db:remote
npm run deploy
npm run discord:register-topnews
```

Enter the key at the secret command's prompt; do not paste it into chat or commit it. Slash registration reads `DISCORD_APPLICATION_ID` and `DISCORD_BOT_TOKEN` from repo-root `.env` via dotenv. It updates the broader topic choices. Deployment uses Vite's generated `dist/anything_interesting/wrangler.json`.

See [rollout checks](plans/ROLLOUT-family-news.md) for read-only preview, comparison and live provider validation. Code tests do not establish how useful your family will find the stories.

## Website and API

The front page leads with the most recent saved edition and has a broader news browser beneath it. Story pages lead with the brief and evidence; editorial measurements and market context are expandable. The archive reproduces the saved copy, including meaningful updates. Earlier posts remain in a separate historical section.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/edition` | Latest immutable edition and delivery state |
| `GET /api/editions?limit=10` | Saved editions (maximum 30) |
| `GET /api/editions/:id` | A specific edition |
| `GET /api/edition/preview` | Read-only deterministic selection; no model call or Discord post |
| `GET /api/status` | Source freshness, pending analysis, provider and budget, latest pipeline run |
| `GET /api/topnews?topic=science&count=25&window=24` | Analyzed news pool; market-driven stories excluded |
| `GET /api/clusters/:id` | Current brief, evidence and reporting |
| `GET /api/digests` | Historical posts predating saved editions |
| `GET /api/markets`, `GET /api/markets/:slug` | Separate market browser |
| `GET /api/stats`, `GET /api/stats/kimi` | Aggregate and historical Kimi counters |
| `POST /ops/edition/prepare` | Save today's edition without posting; requires `X-Ops-Token` |
| `POST /ops/news/refresh` | Collect and analyze current news without preparing or delivering an edition; requires `X-Ops-Token` |
| `POST /ops/edition/reconcile` | Resolve an uncertain delivery after checking Discord; requires `X-Ops-Token` |

`/topnews` uses the same concise Discord format for today's saved briefs or diverse qualified current stories. It does not call a model on demand. API responses are briefly cached. `GET /health` checks the Worker itself; `/api/status` assesses the news pipeline.

## Delivery and feedback

A daily preparation lease and unique local-day record prevent overlapping editions. Briefs and citations are saved before delivery. Each story's message ID and status are durable; known failed requests retry without repeating successful messages. A timeout or interrupted request is **uncertain**, since Discord webhook creation cannot guarantee exactly-once delivery. Check Discord and reconcile that item before retrying; successful records are never deleted on a later failure.

Immediate 👍/👎 reactions on new edition messages count from the first poll. Historical messages retain their initial baseline. Votes express story interest, not source reliability. Smoothed topic preferences modestly affect selection; major news remains eligible.

## Validation and maintenance

```bash
npm test
npm run check
npm run editorial:eval
npm run sources:check
npm run editorial:smoke
npm run build
npx wrangler deploy -c dist/anything_interesting/wrangler.json --dry-run
```

The editorial evaluation uses **labeled synthetic regression scenarios**, covering specialist recall, unsupported odds, duplicate elections, diversity, repeat suppression, material updates, quiet days and major events. It reports precision, missed expected items, duplicate events, topic count and citation validity. Human ratings after rollout are needed to validate real editorial usefulness.

Feed checks verify public endpoints from the development host; Cloudflare freshness is reported separately at runtime. RSS snippets and bounded page excerpts are evidence, not full-text access guarantees. Daily news cannot be exhaustive, and an optional search result from an unknown publisher does not independently satisfy the confidence gate.

Active plan: [IMPLEMENTATION-family-news.md](plans/IMPLEMENTATION-family-news.md). Progress: [CURRENT_PROGRESS.md](plans/CURRENT_PROGRESS.md). Architecture history is retained in `plans/INITIAL.md` and M1–M6.

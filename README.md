# anything-interesting

A Cloudflare-hosted news alerting agent. It ingests headlines from major RSS outlets every hour, clusters and scores them with Workers AI (and Polymarket signals where relevant), then surfaces the best stories in three places:

- **Scheduled Discord digests** at 05:00, 15:00, and 18:00 America/Chicago
- **On-demand `/topnews`** in Discord (slash command)
- **A public read-only web UI** — front page, cluster detail, and digest archive

The design goal is **high precision over recall**: a quiet channel is preferable to a noisy one. Clusters need strong multi-outlet coverage (with source-weight feedback over time) and a final AI judgment score before they qualify for a digest.

## How it works

```
Hourly cron (every :00 UTC)
  ├─ Refresh Polymarket watchlist (~daily)
  ├─ Poll Discord reactions → adjust source weights
  ├─ Ingest RSS → dedupe → embed → cluster → score
  ├─ Snapshot markets + market-driven candidates
  └─ At Chicago hours 5, 15, 18 → post digest to Discord webhook

Discord POST /interactions  →  /topnews (deferred reply)
GET /api/*                  →  JSON for the SPA
Everything else             →  Vite-built React app
```

**Stack:** one Cloudflare Worker (TypeScript), D1, KV, two Vectorize indexes (`headlines`, `markets`), Workers AI (optionally via AI Gateway), plus a Vite + React SPA served from the same Worker.

## Prerequisites

- Node.js 20+ and npm
- A [Cloudflare](https://dash.cloudflare.com/) account with Workers Paid recommended (D1 volume + Workers AI)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (included as a dev dependency)
- For Discord: a bot application, webhook URL for digests, and (for full features) bot token + application public key
- Vectorize indexes (one-time): `headlines` and `markets`, 1024 dimensions, cosine metric — see [Deploy](#deploy)

## Quick start (local)

```bash
git clone <repo-url>
cd anything-interesting
npm install

# Apply D1 migrations to the local database
npm run db:local

# Dev server: SPA with HMR + Worker routes (/api/*, /interactions, /health)
npm run dev
```

Open the URL Vite prints (typically `http://localhost:5173`). API routes hit the same Worker runtime as production, backed by local D1 in `.wrangler/state/`.

**Production-shaped local preview** (built assets + workerd):

```bash
npm run build
npm run preview
```

**Trigger the hourly pipeline locally** (ingest + scoring + digest gate; can take many minutes):

```bash
# After `npm run build`, with preview or wrangler dev on loopback:
curl http://127.0.0.1:8787/__scheduled
```

Returns `202` immediately; work continues in the background. Watch the terminal for `ingest done` and related logs.

**Reset local D1** (wipe articles, clusters, etc.):

```bash
npm run db:reset-local
```

## Scripts

| Command | Purpose |
| ------- | ------- |
| `npm run dev` | Vite dev + Cloudflare plugin (SPA + Worker) |
| `npm run build` | Production build → `dist/client/` + `dist/anything_interesting/` |
| `npm run preview` | Serve the production build locally |
| `npm run deploy` | Build and deploy Worker + assets |
| `npm run check` | Typecheck Worker and web app |
| `npm test` | Vitest unit tests |
| `npm run db:local` | Apply D1 migrations locally |
| `npm run db:remote` | Apply D1 migrations to production D1 |
| `npm run db:reset-local` | Truncate local D1 tables (dev only) |
| `npm run discord:register-topnews` | Register `/topnews` with Discord (uses `.env`) |

## Deploy

1. Create Cloudflare resources (if not already provisioned):
   - D1 database `anything-interesting` (binding `DB` in `wrangler.toml`)
   - KV namespace for `CONFIG`
   - Vectorize: `npx wrangler vectorize create headlines --dimensions=1024 --metric=cosine`
   - Vectorize: `npx wrangler vectorize create markets --dimensions=1024 --metric=cosine`
2. Apply migrations: `npm run db:remote`
3. Set secrets and vars (see [Configuration](#configuration))
4. Deploy: `npm run deploy`

The Vite plugin emits `dist/anything_interesting/wrangler.json` with the asset directory filled in; deploy uses that output config, not the root `wrangler.toml` alone.

**Health check:** `GET /health` → `{ "ok": true, "service": "anything-interesting" }`

## Configuration

### Wrangler secrets

| Secret | Used for |
| ------ | -------- |
| `DISCORD_WEBHOOK_URL` | Scheduled digest posts |
| `DISCORD_PUBLIC_KEY` | Verify Discord interaction signatures (`POST /interactions`) |
| `DISCORD_BOT_TOKEN` | Poll 👍/👎 on digest messages to update source weights (optional but recommended for M5) |

```bash
npx wrangler secret put DISCORD_WEBHOOK_URL
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
```

The **bot token is not stored in the Worker** for slash-command registration — that runs once from your machine (below).

### Wrangler vars (`wrangler.toml` or dashboard)

| Var | Purpose |
| --- | ------- |
| `DISCORD_APPLICATION_ID` | Discord app ID (public; same as Developer Portal → General Information) |
| `PUBLIC_SITE_URL` | Origin for digest embed links to `/cluster/:id` |
| `AI_GATEWAY_ID` | Route Workers AI through AI Gateway (optional) |
| `JUDGMENT_MODEL` | Override final judgment model slug (optional) |

### Local `.env` (gitignored)

Copy `.env.example` → `.env` for operator scripts only (`DISCORD_APPLICATION_ID` should match `wrangler.toml`):

```bash
DISCORD_APPLICATION_ID=...
DISCORD_BOT_TOKEN=...
```

Then register the slash command:

```bash
npm run discord:register-topnews
```

In the Discord Developer Portal, set **Interactions Endpoint URL** to `https://<your-worker-host>/interactions`, install the bot to your server, and grant channel access where digests are posted.

Never commit `.env` or paste tokens into the repo or issues.

## Web UI

Routes (client-side):

| Path | Page |
| ---- | ---- |
| `/` | Front page — lede, above/below the fold, topic filters |
| `/cluster/:id` | Cluster detail — scores, articles, Polymarket card, LLM reasoning |
| `/archive` | Past digests |

Read-only JSON API (same Worker):

| Endpoint | Description |
| -------- | ----------- |
| `GET /api/topnews` | Ranked clusters (`?topic=`, `?count=`, `?window_hours=`) |
| `GET /api/clusters/:id` | Single cluster |
| `GET /api/digests` | Recent digest posts |
| `GET /api/stats` | Aggregate stats |
| `GET /api/stats/kimi` | Kimi judgment usage / budget |

Responses are cached briefly (`Cache-Control: public, max-age=60`).

## News sources

RSS feeds are defined in `src/sources.ts` (Guardian, BBC, NPR, Foreign Policy, War on the Rocks, Ars Technica, The Verge, Al Jazeera, DW, Politico sections, and others). Feeds that block Cloudflare egress may be swapped; see `plans/CURRENT_PROGRESS.md` for operational notes.

## Project layout

```
src/           Worker: ingest, scoring, digest, Discord, API, Polymarket
web/           React SPA (Vite root)
migrations/    D1 SQL migrations
scripts/       Operator utilities (e.g. Discord command registration)
plans/         Architecture, milestones, and agent progress (INITIAL.md, MILESTONE-*.md)
test/          Vitest unit tests
wrangler.toml  Worker bindings, cron, assets config (source of truth for dev)
```

For full architecture, model choices, scoring rules, and milestone history, see [`plans/INITIAL.md`](plans/INITIAL.md) and [`plans/CURRENT_PROGRESS.md`](plans/CURRENT_PROGRESS.md).

## Testing

```bash
npm test          # run once
npm run test:watch
npm run check     # TypeScript (Worker + web)
```

## License

ISC

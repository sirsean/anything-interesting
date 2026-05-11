# Milestone 6 — Public newspaper UI + read-only API

**Goal:** Stand up a public, read-only web UI for the analyzed cluster pool — the same data the digest pulls from, including sub-threshold items with their interestingness score. Built with Vite + React, served by the existing Cloudflare Worker via `@cloudflare/vite-plugin`. Visual style is a clean, classic, midcentury-modernist newspaper.

**Depends on:** `MILESTONE-05-feedback-source-weighting.md` (and everything before). No new ingest, scoring, or LLM behavior — UI is a read-only window onto state already produced by M1–M5.

**References:** `INITIAL.md` → *Architecture*, *Scoring Pipeline*, *State / Storage*, *On-Demand `/topnews`* (status-badge logic mirrored here); `src/interactions.ts` `digestEligible` / `statusLine`; `src/digest.ts` candidate selection; `src/source_weights.ts` weighted coverage SQL.

---

## Deliverables

- [x] **Vite + React scaffold** under `web/` (`web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles/`). Single `vite.config.ts` at repo root with `@vitejs/plugin-react` + `@cloudflare/vite-plugin`. SPA routes via `react-router-dom`.
- [x] **Single Worker, two surfaces:** `wrangler.toml` adds `[assets] not_found_handling = "single-page-application"` and `run_worker_first = ["/api/*", "/health", "/interactions"]`; `main = "src/index.ts"` unchanged. Cron, `/health`, and `/interactions` paths untouched at runtime.
- [x] **Read-only API** in `src/api.ts` (`GET` only, public, `Cache-Control: public, max-age=60`):
  - `/api/topnews?count=&topic=&window=` — homepage feed: cluster row + top article + score breakdown + Polymarket info + sources + digest status (`eligible`, `posted_digest_id`, `posted_at`, `status_label`).
  - `/api/clusters/:id` — detail: full `articles[]` and parsed `llm_reasoning` from `llm_reasoning_log`.
  - `/api/digests?limit=` — past digests via `posts` + cluster join for the archive page.
  - `/api/stats` — masthead numbers: articles last 24h, distinct sources, clusters above threshold, last digest at, polymarket-matched count.
  - Shared eligibility / status-label logic moved into `src/digest_status.ts` and reused by both `src/interactions.ts` and `src/api.ts` so the UI never disagrees with `/topnews` or the digest gate.
- [x] **Frontend routes**:
  - `/` — newspaper front page: masthead, lede, above-the-fold (4 stories, 2 cols), below-the-fold dense grid with sub-threshold clusters, interestingness meter, status pill. Topic filter chips (All / Geopolitics / Politics / Economics / Technology). 📈 prefix on market-driven items.
  - `/cluster/:id` — full story: every article with source + link, score breakdown, Polymarket card, parsed Kimi reasoning, distinct-outlet count, weighted coverage.
  - `/archive` — recent digests (last 30) via `/api/digests`.
- [x] **Midcentury-modern newspaper design**: cream paper background, ink black, rust + mustard + dusty teal accents; display serif (Playfair Display) for masthead + ledes, body serif (Source Serif 4), tight uppercase sans (Inter Tight) for kickers/metadata, mono (JetBrains Mono) for numerics; 1px hairlines, double-rule under masthead, small-caps section labels. Plain CSS in `web/src/styles/{tokens,base}.css`. Subtle paper-grain dot pattern via radial-gradient.
- [x] **Dev loop**: `npm run dev` runs Vite + workerd via `@cloudflare/vite-plugin` (HMR for SPA, real Worker for `/api/*` and `/interactions`). `npm run build` emits `dist/client/` + `dist/anything_interesting/`. `npm run preview` runs the build through workerd. `npm run deploy` does `vite build && wrangler deploy -c dist/anything_interesting/wrangler.json`.
- [x] **Tests**: 81 vitest tests pass (was 58 + 23 new): `digest_status` parity with the digest gate (eligibility states + status-label slot mapping), `api` routing + clamping + happy-path stats / topnews / digests / cluster-not-found, plus `parseLlmReasoning` shape tolerance.
- [x] **Docs**: this file + M6 row in `CURRENT_PROGRESS.md`. Removed "Web UI" from `INITIAL.md` non-goals with a one-line acknowledgment of the read-only dashboard.

---

## Acceptance criteria

- [x] `vite build` succeeds. `wrangler deploy -c dist/anything_interesting/wrangler.json --dry-run` reports SPA + Worker upload (~52 KiB gz) with all five existing bindings (`DB`, `CONFIG`, `HEADLINES`, `MARKETS`, `AI`).
- [x] `npm run preview` serves `/` as the SPA index.html (200), `/health` as Worker JSON (200), arbitrary client-side paths as the SPA index.html (200, via `not_found_handling`), and routes `/api/*` to the Worker (500s locally with "no such table: clusters" since local D1 is empty in this WSL workspace; production has the schema applied through M5).
- [x] Status labels on the UI route through the same `digestStatusLabel` helper used by `/topnews`; covered by `test/digest_status.test.ts` parity tests.
- [x] `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.web.json` clean.
- [x] Existing vitest suite green (81/81), including the M1–M5 surface tests that exercise the cron / Discord paths.
- [ ] **Operator smoke after deploy:** `GET https://anything-interesting.sirsean.workers.dev/api/stats` → JSON; `GET /` → newspaper page; existing cron still posting (M5 cron smoke is the open item from prior milestones, unchanged here).

## Operator wiring

- [x] No new D1 migrations; no new bindings; no new secrets.
- [ ] **Deploy:** `npm run deploy`. After the first deploy, browse the Worker URL and confirm both `/` (SPA) and `/api/stats` (JSON) respond.

---

## Agent notes

- The Cloudflare Vite plugin emits `dist/client/` (SPA) and `dist/<worker-name>/` (Worker bundle + output `wrangler.json`). `wrangler deploy` (without args) consumes the output `wrangler.json` directly; do not hand-edit it.
- `not_found_handling = "single-page-application"` falls back to `index.html` for SPA routes; combined with `run_worker_first = ["/api/*"]` the Worker handles all API paths and the SPA owns everything else.
- We must flip `package.json` to `"type": "module"` for Vite. `scripts/register-topnews.mjs` is already `.mjs` so it stays compatible. Worker code is already TS + ES module syntax; only the runtime classification changes.
- Status-label logic lives in `src/interactions.ts::statusLine`; in M6 it gets lifted into a small shared helper in `src/api.ts` (or a new `src/digest_status.ts`) so both `/topnews` and the new API stay consistent.

## Out of scope for M6

- Authentication, write paths from the UI, manual cluster overrides.
- Re-running scoring or LLM from the UI.
- Server-side rendering, PWA, offline mode.
- Multi-tenant / per-user feeds.

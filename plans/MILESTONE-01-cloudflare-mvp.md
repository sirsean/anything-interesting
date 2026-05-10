# Milestone 1 — Cloudflare MVP

**Goal:** Ship a minimal end-to-end pipeline on Cloudflare: hourly ingest from a few RSS feeds, naive clustering, digest posting to Discord at Chicago gate times, no Workers AI yet.

**Depends on:** Nothing (project bootstrap).

**References:** Full architecture and schema live in `INITIAL.md` (sections *Architecture*, *Hosting & Stack*, *Digest Delivery*, *State / Storage*, *Implementation Phases → Phase 1*).

---

## Deliverables

- [x] `wrangler init` TypeScript Worker; `wrangler.toml` with D1 + KV (`Vectorize` binding deferred until M2: create index + grant token Vectorize, then add `[[vectorize]]` — see `CURRENT_PROGRESS.md`).
- [x] D1 schema migration aligned with MVP needs: at minimum `articles`, `clusters`, and fields needed for digest selection (`final_score` can be a simple proxy or placeholder until M2).
- [x] Hourly cron in `wrangler.toml` (`0 * * * *`); `scheduled()` entry runs ingest every hour.
- [x] RSS fetcher for **three** starter sources: Reuters, AP, BBC (URLs in `INITIAL.md` → *Data Sources → News*).
- [x] URL-hash dedup before insert.
- [x] **Naive clustering:** substring / token overlap on titles (no embeddings yet).
- [x] Digest delivery gated on **America/Chicago** local hour ∈ `{5, 15, 18}` using the `Intl.DateTimeFormat` pattern from `INITIAL.md` (*Cadence*).
- [x] Discord **webhook** poster: single message, threshold **≥3 distinct sources** within **12h** for a cluster to be digest-eligible (per Phase 1 spec).
- [ ] Manual or logged verification plan for **first digest at 05:00 CT** (document how you verified in `CURRENT_PROGRESS.md`).

---

## Acceptance criteria

- Hourly `scheduled()` runs without error in dev and deploy.
- At digest hours (CT), eligible clusters post to the webhook channel; at other hours, no digest spam.
- Ineligible days/channels stay quiet (precision-first).

---

## Agent notes

- Same Worker will later add `fetch()` for Discord interactions—keep routing structure ready.
- DST: hourly UTC cron + local hour string check; test Mar/Nov transitions before calling M1 “done” if feasible.
- Vectorize writes may lag; MVP dedup should rely on D1 URL hash as source of truth.

---

## Out of scope for M1

- Workers AI, BGE, Kimi, real cosine clustering.
- Polymarket, slash commands, signature verification.
- Topical weights and 0.60 `final_score` formula (can use simple counts until M2).

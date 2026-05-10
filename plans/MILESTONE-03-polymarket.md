# Milestone 3 — Polymarket integration

**Goal:** Wire Gamma + CLOB, auto watchlist with category filter and Kimi disambiguation, market embeddings, Strategy A (news → markets) and Strategy B (markets → news) signals feeding the same candidate pool and digests.

**Depends on:** `MILESTONE-02-workers-ai-scoring.md` complete (judgment + scores stable).

**References:** `INITIAL.md` → *Polymarket*, *Polymarket Surprise Signal*, *Scoring Pipeline*, *Data Sources → Polymarket*, *State / Storage* (`markets`, `market_snapshots`), Phase 3.

---

## Deliverables

- [x] **Gamma API** client: active markets, sort by 24h volume (`src/polymarket.ts`); shapes verified against `https://docs.polymarket.com` 2026-05.
- [x] **CLOB API** client: 24h history via `/prices-history` (used as fallback for 24h-ago price); YES probability + single-market lookup come from Gamma `/markets?slug=`.
- [x] **Daily watchlist job:** top **50** by 24h volume, KV-cursor gated to refresh once every ~23h; deterministic category filter + Kimi K2.6 keep/drop on ambiguous rows (`src/watchlist.ts`).
- [x] Watchlist persisted in **KV** (`watchlist:current`, 26h TTL) and embeddings in Vectorize `markets`; `markets` table in D1 with `vec_id`, `yes_token_id`, `last_seen_in_watchlist`.
- [x] **Hourly snapshots:** `market_snapshots` rows + 14d retention prune (`src/snapshots.ts`).
- [x] **Strategy A (news → markets):** rep-title embed → Vectorize top-10 → Kimi rerank when top similarity ≥ 0.70 → surprise = scaled `|Δprice|` + near-50% bonus, written into `clusters.surprise_score` and the polymarket fields (`src/match_markets.ts`, `src/scoring.ts`).
- [x] **Strategy B (markets → news):** snapshot diff vs ~24h prior; flag `>4%` absolute or `>25%` relative moves; keyword article search (24h); Kimi explainer; `flow_type='market_driven'` cluster with **📈** prefix in digest title.
- [x] Digest embeds carry the Polymarket field (linked title + price + 24h delta) and a `news-driven` vs `market-driven` footer flavor; `/topnews` surface lands in M4.

---

## Acceptance criteria

- Matched markets influence `surprise_score` / candidacy per pipeline doc.
- Market-driven items appear in pool with correct prefix and footer/metadata distinction (`news-driven` vs market-driven).
- API failures degrade gracefully (no Worker crash; logged; ingest continues).

---

## Agent notes

- Re-read Polymarket endpoints before implementation; APIs change.
- Watchlist + embeddings should stay deterministic where possible to control cost; Kimi only on ambiguous categories and rerank steps.

---

## Out of scope for M3

- New slash commands beyond what M4 specifies.
- Reaction feedback loop (M5).
- Anthropic escape hatch (optional note in M5 / INITIAL only).

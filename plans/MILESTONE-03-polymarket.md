# Milestone 3 — Polymarket integration

**Goal:** Wire Gamma + CLOB, auto watchlist with category filter and Kimi disambiguation, market embeddings, Strategy A (news → markets) and Strategy B (markets → news) signals feeding the same candidate pool and digests.

**Depends on:** `MILESTONE-02-workers-ai-scoring.md` complete (judgment + scores stable).

**References:** `INITIAL.md` → *Polymarket*, *Polymarket Surprise Signal*, *Scoring Pipeline*, *Data Sources → Polymarket*, *State / Storage* (`markets`, `market_snapshots`), Phase 3.

---

## Deliverables

- [ ] **Gamma API** client: active markets, sort by 24h volume; verify shapes against `https://docs.polymarket.com`.
- [ ] **CLOB API** client: YES probability, 24h history, single-market by slug as needed.
- [ ] **Daily / hourly watchlist job:** top **50** by 24h volume; deterministic category filter (drop sports, pop culture, entertainment; keep elections, geopolitics, economics, policy, tech, science); ambiguous rows → **Kimi K2.6** keep/drop.
- [ ] Persist watchlist in **KV** (24h TTL) and embeddings in **Vectorize** `markets` index; `markets` table in D1 with `vec_id`, `last_seen_in_watchlist`.
- [ ] **Hourly snapshots:** `market_snapshots` with 14d retention policy.
- [ ] **Strategy A (news → markets):** embed rep headline + summary; Vectorize top-10; if best similarity > 0.70, Kimi rerank to 0–2 markets; compute surprise `|price_now - price_24h_ago|` with scaling + near-50% bonus per spec.
- [ ] **Strategy B (markets → news):** compare watchlist prices to prior snapshot; flag **>4% absolute** or **>25% relative** move; keyword search articles (24h); Kimi “what likely happened”; `flow_type = market_driven`; **📈** prefix in embed title path.
- [ ] Digest and `/topnews` surfaces (when M4 exists) show Polymarket field per embed JSON example in `INITIAL.md`.

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

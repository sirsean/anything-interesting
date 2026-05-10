# Milestone 2 — Workers AI scoring

**Goal:** Replace naive clustering with embeddings + cosine similarity, add GLM rerank on close calls, Kimi judgment for interestingness, GLM summaries in embeds, topical weighting, and digest rules (0.60 threshold, hard cap 3).

**Depends on:** `MILESTONE-01-cloudflare-mvp.md` complete.

**References:** `INITIAL.md` → *Workers AI Model Choices*, *Scoring Pipeline*, *Digest Delivery*, *LLM vs Deterministic Boundary*, *State / Storage*, Phase 2.

---

## Deliverables

- [ ] `env.AI` binding with **AI Gateway** in front; all model calls go through a single wrapper (e.g. `runLLM(env, task, prompt)`) per *Notes for the Coding Agent*.
- [ ] **Embeddings:** `@cf/baai/bge-large-en-v1.5` → Vectorize `headlines` index + link `vec_id` on `articles` in D1.
- [ ] **Clustering:** nearest-neighbor vs ~7d headline corpus; cosine **> 0.82** same cluster; **0.78–0.82** band → `@cf/zai/glm-4-7-flash` rerank.
- [ ] **Candidacy gate** before expensive judgment: `source_weight_sum ≥ 3.0` OR strong Polymarket placeholder hook (Polymarket wiring in M3—gate logic can branch on “has match” once data exists).
- [ ] **Judgment:** `@cf/moonshotai/kimi-k2-6` (or approved alternate) for final interestingness; log reasoning to `llm_reasoning_log` / cluster row; re-run when signals change materially.
- [ ] **Scoring formula** per `INITIAL.md`: `final_score = topical_weight * (0.10*coverage + 0.15*novelty + 0.30*surprise + 0.45*llm)` with topical multipliers (Geopolitics 0.40, others 0.20 each).
- [ ] **Summaries:** `@cf/zai/glm-4-7-flash` for 1–2 sentence article/cluster descriptions in Discord embeds.
- [ ] **Digest selection:** `final_score ≥ 0.60`, `posted` false, grace window vs `last_digest`; **top 3**, allow **4** only for exceptional score; verify model slugs against current Cloudflare docs before shipping.

---

## Acceptance criteria

- LLM daily budget stays in intended band (~10–20 judgments/day under normal news load; document assumptions).
- Digests use real scores and caps; quiet when nothing clears bar.
- `runLLM` (or equivalent) is the only path to Workers AI for easy model swaps.

---

## Agent notes

- Verify model IDs at `https://developers.cloudflare.com/workers-ai/models/` before wiring.
- Vectorize eventual consistency: same-run dedup still checks D1 by `url_hash`.
- Polymarket-driven `surprise_score` may stay 0 or stubbed until M3—document behavior in code comments if so.

---

## Out of scope for M2

- Gamma/CLOB/watchlist, market embeddings index population (M3).
- Slash command / ed25519 (M4).
- Reaction-driven source weights (M5).

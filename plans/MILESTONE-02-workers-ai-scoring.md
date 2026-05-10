# Milestone 2 — Workers AI scoring

**Goal:** Replace naive clustering with embeddings + cosine similarity, add GLM rerank on close calls, Kimi judgment for interestingness, GLM summaries in embeds, topical weighting, and digest rules (0.60 threshold, hard cap 3).

**Depends on:** `MILESTONE-01-cloudflare-mvp.md` complete.

**References:** `INITIAL.md` → *Workers AI Model Choices*, *Scoring Pipeline*, *Digest Delivery*, *LLM vs Deterministic Boundary*, *State / Storage*, Phase 2.

---

## Deliverables

- [x] `env.AI` binding; **AI Gateway** optional via `AI_GATEWAY_ID` (`gateway: { id }` on each call). All Workers AI usage goes through `src/llm.ts` (`runLLM`, `runEmbed`) per *Notes for the Coding Agent*.
- [x] **Embeddings:** `@cf/baai/bge-large-en-v1.5` → Vectorize `headlines` index + `articles.vec_id` (stable id = `url_hash`) in D1.
- [x] **Clustering:** nearest-neighbor vs ~7d headline corpus (metadata `ts` post-filter); cosine **> 0.82** same cluster; **0.78–0.82** band → `@cf/zai-org/glm-4.7-flash` rerank (Workers AI slug as of 2026-05 docs).
- [x] **Candidacy gate** before expensive judgment: `source_weight_sum` / distinct sources **≥ 3** (equal weights in M2); Polymarket “strong match” branch stubbed until M3.
- [x] **Judgment:** `@cf/moonshotai/kimi-k2.6` for final interestingness; reasoning JSON in `llm_reasoning_log`; re-run when distinct source count increases (broader “material signals” + Polymarket in M3).
- [x] **Scoring formula** per `INITIAL.md`: `final_score = topical_weight * (0.10*coverage + 0.15*novelty + 0.30*surprise + 0.45*llm)` with topical multipliers (`src/topic.ts`). `surprise_score` forced to **0** until M3 (stub documented in `src/scoring.ts`).
- [x] **Summaries:** `@cf/zai-org/glm-4.7-flash` for 1–2 sentence Discord embed descriptions (`src/digest.ts`).
- [x] **Digest selection:** `final_score ≥ 0.60`, `posted_digest_id` null, grace vs `cursors:last_digest_at`, **top 3**, fourth embed only if score **≥ 0.88**; model slugs verified against Cloudflare Workers AI docs before ship.

---

## Acceptance criteria

- [x] LLM daily budget: Kimi calls capped via KV (`llm:kimi_count:YYYY-MM-DD`, cap **22**/day) with inline comment in `src/scoring.ts` (~10–20 target under normal load).
- [x] Digests use scored pool + caps; quiet when nothing clears the bar (`src/digest.ts`).
- [x] `runLLM` / `runEmbed` are the only paths to `env.AI.run` for chat/embeddings in app code (`src/llm.ts`).

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

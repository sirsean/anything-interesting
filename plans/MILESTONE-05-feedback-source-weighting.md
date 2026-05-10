# Milestone 5 — Feedback loop and dynamic source weighting

**Goal:** Capture user reactions on Discord posts, persist to `feedback`, adjust per-source weights with clamping and Bayesian smoothing, feed weights back into `source_weight_sum`; optional prompt refinement and Anthropic judgment swap if precision plateaus.

**Depends on:** `MILESTONE-04-discord-slash-topnews.md` (or digest-only path if reactions attach to webhook messages—design choice documented in progress file).

**References:** `INITIAL.md` → *Phase 5*, `source_weights` table, scoring pipeline *source count (weighted by source weights)*, *Resolved Decisions*, *Non-goals* (stay single-channel).

---

## Deliverables

- [x] **Reaction capture:** REST poll (no Gateway) with optional `DISCORD_BOT_TOKEN`; digest posts **one webhook message per cluster** so each `message_id` maps to a single `cluster_id`. Tradeoff vs single multi-embed message: slightly more channel noise; enables per-story reactions without message components.
- [x] **D1 `feedback`:** insert rows `(message_id, cluster_id, user_id, reaction, ts)` with dedupe `UNIQUE(message_id, user_id, reaction)`.
- [x] **Weight updates** per formula in `INITIAL.md`:
  - `weight_new = weight_old + (👍 ? +0.02 : -0.02)`; clamp `[0.5, 1.5]`.
  - Bayesian smoothing toward 1.0 when counts low: `effective_weight = (1-α)*1.0 + α*weight_new`, `α = min(1, (pos_count+neg_count)/20)`.
- [x] **`source_weights` table** maintained; scoring + digest gates use effective weights in `source_weight_sum` / weighted coverage (see `source_weights.ts`, `scoring.ts`, `digest.ts`).
- [x] **Operational loop:** query `feedback` JOIN `posts` / `post_cluster_messages` for 👎 on posted clusters (false positives); cross-check `clusters` where `final_score` is low but reactions positive (false negatives); use `llm_reasoning_log` text for prompt tweaks — manual periodic review (documented here; automation optional).
- [x] **Optional judgment swap:** `JUDGMENT_MODEL` worker var (and AI Gateway) to point `runLLM` at another Workers AI slug; Anthropic Sonnet via Gateway remains a one-line model change when CF exposes a compatible id.

---

## Acceptance criteria

- Reactions measurably change downstream scores after N ingests (document test scenario).
- Weights remain bounded; no single user can dominate without repeated signal (consider rate limits / dedup if needed—document).

---

## Agent notes

- Webhook-posted digests may need a follow-up “bot” message or event subscription to attach reactions to `cluster_id`—resolve explicitly before coding.
- Stay within **non-goals:** no multi-tenant or web UI.

---

## Out of scope for M5

- Multi-user / multi-channel productization.
- Polymarket trading or new markets of unrelated scope.

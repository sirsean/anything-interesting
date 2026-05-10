# Milestone 5 — Feedback loop and dynamic source weighting

**Goal:** Capture user reactions on Discord posts, persist to `feedback`, adjust per-source weights with clamping and Bayesian smoothing, feed weights back into `source_weight_sum`; optional prompt refinement and Anthropic judgment swap if precision plateaus.

**Depends on:** `MILESTONE-04-discord-slash-topnews.md` (or digest-only path if reactions attach to webhook messages—design choice documented in progress file).

**References:** `INITIAL.md` → *Phase 5*, `source_weights` table, scoring pipeline *source count (weighted by source weights)*, *Resolved Decisions*, *Non-goals* (stay single-channel).

---

## Deliverables

- [ ] **Reaction capture:** extend bot or add pathway (Message Components vs webhook events—pick one, document tradeoffs) so 👍/👎 (or chosen emoji set) maps to `cluster_id` + contributing `source`(s).
- [ ] **D1 `feedback`:** insert rows `(message_id, cluster_id, user_id, reaction, ts)`.
- [ ] **Weight updates** per formula in `INITIAL.md`:
  - `weight_new = weight_old + (👍 ? +0.02 : -0.02)`; clamp `[0.5, 1.5]`.
  - Bayesian smoothing toward 1.0 when counts low: `effective_weight = (1-α)*1.0 + α*weight_new`, `α = min(1, (pos_count+neg_count)/20)`.
- [ ] **`source_weights` table** maintained; ingest uses effective weights in `source_weight_sum`.
- [ ] **Operational loop:** export or query `llm_reasoning_log` for false positives (👎 on posted items) and false negatives (high engagement, low score) to refine prompts periodically (process documented, automation optional).
- [ ] **Optional:** route judgment only through AI Gateway to **Anthropic Sonnet** if Workers AI precision plateaus—keep behind same `runLLM` abstraction.

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

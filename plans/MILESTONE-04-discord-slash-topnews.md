# Milestone 4 — On-demand `/topnews` (Discord interactions)

**Goal:** Same Worker serves Discord `POST` interactions: verify ed25519, PING/PONG, `/topnews` with options, query D1, respond with embeds and status badges; meet Discord’s 3s deadline (defer path if needed).

**Depends on:** `MILESTONE-02-workers-ai-scoring.md` at minimum; **recommended** after `MILESTONE-03-polymarket.md` so embeds include market context.

**References:** `INITIAL.md` → *On-Demand `/topnews`* , *Discord Output*, *Notes for the Coding Agent*, Phase 4.

---

## Deliverables

- [ ] Discord **application** + bot user created; **Interactions Endpoint URL** → Worker public URL.
- [ ] **Secrets / vars:** store Discord **public key** in Worker for signature verification; bot token used only for one-time command registration (not in hot path).
- [ ] **One-time script** (local or CI): register slash command via API:
  ```
  /topnews [count: 1-5] [topic: geopolitics|politics|economics|technology]
  ```
- [ ] Worker **`fetch()`** handler: route Discord interaction POSTs; **ed25519** verify with Web Crypto — **401** on failure.
- [ ] **PING (type 1):** respond `{ type: 1 }` so Discord validation passes.
- [ ] **APPLICATION_COMMAND (type 2):** parse `count` and optional `topic`; query D1 for clusters scored in **last 12h**, filter by topic if set, order by `final_score` DESC, limit N.
- [ ] Build **embeds** consistent with digest format; add status text per item: e.g. *in upcoming 18:00 digest* / *posted in 15:00 digest* / *below digest threshold* based on `posted` and score vs threshold.
- [ ] Reply `{ type: 4, data: { embeds: [...] } }` inline when fast enough; if not, **`type: 5`** deferred + follow-up via webhook within 15 minutes.
- [ ] Install bot to target server; document setup steps in `CURRENT_PROGRESS.md` or team runbook snippet.

---

## Acceptance criteria

- Discord’s endpoint verification succeeds (PING/PONG).
- `/topnews` returns coherent top-N with correct filters and badges.
- No bot token in Worker code or committed secrets.

---

## Agent notes

- Web Crypto ed25519 — no extra npm dependency required.
- Keep interaction routing separate from cron path for clarity and testability.

---

## Out of scope for M4

- `/why`, `/source`, `/digest now` (listed as later extensions in `INITIAL.md`).
- Reaction ingestion (M5).

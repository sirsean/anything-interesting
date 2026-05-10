# Current progress

**Project:** News Alerting Agent (Cloudflare Worker + D1 + Vectorize + KV + Discord). Full vision and decisions: `INITIAL.md`.

**Agent workflow:** Work milestones **in order** (M1 → M5). Each milestone file is a self-contained checklist. Update this file when you **start** or **finish** a milestone (date, branch, notes, blockers).

---

## Milestone index

| Order | File | Summary |
| ----- | ---- | ------- |
| M1 | [`MILESTONE-01-cloudflare-mvp.md`](MILESTONE-01-cloudflare-mvp.md) | Wrangler, D1/KV/Vectorize bindings, hourly cron, 3× RSS, dedup, naive clustering, webhook digest @ 05/15/18 CT |
| M2 | [`MILESTONE-02-workers-ai-scoring.md`](MILESTONE-02-workers-ai-scoring.md) | AI Gateway, BGE + Vectorize clustering, GLM rerank/summary, Kimi judgment, topical weights, 0.60 / cap-3 digest |
| M3 | [`MILESTONE-03-polymarket.md`](MILESTONE-03-polymarket.md) | Gamma + CLOB, watchlist, market embeddings, Strategy A + B, 📈 market-driven items |
| M4 | [`MILESTONE-04-discord-slash-topnews.md`](MILESTONE-04-discord-slash-topnews.md) | Slash `/topnews`, ed25519 verify, PING/PONG, D1 queries, embeds + status badges |
| M5 | [`MILESTONE-05-feedback-source-weighting.md`](MILESTONE-05-feedback-source-weighting.md) | Reactions → `feedback`, dynamic `source_weights`, optional prompt / provider upgrades |

---

## Status

| Milestone | State | Owner / notes |
| --------- | ----- | ------------- |
| M1 | **Not started** | — |
| M2 | Blocked on M1 | — |
| M3 | Blocked on M2 | — |
| M4 | Blocked on M2 (M3 recommended) | — |
| M5 | Blocked on M4 | — |

_Last updated: 2026-05-10 — milestone files created from INITIAL.md; implementation not begun._

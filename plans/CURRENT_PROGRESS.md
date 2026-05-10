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
| M1 | **Implementation complete; prod smoke optional** | Code matches M1 checklist (cron, D1/KV, 3× RSS, dedup, Jaccard clusters, CT digest gate, webhook + ≥3 sources / 12h). Vectorize deferred to M2. **2026-05-10:** Verified `Intl` returns padded hours (`"05"`); digest gate updated to numeric compare so 05:00 CT runs. |
| M2 | Ready to start | Depends on M1 code path (above); first real 05:00/15:00/18:00 CT digest in prod still worth one logged `wrangler tail` pass when convenient. |
| M3 | Blocked on M2 | — |
| M4 | Blocked on M2 (M3 recommended) | — |
| M5 | Blocked on M4 | — |

---

## M1 setup (operator)

1. **Discord webhook (digest):** configured (`DISCORD_WEBHOOK_URL`). To rotate: `npx wrangler secret put DISCORD_WEBHOOK_URL`.
2. **Remote D1 migrations:** already applied once; after new migration files run `npm run db:remote` (and `db:local` for dev).
3. **Deploy:** `npm run deploy` from repo root.
4. **Health:** `GET https://anything-interesting.sirsean.workers.dev/health` → JSON `{ ok: true }`.
5. **Cron:** hourly `0 * * * *` — `scheduled()` runs ingest every hour; digest runs only when America/Chicago hour is **5, 15, or 18** (see `src/chicago.ts`).

### M1 verification — first digest at 05:00 CT

- **Production:** At the top of an hour when Chicago is 05:00, 15:00, or 18:00, confirm a single webhook message with header like `05:00 CT digest — N items` (or a quiet run if no cluster has ≥3 distinct sources with `fetched_at` in the last 12h).
- **Logs:** `npx wrangler tail anything-interesting` and look for `scheduled tick Chicago hour=…`, `ingest done …`, and either `Digest: no eligible clusters` or `Digest posted post_id=…`.
- **Local / `wrangler dev`:** use `npx wrangler dev --local --test-scheduled` and open `/__scheduled`. Outbound RSS fetches require working DNS from the machine running workerd (some environments block or fail lookups).

### RSS note

Starter feeds are Reuters (`feeds.reuters.com/reuters/topNews`), BBC World, and AP (`apnews.com/index.rss`). AP may return **401** to some automated clients; if ingest logs show repeated AP failures, swap that feed URL in `src/sources.ts` for another outlet from `INITIAL.md` (same code path).

---

_Last updated: 2026-05-10 — M1 implementation verified against repo; 05:00 CT digest gate fixed (`src/chicago.ts`). Operator checklist: tail prod once at a digest hour to confirm webhook + DB updates._

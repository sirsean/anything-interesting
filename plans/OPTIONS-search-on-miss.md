# Options — Strategy B market research (Brave News → Kimi)

**Status:** Implemented (v1) — always-on Brave News + page-fetch for flagged market moves; no digest gate; research URLs persisted in `llm_reasoning_log` and shown on cluster detail.

**Decisions (2026-08-07):**
- Provider: **Brave News** (`A1`) + **page-fetch** (`D`)
- Trigger: **always** on Strategy B flagged moves (not miss-only), even when RSS hits exist
- Digest gate: **none** for v1
- Persist research URLs in cluster log + surface in UI (with Brave attribution)

See earlier shortlist below for rejected / deferred alternatives.

---

## Problem (original)

Market-driven digests often said “no identifiable news catalyst / market positioning” because Strategy B only searched our RSS corpus (`src/snapshots.ts`).

## Goal

Fetch external evidence for market-driven items, then summarize from that evidence (plus RSS when present).

**Volume envelope:** Strategy B caps at **8 Kimi calls/hour**. Research adds Brave + page fetches (I/O), not extra Kimi beyond explain.

**Pipeline (v1):**

```
flagged move
  → local keyword search + Kimi relevance filter
  → ALWAYS: Brave News (pd, else pw) + page-fetch top URLs
  → kimiExplain(RSS + research) with anti-positioning prompt
  → upsert market_driven cluster; research[] in llm_reasoning_log
```

Operator: `wrangler secret put BRAVE_SEARCH_API_KEY` (and `.dev.vars` locally).

---

## Pattern A — Search API → keep Kimi explainer *(chosen shape)*

| # | Provider | What we get | Approx cost | Fit |
|---|----------|-------------|-------------|-----|
| **A1** | **Brave News** (`/news/search`) | News-only results: title, URL, source, description, date; freshness filters | ~$5/1k; $5 free credits/mo | **Chosen** |
| **A3** | **Tavily** | Agent-oriented: ranked results + extracted content | ~$5–8/1k | Fallback if Brave snippets/fetches stay thin |
| **A4** | **Serper** | Raw Google SERP | ~$1/1k | Budget Google freshness A/B |

## Pattern B — Model-native web search (deferred)

Anthropic / OpenAI / Perplexity via AI Gateway — left for later if A1 quality plateaus.

## Pattern D — Search + page fetch *(chosen)*

Fetch top 1–3 research URLs; on failure keep Brave snippet.

---

## Open / follow-ups

- Digest gate when research finds nothing concrete (explicitly deferred)
- Optional Tavily / Brave LLM Context if page-fetch success rate is low
- Discord embed field listing research links (UI only for v1)

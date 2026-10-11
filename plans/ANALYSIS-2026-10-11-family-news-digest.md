# Analysis and proposed direction — useful news for family conversation

**Date:** 2026-10-11. **Status:** Analysis complete; runtime changes are proposals, not implemented or approved decisions. This document records the user's current goal; `INITIAL.md` and M1–M6 describe the older implementation.

The desired outcome is a small, trustworthy, varied set of answers to “Did anything interesting happen today?” that a parent can discuss at dinner or in the car. The existing application is built around high-precision geopolitical and prediction-market alerts. Its current output follows that older specification reasonably closely, but the specification is a poor fit for this goal. Broader inputs, evidence-based editorial judgment, and selection of a coherent daily edition matter more than a model replacement alone.

## Evidence and scope

Reviewed all existing plans, Worker configuration, ingestion, RSS parsing, embeddings/clustering, scoring, market research and watchlist paths, digest delivery, Discord interactions/reactions, D1 migrations, public API, newspaper pages, and relevant tests. Read public production APIs without invoking cron, AI, operations endpoints, or Discord writes. Probed public RSS feeds from the review host; those results do not establish availability from a Cloudflare Worker.

Production snapshot around **2026-10-11 11:23 America/Chicago**:

| Observation | Result |
| --- | --- |
| Articles first ingested in the last 24 hours | 187 |
| Distinct source labels first ingested in the last 24 hours | 7 |
| Last 20 archived digests | 44 items: 33 market-driven, 11 news-driven (75% market-driven) |
| Last 50 archived digests, September 15–October 11 | 90 items: 54 market-driven, 36 news-driven (60% market-driven) |
| Topics assigned to those 90 items | 27 geopolitics, 26 politics, 33 general, 4 economics, 0 technology |
| October 5, 05:00 CT edition | All four items were Brazilian election contracts; three concerned the same presidential first-round result |
| Existing validation | 145 tests across 24 files pass; Worker and web TypeScript checks pass |

Public evidence endpoints: [stats](https://anything-interesting.sirsean.workers.dev/api/stats), [latest digests](https://anything-interesting.sirsean.workers.dev/api/digests?limit=50), [current pool](https://anything-interesting.sirsean.workers.dev/api/topnews?count=50&window=168). These endpoints change over time. Classification as `general` hides science, health, culture, and other subjects; it does not establish their complete absence. The archive joins mutable cluster rows, so current scores are not necessarily the scores at delivery. Production logs, D1-wide source distributions, and Cloudflare billing were not audited.

All 12 configured feeds returned parseable feeds from the review host. The Politico economy feed's newest publication was **September 6**, despite HTTP 200 on October 11. Some other feeds publish less often or were outside the 24-hour window. Seven active labels do not imply five broken feeds. HTTP success is insufficient for source-health monitoring.

## What the application currently does

The same Cloudflare Worker serves the React/Vite newspaper, public JSON API, signed Discord interactions, and an hourly cron. D1 stores articles, clusters, market snapshots, post membership, and feedback. KV stores watchlist state, cursors, and judgment counts. Workers AI BGE embeddings feed two 1024-dimensional Vectorize indexes. Kimi supplies judgment and market intelligence; GLM supplies digest copy and optional clustering decisions.

Each tick refreshes the market watchlist when due, polls Discord reactions, fetches RSS, ingests new URLs one by one, and scores affected clusters. It then snapshots markets and creates market-driven candidates. Digests run at 05:00, 15:00, and 18:00 Chicago time. `/topnews` and the newspaper show the same score-ranked pool. A useful skeleton exists: storage, deployment, delivery, source links, and a browseable UI need extension, not wholesale replacement.

## Why the output is skewed

**1. The editorial assignment is wrong for the new goal.** `src/scoring.ts` explicitly asks for a “precision-first geopolitics/politics/econ/tech digest.” Neither prompts nor topic filters ask about family relevance, curiosity, discoveries, explainability, or conversation value. Live judgments reject human-interest relevance and describe a tech item as better suited to a tech newsletter than a geopolitics digest. `src/topic.ts`, `src/api.ts`, Discord command options, and `TopicNav.tsx` only recognize the original four subjects plus an uncategorized fallback.

The original plan's 0.20–0.40 topical multipliers were fixed in May; current multipliers are 0.98–1.04. The old multiplicative threshold bug is not the current explanation. The stronger biases are inputs, prompts, candidacy, and unequal market treatment.

**2. Twelve feeds provide ten publishers and a narrow editorial diet.** `src/sources.ts` includes Guardian World, BBC World, NPR general news, Foreign Policy, War on the Rocks, Al Jazeera, DW World, three Politico sections, Ars, and The Verge. There are no dedicated feeds for discovery, space, nature, history, arts, sport, or local news. Reuters/AP were removed after Worker fetch problems. HN, Reddit, and other JSON discovery inputs in the original plan were never implemented. More world-politics feeds would increase article volume without fixing the diet.

The three Politico section labels count as three distinct sources in coverage and feedback. Feed identity must be separated from publisher identity. Syndicated copies of one report also should not be treated as independent verification.

**3. Ordinary news and market candidates have different eligibility rules.** News judgment generally requires weighted coverage of 3.0 unless there is a market match. News delivery still requires coverage of 3.0 from articles fetched within 12 hours. A strong single-outlet science report cannot reach the main digest merely by being useful or well sourced. Market-driven candidates bypass the source gate entirely.

The current news formula is `topic × (0.15 coverage + 0.25 novelty + 0.60 judgment)`. Market-driven formula is `topic × (0.10 coverage + 0.15 novelty + 0.30 market surprise + 0.45 judgment)`, with novelty always 1. Market coverage counts article/search-result quantities rather than validated independent publishers. The two formulas do not define comparable utility scores.

Even with zero evidence coverage and model score 0.40, a geopolitical market with saturated movement surprise scores **0.6552**, above the 0.60 delivery floor. Evidence sufficiency must be a separate eligibility condition. A model-generated low score cannot reliably compensate for an additive movement bonus.

**4. Markets receive better research than ordinary news.** Brave News search and page fetches run for flagged market movements, while normal news judgment sees one representative headline and numeric signals. Normal Discord summaries receive two headline strings and a URL string; the URL is not fetched. The application's stated intention to read the news is only implemented for the market research path. Ordinary story explanations cannot reliably convey what happened, why it matters, or what remains uncertain with this evidence.

**5. Selection picks high scores without considering the edition.** `pickDigestRows` takes the first three candidates, or four when the fourth clears 0.88. There is no cross-cluster event deduplication, variety control, comparison with previously delivered facts, or final editorial review. Several contracts about one election therefore occupy the entire digest. Limiting the count alone does not limit conceptual repetition.

## Implementation issues that reinforce the problem

| Area | Confirmed behavior | Proposed correction |
| --- | --- | --- |
| Judgment budget | 22/day applies only to news `judgment`; market matching, watchlist filtering, and explanations use separate uncounted calls | Shared token/spend accounting; reserve capacity for editorial shortlists; display total usage |
| Budget fairness | Articles are processed in fixed feed order and can be rejudged for each extra outlet; market matches let single-outlet stories consume the small news judgment budget | Ingest first, score changed clusters once per batch, prioritize pending work across subjects |
| Budget retries | Budget-skipped judgments have no independent pending-work sweep; retry depends on later refresh triggers | Persist pending scoring work and retry within budget |
| Market matching | `match_markets.ts` falls back to the nearest vector candidate even when Kimi chooses no matches | Distinguish rejection from provider failure; honor a genuine no-match result |
| Clustering | Current production policy automatically merges the 0.74–0.80 gray band; only the top candidate is considered | Evaluate event-specific matches with headline/snippet/entities and multiple candidates; retain the existing eval harness |
| Vector freshness | Recent vectors are filtered after querying global top-20; no same-tick in-memory supplement exists | Filter indexed corpus before retrieval where practical, maintain current-tick candidate state, and evaluate misses |
| Same-URL updates | URL hashes make existing entries immutable in ingestion; updated headlines/content are skipped | Canonical URLs plus content hashes and meaningful-change detection |
| Story freshness | News novelty uses first cluster sighting; rescoring happens on article/feedback triggers, not age alone | Separate publication time, ingestion time, development time, analysis time, and last delivered version |
| Posted state | `posted_digest_id` permanently excludes a cluster, including future substantial developments | Deliver story versions; allow significant updates with a short explanation of what changed |
| Ingest resilience | A rejected RSS promise aborts `Promise.all`; RSS lacks a deadline; embedding/clustering failures discard new articles before storage | Isolate feeds, add bounded deadlines/retries, archive evidence before AI enrichment |
| Source health | Logs show errors but persistent freshness/yield history is absent | Track latest publication, successful parsing, newly discovered items, and expected cadence per feed |
| Reactions | First poll baselines existing reactions, so immediate feedback before the first poll is ignored | Capture votes from message creation, with explicit deduplication |
| Learning target | Votes change all outlets attached to a cluster; market supporting links live in a different table, so their votes can affect no outlets | Learn editorial interests and rejection reasons independently from source reliability |
| Delivery integrity | Failure after some per-story posts deletes local post records without retracting already delivered messages | Persist per-item delivery state and retry idempotently |
| Archive integrity | Archive scores/titles are read from current clusters; the delivered explanation is not saved as an edition artifact | Snapshot ordered headline, facts, summary, links, and selection rationale at delivery |

The live pool also contains two near-identical energy-ceasefire clusters, one warning that the claim is unverified and another scoring it as a major breakthrough. This demonstrates inconsistency in the stored analysis; it does not verify the underlying event. Event deduplication and shared evidence should precede final copy.

`clusters_above_threshold` in the masthead counts all unposted clusters over the score threshold, without the digest's freshness and source gates. It is not a count of stories actually ready for the next edition. Likewise an “upcoming digest” badge indicates eligibility, not guaranteed selection under the cap.

## Proposed editorial product

Build a parent-facing general-interest briefing. Include serious world developments when they help explain the day, and give comparable opportunity to discovery, ingenuity, nature, culture, local life, and noteworthy achievements. Interest need not mean shock, disaster, or positivity. Avoid sensational crime and repetitive politician commentary unless there is a broader consequence worth explaining.

Suggested source lanes:

| Lane | Purpose and starting candidates |
| --- | --- |
| General news and public life | Retain a smaller reliable general-news backbone; broaden beyond world-only sections |
| Science and discovery | Science News, Smithsonian science/Smart News, specialist reporting plus underlying research where appropriate |
| Space and engineering | NASA/JPL mission announcements plus independent reporting; retain relevant Ars coverage |
| Nature and environment | Wildlife, oceans, conservation, weather phenomena, and Earth science reporting |
| Technology and inventions | Keep Ars and The Verge; favor changed capabilities and consequences over promotional product churn |
| History, arts, culture, sport | Archaeology, museums, creative work, unusual achievements, records, and major milestones |
| Local and practical life | Reliable sources for the user's actual locality; the Chicago delivery timezone does not establish residence |

Start with roughly 20–30 curated feeds, not indiscriminate subscriptions. Limit work fairly across source lanes. Official RSS availability is documented by [Science News](https://www.sciencenews.org/about-science-news/frequently-asked-questions), [Smithsonian](https://www.smithsonianmag.com/rss/), and [NASA](https://www.nasa.gov/rss-feeds/). Check proposed endpoints and freshness inside Cloudflare before enabling them. Treat primary announcements and press releases as evidence of what was announced, with independent reporting/context for broader claims.

Use HN or social channels later as discovery hints, not independent verification. Broaden Brave research to promising normal stories, missing coverage, and targeted daily discovery lanes; reuse the existing page-fetch plumbing. A bounded search stage can catch a worthwhile story that no configured RSS feed surfaced. Do not require paid search for every ingested article.

Store RSS descriptions/content where supplied, publisher identity, content type, original publication timestamps, fetched excerpts, and evidence provenance. Fetch richer evidence only for the plausible shortlist. Persist the evidence used for published summaries so later review is possible. Distinguish original reporting, opinion, press releases, evergreen content, and live coverage.

Evaluate confidence separately from utility. One authoritative source can qualify for a directly verifiable announcement; extraordinary, contested, scientific, or causal claims need appropriate corroboration and qualifications. Three news outlets repeating one unsupported claim are not three confirmations. Parsing failure or insufficient evidence should produce a pending/unsupported state, not a fabricated judgment.

For utility, ask whether there is a new concrete development, a memorable fact worth explaining, a meaningful consequence, a discovery or achievement, and a plausible family conversation. Preserve dimensions such as curiosity, significance, explainability, relevance, and novelty for evaluation. Tune scoring from real comparisons rather than inventing precise weights now.

Run one final editor pass over a sufficiently broad shortlist and the recently delivered editions. Pick a coherent set of 3–5 items, preferably across several subjects when the news supports that variety. Deduplicate by real event, not article or market slug. Use soft diversity preferences; allow genuinely major events to dominate when justified and allow fewer items on thin days. Polymarket price movements alone should not qualify. If retained, market discovery should lead to a verified event that passes the same editorial rules, with odds optional in a separate Markets view.

Each published item should carry a plain-language headline, what happened, why it is worth knowing, a useful explanatory detail, source links, and qualifications. A short optional conversation prompt can help a parent explain an underlying concept; avoid mechanical questions on every item. Adjust depth and presentation once children's ages and family interests are known.

Default proposal: one main daily edition before dinner at a chosen local time, continuing hourly ingestion and on-demand `/topnews`. Morning/extra updates should be preference-driven or reserved for a material development. Empty output should distinguish “nothing passed editorial review” from “inputs or analysis failed.” Avoid filling slots with weak stories.

## OpenAI and Cloudflare proposal

The verified OpenAI API model identifier is **`gpt-6-luna`**. It supports structured outputs and the Responses API. Current published standard prices are **$0.10 per million input tokens and $0.50 per million output tokens**. The model supports multiple reasoning efforts; use low effort for routine structured classification and compare medium effort for final editorial choices when evaluation warrants it. These capabilities are documented in the [official Luna model page](https://developers.openai.com/api/docs/models/gpt-6-luna) and [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).

Keep Cloudflare hosting, D1, KV, Vectorize, and the current BGE embeddings. Replacing embeddings would require rebuilding indexes and adds no demonstrated benefit to this task. Put a future `OPENAI_API_KEY` in a Cloudflare Worker secret and `.dev.vars` for local work; never expose it in the SPA or git. Adding the secret alone will not enable OpenAI: `Env` has no OpenAI binding and `runLLM` always invokes Workers AI. `JUDGMENT_MODEL` only swaps the news judgment's Workers AI slug; market intelligence remains hardcoded to Kimi.

Extend the existing LLM boundary with task/provider routing and a normalized output contract, plus a Responses API adapter for Luna. Use strict schemas for classifications, evidence summaries, and edition selection, then validate cited evidence and selected IDs in application code. Handle refusals, incomplete output, deadlines, and bounded retries explicitly. Do not carry the existing temperature parameter into reasoning-enabled requests; the [GPT-6 migration guidance](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra#migration-quickstart) specifies the compatibility rules across Luna/Sol/Astra.

Log provider, model, task, usage, errors, prompt version, and evidence version. Budget total billable tokens/cost across tasks, reserving editorial capacity. A provider fallback must be evaluated and visible in operations metrics; it should not quietly resurrect the old selection policy.

Illustrative token arithmetic: 200,000 input plus 40,000 total billable output tokens/day would cost $0.04/day, about $1.20 per 30 days at those rates. This is not a usage forecast: reasoning output, search fees, retries, Cloudflare, and existing services are additional or workload-dependent. At this scale, an arbitrary 22-judgment cap is a poor replacement for a measured spend budget.

## Website, delivery, and feedback

Retain the newspaper design. Lead with today's curated edition and a few well-edited briefs. Add useful subject sections and saved past editions; keep a broader browseable pool for exploration. The story page should lead with the explanation and evidence. Score breakdowns, model judgments, and market instrumentation belong in secondary details. Discord, the site, and `/topnews` should reuse stored story briefs and a common editor policy, with `/topnews` additionally able to show updates since the last edition.

Save edition content immutably before delivery and track delivery status separately from editorial publication. This preserves the website's record and allows safe Discord retries. Reactions should answer “Was this worth talking about?” rather than automatically judging the publisher. Later offer concise reasons such as repetitive, too niche, interesting, or needs more explanation, and keep a small editable family profile separate from evidence reliability.

## Proposed implementation sequence and acceptance

1. **Define the editorial policy and baseline evaluation.** Record the current sample; create a small set of real candidate days and parent judgments, including missed specialist stories, repeated contracts, weak evidence, quiet days, and major world developments. Label source misses separately from ranking mistakes. Supersede the old mission in active docs when implementation is authorized.
2. **Deliver the first meaningful slice.** Remove the market-only eligibility advantage; introduce publisher identity and the expanded source lanes; store snippets/evidence; add Luna task routing; permit credible specialist stories; choose and persist one varied daily edition. Include matching source/topic changes in the site and `/topnews`.
3. **Make selection and delivery reliable.** Batch cluster scoring, persist pending work, detect article/story updates, compare with recent editions, improve event clustering against labeled examples, snapshot editions, and make message retries idempotent. Add source freshness and total model usage metrics.
4. **Tune against actual usefulness.** Generate preview editions without posting extra messages; compare old/new choices over representative days and then observe family feedback. Add daily search discovery, local coverage, and preference learning where the evidence demonstrates a gap.

Suggested initial success criteria, to refine with the user: most delivered items are worth discussing; the edition normally supplies 3 useful conversation topics when coverage supports them; no duplicate event slots or odds-only items; several subjects appear over a week; published claims have traceable evidence and honest qualifications; a materially new development can reappear; source outages are distinguishable from quiet news; total analysis/search spend stays within a configured budget. Track missed important/interesting stories as well as false positives. Unit tests remain necessary, but a green suite is not proof of editorial usefulness.

Implementation priorities touch `src/sources.ts`, `rss.ts`, `ingest.ts`, `scoring.ts`, `llm.ts`, `digest.ts`, `snapshots.ts`, `match_markets.ts`, `topic.ts`, `source_weights.ts`, `reaction_sync.ts`, `api.ts`, `interactions.ts`, web story/edition pages, Discord registration options, and additive D1 migrations. Existing cluster evaluation is reusable but must expand to measure selection quality and evidence-grounded copy.

Outstanding preferences can be settled before their dependent changes: children's ages, home/local-news region, family interests, delivery time, desired tone/depth, and model/search spend ceiling. None is required to establish the diagnosis above.

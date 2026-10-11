# Family news implementation plan

**Approved direction:** 2026-10-11. Implements the user's request for a useful, varied, evidence-based briefing for family conversation. Active successor to `INITIAL.md`; retain M1–M6 as history. Analysis: `ANALYSIS-2026-10-11-family-news-digest.md`.

## Product contract and defaults

- Collect news hourly and publish one daily edition at **17:00 America/Chicago**, configurable by Worker variables. `/topnews` remains available anytime.
- Aim for **3–5 distinct worthwhile stories**, with soft subject diversity and permission to publish fewer. No odds-only stories in the main pool; Markets remains available separately.
- Parent-facing, plain-language briefs: what happened, why it matters/is interesting, one explanatory detail, optional conversation question, evidence links and honest qualifications.
- Coverage: world/public life, science, space, nature/environment, health, technology/engineering, history/culture, notable sport and achievements. Local discovery is opt-in using a configured region; do not infer residence or children's ages.
- Keep Cloudflare hosting/D1/KV/Vectorize and BGE embeddings. Prefer `gpt-6-luna` when an OpenAI secret exists; explicit Workers AI fallback uses the same editorial policy and is visible in operational status.
- Defaults are editable configuration, not demographic assumptions. Default AI ceiling: 200 text calls and 600,000 estimated/billable tokens per UTC day, with atomic reservations and actual usage reconciliation. Reserve capacity for edition work. Market enrichment is opt-in for scheduled work to protect the news budget.
- Store incoming evidence before AI enrichment; retry pending work. Persist exact edition copy and evidence before delivery; preserve historical editions.
- Git commits and pushes require explicit user authorization; the user authorized committing and pushing this rollout to `main` on 2026-10-11. Production rollout requires migration and credential readiness; prepare/test all code before reporting any required operator action.

## M7 — Source diet, evidence and ingestion reliability

- [x] Add an additive migration for publisher/feed metadata, evidence snippets/excerpts, content hashes, pending enrichment, source health, editorial briefs/versions, editions/items, delivery state, and text-model usage.
- [x] Replace the world-heavy registry with approximately 20–30 feeds across the coverage lanes. Preserve publisher identity separately from feed labels; science/primary sources are eligible without three-outlet coverage.
- [x] Preserve RSS/Atom descriptions/content as sanitized evidence. Canonicalize tracking URLs, validate HTTP(S), detect same-URL changes, and distinguish publication/discovery/update timestamps.
- [x] Isolate failed feeds; bound fetch time/size; persist latest publication, error, item yield and expected source cadence. Never call a stale HTTP-200 feed healthy simply because it loaded.
- [x] Store articles before embedding and persist enrichment retry state. Batch embeddings, maintain a current-tick matching index, and score changed clusters once per batch.
- [x] Restore semantic review for ambiguous headline matches; reject invalid IDs and genuine no-match market reranks.
- [x] Verify source endpoints and meaningful parser/ingestion failure cases.

**Acceptance:** One failed feed/AI call cannot discard other feed data; same publisher feeds cannot inflate coverage; snippets survive parsing/storage; specialist evidence can reach analysis; pending enrichment retries.

## M8 — Luna, evidence-based editorial analysis and budgets

- [x] Implement an OpenAI Responses adapter behind existing text-model routing. Default exact model `gpt-6-luna`; explicit low reasoning effort; strict schemas; normalize text/usage; detect incomplete/refused responses; omit incompatible parameters.
- [x] Add bounded provider deadlines/retries and atomic shared usage reservations, actual token reconciliation, task tags, errors and budget-deferred work. No provider failure may turn into a fabricated passing score.
- [x] Keep embeddings in Workers AI. Route editorial text calls through the common adapter; retain optional market tools and historical usage compatibility.
- [x] Load a multi-article evidence packet; fetch/capture a bounded number of page excerpts for promising clusters; optionally research through Brave when evidence is thin.
- [x] Assess confidence separately from curiosity/significance/explainability/family conversation value. Require traceable evidence IDs and a new concrete development. Store stable briefs and evidence hashes/versions.
- [x] Version editorial policy and recalibrate current assessments without changing event versions or archived copy; explicitly down-rank routine sport and exclude evergreen profiles.
- [x] Reanalyze material changes and pending work, not every extra article or source; use fair per-topic candidate allocation and budget reservations.
- [x] Add configurable parent interests/locality and bounded daily discovery search. Social sources remain optional future discovery hints.

**Acceptance:** A credible one-source science announcement can qualify; a large unsupported market move cannot; model failure remains pending; all published links originate from supplied evidence; budget cannot be exceeded by overlapping reservations.

## M9 — Editions, diversity, freshness and reliable delivery

- [x] Select 3–5 evidence-qualified news briefs using event deduplication, soft topic diversity, recent delivered versions and a bounded final editor pass.
- [x] Support significant story updates while suppressing repeated facts/events across editions. Never treat market contract slugs as separate news events.
- [x] Persist exact ordered edition content/evidence and its preparation status before posting. Allow saved quiet editions with clear coverage/analysis health.
- [x] Post per-story Discord messages for feedback with deterministic delivery keys, a claim/lease, stored message IDs and retry state. Retain successful partial deliveries; never delete their records on a later failure.
- [x] Use configurable timezone/hour (default 17:00 CT), stable cron timestamp and a tick lease; bounded pipeline work must complete even when one subsystem fails.
- [x] Add read-only edition preview and protected prepare endpoint that does not post to Discord.

**Acceptance:** Duplicate election contracts cannot fill slots; a material update can reappear; ordinary rephrasing cannot; failed delivery resumes with known messages intact; archive text never changes when a cluster changes.

## M10 — Shared briefs, newspaper, Discord and health

- [x] Extend public API with current/saved editions, editorial briefs, broader topic options and source/model/pipeline health. Preserve old archives and markets access.
- [x] Make the front page lead with today's saved edition and useful subject sections; keep browseable news beneath it. Explain an honest quiet edition and failed/incomplete collection separately.
- [x] Lead story detail with saved explanation, qualifications and citations; move scores/market instrumentation into expandable details.
- [x] Show immutable edition contents in the archive, including updated stories. Reuse stored brief copy in `/topnews` with diversity/event deduplication and current topic filters.
- [x] Update Discord registration options and footers; make family-interest feedback wording accurate.
- [x] Update README/operator configuration and example Worker vars without exposing secrets.

**Acceptance:** Discord/site/on-demand use the same brief; science/nature/culture are browsable; archived editions reproduce what was selected; operational state is intelligible.

## M11 — Feedback and editorial evaluation

- [x] Capture immediate reactions from message creation (backfill historical baselines without replaying old votes).
- [x] Record story-interest votes independently from publisher reliability; use smoothed topic preferences and configured interests in ranking. Do not rescore all historical stories per reaction.
- [x] Add labeled editorial scenario fixtures for specialist stories, weak evidence, duplicate events, materially updated stories, sparse/quiet days, and major events. Expand tests with real SQLite migration/selection/retry integration.
- [x] Add an offline editorial evaluation command reporting precision against labeled choices, duplicate rate, topic diversity, missed candidates and evidence validity. Clearly distinguish synthetic regression scenarios from human relevance evaluation.
- [x] Save production comparison/preview instructions; observed family usefulness remains a post-rollout measurement, not an implementation completion claim.

**Acceptance:** Votes change interests, not source credibility; regression evaluation covers the demonstrated market bias and specialist recall; no unsupported claim that tests prove subjective editorial quality.

## M12 — Validation and rollout readiness

- [x] Apply all migrations to isolated SQLite and local D1; verify preservation of old articles/posts/market data, backfill mappings and indexes.
- [x] Run complete tests, type checks, production build and Wrangler deployment dry run; perform local API/UI smoke with seeded saved edition data and mocked provider fixtures.
- [x] Review final diff for credential exposure, unlimited work, broken archive compatibility, duplicate delivery and budget leakage.
- [x] Verify available Cloudflare authorization and secret names without reading/logging secret values. If OpenAI credentials are unavailable, finish all implementation and mock validation, provide exact secret setup and live-smoke steps as the remaining operator action.
- [x] Update every checklist and `CURRENT_PROGRESS.md` with evidence, any runtime limitations, and the next concrete deployment step. Do not mark unavailable live/provider verification complete.

**Completion:** All implementation and local validation tasks pass. Live credentials/rollout and ongoing human relevance evaluation are reported accurately if they require user action.

## Completed rollout — 2026-10-11

M7–M12 are complete. All three additive migrations were applied locally and remotely. Final Cloudflare version: `e5b7411b-2d53-4969-920e-d266227b838c`. The global `/topnews` command was updated. Validation: 176 passing tests across 27 files, both TypeScript checks, final build/deployment dry run, all 25 feeds fresh from Cloudflare, real Luna specialist/sports checks, and desktop/mobile/archive/detail browser checks. Two protected collection passes and the real hourly scheduled run completed without failures; each enriched 40 articles and analyzed 16 stories. Current preview contains science, technology, health, world and nature with no market-driven entries. No manual Discord test messages were sent; the first saved daily edition is scheduled for 17:00 America/Chicago. First-week family relevance review remains an ongoing product evaluation, not unfinished implementation.

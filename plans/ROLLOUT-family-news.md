# Family news rollout and evaluation

Active plan: `IMPLEMENTATION-family-news.md`. Progress and actual validation results: `CURRENT_PROGRESS.md`.

## Deploy

1. Configure `OPENAI_API_KEY` in Cloudflare Secrets and gitignored `.dev.vars`. Confirm only secret names using `npx wrangler secret list`; never log values. Keep existing Discord, D1, KV, AI and Vectorize bindings. Workers Paid is required for the database workload.
2. Run `npm test`, `npm run check`, `npm run editorial:eval`, `npm run sources:check` and `npm run editorial:smoke`. The smoke uses a real current Science News article and Luna with an isolated SQLite database, and never posts to Discord. It prints the resulting brief, evidence URLs and token usage.
3. Run `npm run build` and `npx wrangler deploy -c dist/anything_interesting/wrangler.json --dry-run`.
4. Apply `npm run db:remote`. Migrations 0009–0011 are additive; historical posts, articles and market data remain. Review Wrangler's migration summary.
5. Run `npm run deploy`. Register the broader slash command options with `npm run discord:register-topnews`, using the existing `.env` operator credentials.
6. Verify `/health`, `/api/status`, `/api/stats`, `/api/digests`, `/api/markets`, and the website. Status should report OpenAI / `gpt-6-luna`, key availability and the configured 25 feeds. Never include credentials in reports.

## Collect and preview

The hourly cron continues collecting automatically. For an immediate collection, send `POST /ops/news/refresh` with the existing `X-Ops-Token` credential. This request performs bounded discovery, ingestion and analysis only, without preparing an edition, polling reactions or posting to Discord. Keep the HTTP connection open while it runs; an overlapping tick returns 409. A failed subsystem is recorded in `/api/status` while independent steps continue. Avoid putting a literal credential in shell history; load it internally from an ignored local secret file.

Inspect `GET /api/status` after collection. Development-host HTTP-200 feed probes do not guarantee Cloudflare access. Look at fresh/error/stale source counts, article enrichment and story-analysis backlog, the latest pipeline run, and model budget/usage. Check actual science/space/nature/culture reporting alongside major public events.

Use `GET /api/edition/preview` to see deterministic candidate selection without an AI call, immutable edition or Discord message. Check distinct events, clear explanations, evidence links and qualifications. `POST /ops/edition/prepare` deliberately saves today's edition; use it only when ready to freeze that copy. Default automatic preparation/delivery is at or after 17:00 America/Chicago, with at most five stories. A saved quiet edition is permitted; incomplete empty preparation is retried when coverage recovers.

Check desktop and mobile front page, topic filters, a story detail page and the archive. Story evidence and edition evidence are distinct snapshots: the archive must retain the delivered copy after a later material update.

## Delivery recovery

Successful Discord messages are saved individually. Known failed requests can retry; timeouts, HTTP 5xx responses or interrupted sending become `uncertain` and require checking the channel. Do not blindly repost an uncertain item.

After checking Discord, use `POST /ops/edition/reconcile` with `X-Ops-Token` and JSON:

```json
{"edition_id": 123, "position": 0, "message_id": "123456789012345678"}
```

The Worker verifies the existing webhook message and saved headline before recording it. If the message definitely was not sent, submit:

```json
{"edition_id": 123, "position": 0, "confirm_not_sent": true}
```

This releases the item for the next normal retry; reconciliation itself does not post. Use the position returned by the edition API, not a guessed display position.

## Measure usefulness after rollout

Offline fixtures verify regressions, not subjective relevance. Review the first seven actual editions. For each selected story record: worthwhile dinner/car conversation (yes/no), clear explanation (yes/no), supported facts/qualification (yes/no), and already discussed/repeated (yes/no). Record one or two missed stories when the family notices an omission.

Compare with the previous sample: 33 of 44 items across 20 historical digests were market-driven, and 54 of 90 across the latest 50 were market-driven. Track the new market-driven share (expected zero in the main pool), distinct events, topics per edition, unsupported claims, missed worthwhile stories and useful-story proportion. Do not impose a quota that hides a major news day.

Use 👍/👎 on new edition messages as interest feedback; those votes never alter publisher reliability. Tune `FAMILY_INTERESTS`, the source registry and editorial thresholds from evidence. Configure `LOCAL_NEWS_REGION` and enable bounded discovery only if local reporting is wanted. Changing a model requires validating its API contract and updating cost estimates.

## Rollback

Keep additive migrations in place. If the new Worker must be rolled back, Cloudflare's previous deployed version can continue against the expanded schema. Do not reverse migrations or delete saved editions to roll back code. An old Worker resumes its old market-heavy delivery policy; check schedules and delivery state before doing that. Diagnose a provider outage using `/api/status`; explicitly selecting `workers-ai` uses the same new editorial policy without removing the new schema.

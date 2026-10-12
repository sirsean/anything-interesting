# M13 — Concise Discord digest

Requested 2026-10-11 after the first delivered 17:00 edition was too verbose.

## Contract

Discord shows a linked headline and one brief paragraph covering the main event and why it is newsworthy/interesting. Remove separate context, discussion questions, explanatory detail and source blocks from Discord. Retain full explanations, qualifications, questions and source links on website detail pages. Keep a compact topic/reaction footer. Apply the same format to scheduled editions and `/topnews`.

## Tasks

- [x] Add a short summary to newly analyzed briefs in the existing model call; target 25–45 words with a 60-word/500-character display ceiling. Preserve essential uncertainty in the prose.
- [x] Support already-saved briefs with a bounded single-paragraph fallback, without model calls during delivery or `/topnews`.
- [x] Update the shared Discord formatter and retain website/archive content.
- [x] Verify generated/legacy formatting, delivery payload and full saved copy; run relevant tests, type checks and production build.
- [x] Deploy and inspect a local preview of the real delivered edition without posting another Discord message. Update progress and results. No additional migration is needed. Commit/push only on a new explicit request.

## Validation and completion

Completed and deployed on 2026-10-11 as Cloudflare version `55c1fb0b-f865-41ab-9fb2-040dfbfde6ad`. All 179 tests, both TypeScript checks, diff checks and production build pass. A real Luna trial produced a 35-word dedicated summary with uncertainty in the prose. Previewing the five delivered stories produced complete single paragraphs of 33–50 words (220–301 characters), without context/questions/detail/source blocks. Tests verify short delivery payloads alongside complete saved website copy, legacy compatibility and length ceilings. Production health is 200; the delivered edition and full story details/sources remain available. No Discord messages were sent, no migration was required, and the user explicitly authorized committing and pushing this follow-up to `main` on 2026-10-11.

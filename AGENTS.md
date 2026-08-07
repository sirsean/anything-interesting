# anything-interesting

## Plans

Use the `plans/` directory to store plans for current/future coding agents and to maintain a `CURRENT_PROGRESS.md` file that describes where we are in our implementation plan. We should always make sure to read the plans and update the progress file as we work.

## Git

Do not ever commit automatically. The user will explicitly request git actions, that is the only time you should commit or push.

## Wrangler

You can perform `npm run ...` and `npx wrangler ...` commands without explicit approval.

## Discord — register `/topnews` (local only)

Slash command registration uses the **bot token** once via HTTP; it is **not** stored in the Worker. Operators keep secrets in a repo-root **`.env`** file (already listed in `.gitignore`).

1. Copy `.env.example` → `.env` and fill in:
   - `DISCORD_APPLICATION_ID` — Developer Portal → General Information → Application ID
   - `DISCORD_BOT_TOKEN` — Developer Portal → Bot → token (reset/copy as needed)
2. From the repo root: `npm run discord:register-topnews`  
   The script loads `.env` via **dotenv** (`import 'dotenv/config'` in `scripts/register-topnews.mjs`). Existing shell env vars take precedence over `.env` if both are set.
3. Never commit `.env` or paste bot tokens into the repo, issues, or chat logs.

## Brave Search — Strategy B market research

Flagged Polymarket moves always run Brave News + page-fetch research (in addition to local RSS). Store the API key as a Worker secret (not in git):

1. Create a key at https://api-dashboard.search.brave.com/ (Search plan includes News).
2. Production: `wrangler secret put BRAVE_SEARCH_API_KEY`
3. Local: put `BRAVE_SEARCH_API_KEY=...` in **`.dev.vars`** (Wrangler / Vite CF plugin; gitignored). `.env` alone does not inject Worker secrets.
4. If unset, Strategy B still runs on RSS hits only (research skipped).

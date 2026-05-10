#!/usr/bin/env node
/**
 * One-time (or when options change): register global `/topnews` with Discord.
 *
 * Credentials (never commit real values):
 *   DISCORD_APPLICATION_ID — Application ID from the Discord Developer Portal
 *   DISCORD_BOT_TOKEN      — Bot token; used only for this HTTP call to Discord
 *
 * Loads repo-root `.env` automatically (see `AGENTS.md`). You can still override
 * by exporting vars in the shell for a one-off run.
 *
 * Usage:
 *   npm run discord:register-topnews
 */

import 'dotenv/config';

const API = 'https://discord.com/api/v10';

const appId = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_BOT_TOKEN;

if (!appId || !token) {
  console.error(
    'Missing DISCORD_APPLICATION_ID or DISCORD_BOT_TOKEN.\n' +
      'Add them to a repo-root `.env` file (gitignored) or export them in your shell.\n' +
      'See `.env.example` and `AGENTS.md`.',
  );
  process.exit(1);
}

const command = {
  name: 'topnews',
  description: 'Top scored clusters from the last 12 hours (same pool as digests)',
  options: [
    {
      type: 4,
      name: 'count',
      description: 'How many clusters to show (1–5)',
      required: false,
      min_value: 1,
      max_value: 5,
    },
    {
      type: 3,
      name: 'topic',
      description: 'Optional topic filter',
      required: false,
      choices: [
        { name: 'Geopolitics', value: 'geopolitics' },
        { name: 'Politics', value: 'politics' },
        { name: 'Economics', value: 'economics' },
        { name: 'Technology', value: 'technology' },
      ],
    },
  ],
};

const url = `${API}/applications/${appId}/commands`;

const res = await fetch(url, {
  method: 'PUT',
  headers: {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify([command]),
});

const body = await res.text();
if (!res.ok) {
  console.error('Discord API error', res.status, body);
  process.exit(1);
}

console.log('Registered global commands:', body);

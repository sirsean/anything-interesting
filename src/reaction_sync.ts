import type { Env } from './env';
import {
  clusterIdsTouchingSources,
  recordClusterReaction,
} from './source_weights';
import { refreshClusterScores } from './scoring';

const DISCORD_API = 'https://discord.com/api/v10';
const THUMB_UP = encodeURIComponent('👍');
const THUMB_DOWN = encodeURIComponent('👎');

function parseWebhookUrl(webhookUrl: string): { id: string; token: string } | null {
  try {
    const u = new URL(webhookUrl);
    const m = u.pathname.match(/\/webhooks\/(\d+)\/([^/]+)/);
    if (!m) return null;
    return { id: m[1], token: m[2] };
  } catch {
    return null;
  }
}

async function resolveWebhookChannelId(env: Env, webhookUrl: string): Promise<string | null> {
  const cached = await env.CONFIG.get('discord:webhook_channel_id');
  if (cached?.trim()) return cached.trim();

  const meta = parseWebhookUrl(webhookUrl);
  if (!meta) return null;

  const res = await fetch(`${DISCORD_API}/webhooks/${meta.id}/${meta.token}`);
  if (!res.ok) {
    console.error('resolveWebhookChannelId failed', res.status);
    return null;
  }
  const j = (await res.json()) as { channel_id?: string };
  const ch = j.channel_id?.trim();
  if (!ch) return null;
  await env.CONFIG.put('discord:webhook_channel_id', ch, { expirationTtl: 86400 * 30 });
  return ch;
}

async function fetchReactionUserIds(
  botToken: string,
  channelId: string,
  messageId: string,
  encodedEmoji: string,
): Promise<string[]> {
  const out: string[] = [];
  let after: string | undefined;
  for (;;) {
    const q = new URLSearchParams({ limit: '100' });
    if (after) q.set('after', after);
    const url = `${DISCORD_API}/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}?${q}`;
    const res = await fetch(url, { headers: { Authorization: `Bot ${botToken}` } });
    if (!res.ok) {
      const t = await res.text();
      console.error('fetchReactionUserIds', res.status, t.slice(0, 200));
      return out;
    }
    const arr = (await res.json()) as Array<{ id?: string }>;
    for (const u of arr) {
      if (typeof u.id === 'string') out.push(u.id);
    }
    if (arr.length < 100) break;
    const last = arr[arr.length - 1]?.id;
    if (!last) break;
    after = last;
  }
  return out;
}

function kvSeenKey(messageId: string, kind: 'up' | 'down'): string {
  return `reaction_seen:v1:${messageId}:${kind}`;
}

function kvInitKey(messageId: string, kind: 'up' | 'down'): string {
  return `reaction_init:v1:${messageId}:${kind}`;
}

async function loadSeen(env: Env, messageId: string, kind: 'up' | 'down'): Promise<Set<string>> {
  const raw = await env.CONFIG.get(kvSeenKey(messageId, kind));
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

async function saveSeen(env: Env, messageId: string, kind: 'up' | 'down', ids: Set<string>): Promise<void> {
  const ttl = 86400 * 14;
  await env.CONFIG.put(kvSeenKey(messageId, kind), JSON.stringify([...ids]), { expirationTtl: ttl });
}

async function processEmojiSide(
  env: Env,
  botToken: string,
  channelId: string,
  messageId: string,
  clusterId: number,
  encodedEmoji: string,
  direction: 'up' | 'down',
): Promise<string[]> {
  const ids = await fetchReactionUserIds(botToken, channelId, messageId, encodedEmoji);
  const initKey = kvInitKey(messageId, direction);
  const inited = await env.CONFIG.get(initKey);
  if (!inited) {
    await env.CONFIG.put(initKey, '1', { expirationTtl: 86400 * 60 });
    await saveSeen(env, messageId, direction, new Set(ids));
    return [];
  }

  const seen = await loadSeen(env, messageId, direction);
  const touchedSources = new Set<string>();

  for (const userId of ids) {
    if (seen.has(userId)) continue;
    const { applied, sources } = await recordClusterReaction(env.DB, messageId, clusterId, userId, direction);
    if (applied) {
      seen.add(userId);
      for (const s of sources) touchedSources.add(s);
    }
  }

  await saveSeen(env, messageId, direction, seen);
  return [...touchedSources];
}

async function refreshClustersForSources(env: Env, sources: string[]): Promise<void> {
  const ids = await clusterIdsTouchingSources(env.DB, sources);
  for (const id of ids) {
    try {
      await refreshClusterScores(env, id);
    } catch (e) {
      console.error('refreshClusterScores after reactions', id, e);
    }
  }
}

/**
 * Poll 👍/👎 on recent per-cluster digest messages (M5). Requires `DISCORD_BOT_TOKEN`
 * (install bot in the channel; Read Messages / Read Message History). Reactions on
 * webhook messages are visible to the bot the same as user messages.
 */
export async function syncDigestReactions(env: Env): Promise<void> {
  const bot = env.DISCORD_BOT_TOKEN?.trim();
  const webhook = env.DISCORD_WEBHOOK_URL?.trim();
  if (!bot || !webhook) {
    return;
  }

  const channelId = await resolveWebhookChannelId(env, webhook);
  if (!channelId) {
    console.warn('reaction sync: could not resolve webhook channel id');
    return;
  }

  const { results } = await env.DB
    .prepare(
      `SELECT pcm.message_id, pcm.cluster_id
       FROM post_cluster_messages pcm
       JOIN posts p ON p.id = pcm.post_id
       WHERE datetime(p.digest_timestamp) >= datetime('now', '-14 days')
       ORDER BY p.digest_timestamp DESC
       LIMIT 120`,
    )
    .all<{ message_id: string; cluster_id: number }>();

  const rows = results ?? [];
  if (rows.length === 0) return;

  const allTouched = new Set<string>();
  for (const r of rows) {
    const up = await processEmojiSide(env, bot, channelId, r.message_id, r.cluster_id, THUMB_UP, 'up');
    const down = await processEmojiSide(env, bot, channelId, r.message_id, r.cluster_id, THUMB_DOWN, 'down');
    for (const s of up) allTouched.add(s);
    for (const s of down) allTouched.add(s);
  }

  if (allTouched.size > 0) {
    await refreshClustersForSources(env, [...allTouched]);
    console.log(`reaction sync: touched_sources=${allTouched.size} messages=${rows.length}`);
  }
}

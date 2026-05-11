import { formatChicagoDigestSlotFromIso, nextScheduledDigestLabel } from './chicago_digest';
import {
  buildClusterDiscordEmbed,
  marketDrivenDescription,
  type ClusterRowForEmbed,
} from './discord_cluster_embed';
import type { DiscordEmbed } from './discord';
import {
  DIGEST_SOURCE_WINDOW_HOURS,
  MIN_FINAL_SCORE,
  MIN_WEIGHTED_SOURCE_COVERAGE,
} from './digest_constants';
import type { Env } from './env';
import { bindDigestSourceWindow, sqlWeightedSourceSumInWindow } from './source_weights';

const DISCORD_API = 'https://discord.com/api/v10';

const TOPNEWS_ALLOWED_TOPICS = new Set(['geopolitics', 'politics', 'economics', 'technology']);

type DiscordInteraction = {
  type: number;
  token: string;
  application_id: string;
  data?: {
    name?: string;
    options?: Array<{ name: string; type: number; value?: string | number }>;
  };
};

type TopNewsRow = ClusterRowForEmbed & {
  posted_digest_id: number | null;
  posted_digest_at: string | null;
  weighted_sources_12h: number;
  grace_ok: number;
  last_updated: string;
};

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, '');
  if (clean.length % 2 !== 0) throw new Error('invalid hex length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return out;
}

async function verifyDiscordSignature(
  rawBody: string,
  signatureHex: string,
  timestamp: string,
  publicKeyHex: string,
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const message = encoder.encode(timestamp + rawBody);
    const signature = hexToBytes(signatureHex);
    const publicKey = hexToBytes(publicKeyHex);
    const key = await crypto.subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, [
      'verify',
    ]);
    return crypto.subtle.verify({ name: 'Ed25519' }, key, signature, message);
  } catch {
    return false;
  }
}

export function parseTopNewsOptions(data: DiscordInteraction['data']): {
  count: number;
  topic: string | null;
} {
  let count = 3;
  let topic: string | null = null;
  for (const o of data?.options ?? []) {
    if (o.name === 'count' && typeof o.value === 'number') {
      count = Math.min(5, Math.max(1, Math.floor(o.value)));
    }
    if (o.name === 'topic' && typeof o.value === 'string') {
      const t = o.value.toLowerCase().trim();
      if (TOPNEWS_ALLOWED_TOPICS.has(t)) topic = t;
    }
  }
  return { count, topic };
}

function digestEligible(r: TopNewsRow): boolean {
  if (r.posted_digest_id != null) return false;
  if (r.final_score < MIN_FINAL_SCORE) return false;
  if (!r.grace_ok) return false;
  if (r.flow_type === 'market_driven') return true;
  const w = Number(r.weighted_sources_12h);
  return Number.isFinite(w) && w >= MIN_WEIGHTED_SOURCE_COVERAGE;
}

function statusLine(r: TopNewsRow): string {
  if (r.posted_digest_id != null) {
    if (r.posted_digest_at) {
      const slot = formatChicagoDigestSlotFromIso(r.posted_digest_at);
      return `Posted in ${slot} digest`;
    }
    return 'Posted in a recent digest';
  }
  if (digestEligible(r)) {
    return `In upcoming ${nextScheduledDigestLabel()} digest`;
  }
  return 'Below digest threshold';
}

async function descriptionForTopNews(c: ClusterRowForEmbed): Promise<string> {
  if (c.flow_type === 'market_driven') {
    return marketDrivenDescription(c.representative_title, c);
  }
  const rep = c.representative_title;
  return `${rep.slice(0, 220)}${rep.length > 220 ? '…' : ''}`;
}

async function queryTopNews(
  db: D1Database,
  lastDigestIso: string | null,
  count: number,
  topic: string | null,
): Promise<TopNewsRow[]> {
  const weightedSub = sqlWeightedSourceSumInWindow();
  const windowBind = bindDigestSourceWindow();
  let sql = `SELECT c.id, c.representative_title, c.final_score, c.topic, c.flow_type,
                    c.polymarket_slug, c.polymarket_price, c.polymarket_price_24h_ago,
                    c.llm_reasoning_log, c.posted_digest_id, c.last_updated,
                    p.digest_timestamp AS posted_digest_at,
                    ${weightedSub} AS weighted_sources_12h,
                    (
                      CASE
                        WHEN ? IS NULL THEN 1
                        WHEN datetime(c.last_updated) >= datetime(?) THEN 1
                        ELSE 0
                      END
                    ) AS grace_ok
             FROM clusters c
             LEFT JOIN posts p ON p.id = c.posted_digest_id
             WHERE datetime(c.last_updated) >= datetime('now', ?)`;

  const binds: unknown[] = [windowBind, lastDigestIso, lastDigestIso, windowBind];

  if (topic) {
    sql += ` AND lower(c.topic) = lower(?)`;
    binds.push(topic);
  }

  sql += ` ORDER BY c.final_score DESC, c.last_updated DESC LIMIT ?`;
  binds.push(count);

  const { results } = await db.prepare(sql).bind(...binds).all<TopNewsRow>();
  return results ?? [];
}

async function postInteractionFollowup(
  applicationId: string,
  interactionToken: string,
  payload: { content?: string; embeds?: DiscordEmbed[] },
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${DISCORD_API}/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(interactionToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: payload.content ?? undefined,
      embeds: payload.embeds?.slice(0, 10),
    }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body: body.slice(0, 500) };
}

async function buildTopNewsEmbeds(env: Env, rows: TopNewsRow[]): Promise<DiscordEmbed[]> {
  const out: DiscordEmbed[] = [];
  for (const r of rows) {
    const desc = await descriptionForTopNews(r);
    const embed = await buildClusterDiscordEmbed({
      db: env.DB,
      row: r,
      description: desc,
      footerTag: 'on-demand',
    });
    embed.fields.unshift({
      name: 'Digest status',
      value: statusLine(r).slice(0, 1024),
      inline: false,
    });
    out.push(embed);
  }
  return out;
}

async function runTopNewsCommand(env: Env, interaction: DiscordInteraction): Promise<void> {
  const appId = interaction.application_id;
  const token = interaction.token;
  const { count, topic } = parseTopNewsOptions(interaction.data);

  try {
    const lastDigest = await env.CONFIG.get('cursors:last_digest_at');
    const rows = await queryTopNews(env.DB, lastDigest, count, topic);

    if (rows.length === 0) {
      const hint = topic ? ` (topic: ${topic})` : '';
      const posted = await postInteractionFollowup(appId, token, {
        content: `No clusters scored in the last ${DIGEST_SOURCE_WINDOW_HOURS}h${hint}.`,
      });
      if (!posted.ok) {
        console.error('topnews followup failed', posted.status, posted.body);
      }
      return;
    }

    const embeds = await buildTopNewsEmbeds(env, rows);
    const topicBit = topic ? ` · ${topic}` : '';
    const posted = await postInteractionFollowup(appId, token, {
      content: `Top news — ${rows.length} cluster${rows.length === 1 ? '' : 's'}${topicBit}`,
      embeds,
    });
    if (!posted.ok) {
      console.error('topnews followup failed', posted.status, posted.body);
    }
  } catch (e) {
    console.error('topnews deferred error', e);
    await postInteractionFollowup(appId, token, {
      content: '`/topnews` failed while querying D1. Check Worker logs.',
    });
  }
}

export async function handleDiscordInteraction(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const publicKey = env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    console.error('DISCORD_PUBLIC_KEY not configured');
    return new Response('Server misconfigured', { status: 500 });
  }

  const sig = req.headers.get('X-Signature-Ed25519');
  const ts = req.headers.get('X-Signature-Timestamp');
  if (!sig || !ts) {
    return new Response('Missing signature headers', { status: 401 });
  }

  const rawBody = await req.text();
  const ok = await verifyDiscordSignature(rawBody, sig, ts, publicKey);
  if (!ok) {
    return new Response('Invalid signature', { status: 401 });
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody) as DiscordInteraction;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (interaction.type === 1) {
    return Response.json({ type: 1 });
  }

  if (interaction.type === 2) {
    const name = interaction.data?.name;
    if (name === 'topnews') {
      ctx.waitUntil(runTopNewsCommand(env, interaction));
      return Response.json({ type: 5 });
    }
    return Response.json({
      type: 4,
      data: {
        content: `Unknown command \`${name ?? '?'}\`.`,
        flags: 64,
      },
    });
  }

  return new Response('Unsupported interaction type', { status: 400 });
}

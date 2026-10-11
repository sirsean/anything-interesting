import type { Env } from './env';
import type { DiscordEmbed } from './discord';
import { NEWS_TOPICS, LEGACY_TOPICS } from './news_config';
import { onDemandStories, briefEmbed } from './editions';
const DISCORD_API = 'https://discord.com/api/v10';

const TOPNEWS_ALLOWED_TOPICS = new Set<string>([...NEWS_TOPICS, ...LEGACY_TOPICS]);

type DiscordInteraction = {
  type: number;
  token: string;
  application_id: string;
  data?: {
    name?: string;
    options?: Array<{ name: string; type: number; value?: string | number }>;
  };
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

async function postInteractionFollowup(
  applicationId: string,
  interactionToken: string,
  payload: { content?: string; embeds?: DiscordEmbed[] },
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${DISCORD_API}/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(interactionToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: payload.content ?? undefined,
      allowed_mentions: { parse: [] },
      embeds: payload.embeds?.slice(0, 10),
    }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body: body.slice(0, 500) };
}

async function runTopNewsCommand(env: Env, interaction: DiscordInteraction): Promise<void> {
  const appId = interaction.application_id;
  const token = interaction.token;
  const { count, topic } = parseTopNewsOptions(interaction.data);

  try {
    const rows = await onDemandStories(env, count, topic);

    if (rows.length === 0) {
      const hint = topic ? ` (topic: ${topic})` : '';
      const posted = await postInteractionFollowup(appId, token, {
        content: `No evidence-qualified stories available yet${hint}. See the newspaper for collection status.`,
      });
      if (!posted.ok) {
        console.error('topnews followup failed', posted.status, posted.body);
      }
      return;
    }

    const embeds = rows.map(r => briefEmbed(env, r));
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

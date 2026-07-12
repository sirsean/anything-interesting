import { parseLlmReasoning } from './api';
import { marketDrivenDescription, topicLabel, type ClusterRowForEmbed } from './discord_cluster_embed';
import type { Env } from './env';

export type ClusterShareMeta = {
  title: string;
  description: string;
  topic: string;
};

const SITE_NAME = 'Anything Interesting';
const DEFAULT_DESCRIPTION =
  'Anything Interesting — a precision-first dispatch of geopolitics, politics, economics, and technology, with Polymarket signal.';

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function clusterPageUrl(env: Env, id: number, requestUrl: string): string {
  const base = env.PUBLIC_SITE_URL?.replace(/\/+$/, '') ?? new URL(requestUrl).origin;
  return `${base}/cluster/${id}`;
}

export function buildClusterShareTitle(
  representativeTitle: string,
  topArticleTitle: string | null,
  flowType: string,
): string {
  const base = topArticleTitle ?? representativeTitle;
  return flowType === 'market_driven' ? `📈 ${base}` : base;
}

export function buildClusterShareDescription(
  row: Pick<
    ClusterRowForEmbed,
    'representative_title' | 'flow_type' | 'llm_reasoning_log' | 'polymarket_price' | 'polymarket_price_24h_ago'
  >,
): string {
  if (row.flow_type === 'market_driven') {
    return marketDrivenDescription(row.representative_title, row as ClusterRowForEmbed).slice(0, 300);
  }
  const llm = parseLlmReasoning(row.llm_reasoning_log);
  if (llm?.reason?.trim()) {
    return llm.reason.trim().slice(0, 300);
  }
  return row.representative_title.slice(0, 300);
}

export async function fetchClusterShareMeta(env: Env, id: number): Promise<ClusterShareMeta | null> {
  const row = await env.DB
    .prepare(
      `SELECT id, representative_title, topic, flow_type, llm_reasoning_log,
              polymarket_price, polymarket_price_24h_ago
       FROM clusters
       WHERE id = ?`,
    )
    .bind(id)
    .first<{
      id: number;
      representative_title: string;
      topic: string;
      flow_type: string;
      llm_reasoning_log: string | null;
      polymarket_price: number | null;
      polymarket_price_24h_ago: number | null;
    }>();

  if (!row) return null;

  const top =
    row.flow_type === 'market_driven'
      ? null
      : await env.DB
          .prepare(`SELECT title FROM articles WHERE cluster_id = ? ORDER BY fetched_at DESC LIMIT 1`)
          .bind(id)
          .first<{ title: string }>();

  return {
    title: buildClusterShareTitle(row.representative_title, top?.title ?? null, row.flow_type),
    description: buildClusterShareDescription(row),
    topic: topicLabel(row.topic),
  };
}

function injectShareMeta(html: string, meta: ClusterShareMeta, canonicalUrl: string): string {
  const pageTitle = `${meta.title} · ${SITE_NAME}`;
  const description = meta.description || DEFAULT_DESCRIPTION;
  const ogTags = [
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="${escapeAttr(SITE_NAME)}" />`,
    `<meta property="og:title" content="${escapeAttr(meta.title)}" />`,
    `<meta property="og:description" content="${escapeAttr(description)}" />`,
    `<meta property="og:url" content="${escapeAttr(canonicalUrl)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escapeAttr(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(description)}" />`,
    `<link rel="canonical" href="${escapeAttr(canonicalUrl)}" />`,
  ].join('\n    ');

  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(pageTitle)}</title>`)
    .replace(
      /<meta name="description" content="[^"]*"\s*\/?>/,
      `<meta name="description" content="${escapeAttr(description)}" />`,
    )
    .replace('</head>', `    ${ogTags}\n  </head>`);
}

/**
 * Serves the SPA shell for `/cluster/:id`, injecting Open Graph / Twitter meta
 * when the cluster exists so link previews describe the story, not the app.
 */
export async function handleClusterSpaPage(
  req: Request,
  env: Env,
  idRaw: string,
): Promise<Response> {
  if (!env.ASSETS) {
    return new Response('ASSETS binding not configured', { status: 500 });
  }

  const id = Number.parseInt(idRaw, 10);
  const shellReq = new Request(new URL('/index.html', req.url), req);
  const [shell, meta] = await Promise.all([
    env.ASSETS.fetch(shellReq),
    Number.isFinite(id) && id > 0 ? fetchClusterShareMeta(env, id) : Promise.resolve(null),
  ]);

  if (!shell.ok) {
    return shell;
  }

  if (!meta) {
    return shell;
  }

  const canonicalUrl = clusterPageUrl(env, id, req.url);
  const html = injectShareMeta(await shell.text(), meta, canonicalUrl);
  return new Response(html, {
    status: shell.status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60',
    },
  });
}

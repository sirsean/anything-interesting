import { handleApiRequest } from './api';
import { handleClusterSpaPage } from './cluster_spa_meta';
import { deliverDigest } from './digest';
import { runIngest } from './ingest';
import type { Env } from './env';
import { getChicagoHour, isDigestHour } from './chicago';
import { handleDiscordInteraction } from './interactions';
import { syncDigestReactions } from './reaction_sync';
import { runMarketSnapshotsAndStrategyB } from './snapshots';
import { prepareClusterEval, runClusterEval, runClusterEvalPreset } from './cluster_eval_harness';
import { refreshWatchlistIfDue } from './watchlist';

/** Same work as the hourly cron (`scheduled`). Used by `GET /__scheduled` on loopback in wrangler dev. */
export async function runScheduledTick(
  env: Env,
  opts?: { forceWatchlist?: boolean },
): Promise<void> {
  const hourCT = getChicagoHour();
  console.log(`scheduled tick Chicago hour=${hourCT}`);

  // Watchlist runs once per ~24h regardless of which hour wins; cheap no-op
  // when fresh (just a KV read).
  try {
    const slugs = await refreshWatchlistIfDue(env, { force: opts?.forceWatchlist === true });
    if (slugs.length > 0) {
      console.log(`watchlist refresh persisted=${slugs.length}`);
    } else if (opts?.forceWatchlist) {
      console.log('watchlist refresh forced but persisted=0');
    }
  } catch (e) {
    console.error('watchlist refresh error', e);
  }

  try {
    await syncDigestReactions(env);
  } catch (e) {
    console.error('reaction sync error', e);
  }

  try {
    const stats = await runIngest(env);
    console.log(`ingest done inserted=${stats.inserted} skippedDup=${stats.skippedDup}`);
  } catch (e) {
    console.error('ingest error', e);
  }

  try {
    const m = await runMarketSnapshotsAndStrategyB(env);
    console.log(
      `snapshots done snapshotted=${m.snapshotted} flagged=${m.flagged} market_driven=${m.marketDriven}`,
    );
  } catch (e) {
    console.error('snapshots/strategy-B error', e);
  }

  if (!isDigestHour()) {
    return;
  }

  try {
    await deliverDigest(env, hourCT);
  } catch (e) {
    console.error('digest error', e);
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    // Local dev: SPA assets would otherwise swallow `/__scheduled`. Only loopback — not deployed abuse.
    if (
      req.method === 'GET' &&
      url.pathname === '/__scheduled' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    ) {
      // Full tick can take many minutes (RSS × embeds × optional GLM/Kimi). Do not block the HTTP response.
      ctx.waitUntil(
        runScheduledTick(env).catch((e) => {
          console.error('runScheduledTick failed', e);
        }),
      );
      return Response.json(
        {
          ok: true,
          accepted: true,
          note:
            'Hourly pipeline running in background (waitUntil). Watch wrangler logs for `ingest done` or query local D1 after a few minutes.',
        },
        { status: 202 },
      );
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, service: 'anything-interesting' });
    }
    if (req.method === 'POST' && url.pathname === '/ops/cluster-eval/prepare') {
      const t = req.headers.get('X-Ops-Token');
      if (!env.OPS_TOKEN || t !== env.OPS_TOKEN) {
        return new Response('forbidden', { status: 403 });
      }
      let body: { hours?: number; limit?: number } = {};
      try {
        if (req.headers.get('content-type')?.includes('application/json')) {
          body = (await req.json()) as typeof body;
        }
      } catch {
        return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
      }
      try {
        const prepared = await prepareClusterEval(env, body);
        return Response.json({ ok: true, ...prepared });
      } catch (e) {
        console.error('ops cluster-eval prepare failed', e);
        return Response.json(
          { ok: false, error: e instanceof Error ? e.message : String(e) },
          { status: 500 },
        );
      }
    }
    if (req.method === 'POST' && url.pathname === '/ops/cluster-eval/run') {
      const t = req.headers.get('X-Ops-Token');
      if (!env.OPS_TOKEN || t !== env.OPS_TOKEN) {
        return new Response('forbidden', { status: 403 });
      }
      let body: {
        evalId?: string;
        preset?: string;
        kimiBudget?: number;
        skipKimi?: boolean;
        skipGlm?: boolean;
      } = {};
      try {
        body = (await req.json()) as typeof body;
      } catch {
        return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
      }
      if (!body.evalId || !body.preset) {
        return Response.json({ ok: false, error: 'evalId and preset required' }, { status: 400 });
      }
      try {
        const result = await runClusterEvalPreset(env, {
          evalId: body.evalId,
          preset: body.preset,
          kimiBudget: body.kimiBudget,
          skipKimi: body.skipKimi,
          skipGlm: body.skipGlm,
        });
        return Response.json({ ok: true, ...result });
      } catch (e) {
        console.error('ops cluster-eval run failed', e);
        return Response.json(
          { ok: false, error: e instanceof Error ? e.message : String(e) },
          { status: 500 },
        );
      }
    }
    if (req.method === 'POST' && url.pathname === '/ops/cluster-eval') {
      const t = req.headers.get('X-Ops-Token');
      if (!env.OPS_TOKEN || t !== env.OPS_TOKEN) {
        return new Response('forbidden', { status: 403 });
      }
      let body: {
        hours?: number;
        limit?: number;
        preset?: string;
        presets?: string[];
        kimiBudget?: number;
        skipKimi?: boolean;
        skipGlm?: boolean;
      } = {};
      try {
        if (req.headers.get('content-type')?.includes('application/json')) {
          body = (await req.json()) as typeof body;
        }
      } catch {
        return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
      }
      try {
        const report = await runClusterEval(env, {
          hours: body.hours,
          limit: body.limit,
          presetNames: body.presets,
          preset: body.preset,
          kimiBudget: body.kimiBudget,
          skipKimi: body.skipKimi,
          skipGlm: body.skipGlm,
        });
        return Response.json(report);
      } catch (e) {
        console.error('ops cluster-eval failed', e);
        return Response.json(
          { ok: false, error: e instanceof Error ? e.message : String(e) },
          { status: 500 },
        );
      }
    }
    if (req.method === 'POST' && url.pathname === '/ops/refresh-watchlist') {
      const t = req.headers.get('X-Ops-Token');
      if (!env.OPS_TOKEN || t !== env.OPS_TOKEN) {
        return new Response('forbidden', { status: 403 });
      }
      // Must await: waitUntil is cut off before Gamma/Kimi/embed work finishes.
      try {
        const slugs = await refreshWatchlistIfDue(env, { force: true });
        const watchlistCursor = await env.CONFIG.get('cursors:watchlist_refreshed_at');
        console.log(`ops watchlist refresh persisted=${slugs.length} cursor=${watchlistCursor}`);
        const m = await runMarketSnapshotsAndStrategyB(env);
        console.log(
          `ops snapshots done snapshotted=${m.snapshotted} flagged=${m.flagged} market_driven=${m.marketDriven}`,
        );
        return Response.json({
          ok: true,
          watchlist_slugs: slugs.length,
          watchlist_cursor: watchlistCursor,
          snapshots: m,
        });
      } catch (e) {
        console.error('ops refresh-watchlist failed', e);
        return Response.json(
          { ok: false, error: e instanceof Error ? e.message : String(e) },
          { status: 500 },
        );
      }
    }
    if (req.method === 'POST' && url.pathname === '/interactions') {
      return handleDiscordInteraction(req, env, ctx);
    }
    if (url.pathname.startsWith('/api/')) {
      const apiRes = await handleApiRequest(req, env);
      if (apiRes) return apiRes;
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    const clusterSpaMatch = url.pathname.match(/^\/cluster\/([^/]+)$/);
    if (req.method === 'GET' && clusterSpaMatch) {
      return handleClusterSpaPage(req, env, clusterSpaMatch[1]);
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runScheduledTick(env);
  },
};

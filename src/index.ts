import { deliverDigest } from './digest';
import { runIngest } from './ingest';
import type { Env } from './env';
import { getChicagoHour, isDigestHour } from './chicago';
import { handleDiscordInteraction } from './interactions';
import { runMarketSnapshotsAndStrategyB } from './snapshots';
import { refreshWatchlistIfDue } from './watchlist';

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, service: 'anything-interesting' });
    }
    if (req.method === 'POST' && url.pathname === '/interactions') {
      return handleDiscordInteraction(req, env, ctx);
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const hourCT = getChicagoHour();
    console.log(`scheduled tick Chicago hour=${hourCT}`);

    // Watchlist runs once per ~24h regardless of which hour wins; cheap no-op
    // when fresh (just a KV read).
    try {
      const slugs = await refreshWatchlistIfDue(env);
      if (slugs.length > 0) {
        console.log(`watchlist refresh persisted=${slugs.length}`);
      }
    } catch (e) {
      console.error('watchlist refresh error', e);
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
  },
};

import { deliverDigest } from './digest';
import { runIngest } from './ingest';
import type { Env } from './env';
import { getChicagoHour, isDigestHour } from './chicago';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, service: 'anything-interesting' });
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const hourCT = getChicagoHour();
    console.log(`scheduled tick Chicago hour=${hourCT}`);

    try {
      const stats = await runIngest(env);
      console.log(`ingest done inserted=${stats.inserted} skippedDup=${stats.skippedDup}`);
    } catch (e) {
      console.error('ingest error', e);
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

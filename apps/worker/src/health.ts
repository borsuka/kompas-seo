import { createServer, type Server } from 'node:http';
import { sql } from '@seo/db';
import type { WorkerDeps } from './runtime.js';

async function check(fn: () => Promise<unknown>) {
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000).unref()),
    ]);
    return { status: 'ok' as const };
  } catch (err) {
    return { status: 'error' as const, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Minimal HTTP health endpoint for orchestrators: /health/live and /health/ready. */
export function startHealthServer(
  port: number,
  deps: WorkerDeps,
  isRunning: () => boolean,
): Server {
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health/live') {
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.url === '/health/ready') {
      const checks = {
        postgres: await check(() => deps.db.execute(sql`select 1`)),
        redis: await check(() => deps.redis.ping()),
        clickhouse: await check(async () => {
          const r = await deps.clickhouse.ping();
          if (!r.success) throw r.error;
        }),
        workers: isRunning()
          ? { status: 'ok' as const }
          : { status: 'error' as const, error: 'not running' },
      };
      const ok = Object.values(checks).every((c) => c.status === 'ok');
      res.statusCode = ok ? 200 : 503;
      res.end(JSON.stringify({ status: ok ? 'ok' : 'error', checks }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ code: 'NOT_FOUND', message: 'Not found' }));
  });
  server.listen(port);
  return server;
}

// Fastify server.
//   GET  /api/health
//   GET  /api/filters                 all Meta filter definitions
//   GET  /api/db/stats                persisted seen-ads / businesses counts
//   POST /api/runs                    { ...filters } -> creates a run
//   POST /api/runs/:id/start          begins the harvest→enrich→google pipeline
//   POST /api/runs/:id/stop           requests cancellation
//   GET  /api/runs/:id                snapshot (for late subscribers / refresh)
//   GET  /api/runs/:id/events         SSE stream
//   GET  /api/runs/:id/export         single CSV (only once the run is done)

import cors from '@fastify/cors';
import Fastify from 'fastify';
import { config } from './config.js';
import { db } from './db.js';
import { bus } from './eventStream.js';
import { FILTER_META, normalizeFilters } from './filters.js';
import { csvFilename, exportRun } from './exporter.js';
import { runPipeline, stopRun } from './orchestrator.js';
import { shutdown } from './scraper/engine.js';
import { store } from './store.js';

const app = Fastify({ logger: { level: 'info' } });
await app.register(cors, { origin: true });

await db.init();

app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));
app.get('/api/filters', async () => FILTER_META);
app.get('/api/db/stats', async () => db.stats());
app.post('/api/db/clear', async () => db.clear());

app.post('/api/runs', async (req, reply) => {
  const { filters, errors } = normalizeFilters(req.body || {});
  if (errors.length) return reply.code(400).send({ error: errors.join('; '), errors });
  const run = store.create(filters);
  return { runId: run.id, snapshot: store.snapshot(run) };
});

app.post('/api/runs/:id/start', async (req, reply) => {
  const run = store.get(req.params.id);
  if (!run) return reply.code(404).send({ error: 'run not found' });
  if (run.status === 'running') return reply.code(409).send({ error: 'already running' });
  runPipeline(run.id).catch(err => app.log.error(err, 'pipeline failed'));
  return { ok: true };
});

app.post('/api/runs/:id/stop', async (req, reply) => {
  if (!stopRun(req.params.id)) return reply.code(404).send({ error: 'run not found' });
  return { ok: true };
});

app.get('/api/runs/:id', async (req, reply) => {
  const run = store.get(req.params.id);
  if (!run) return reply.code(404).send({ error: 'run not found' });
  return store.snapshot(run);
});

app.get('/api/runs/:id/events', (req, reply) => {
  const run = store.get(req.params.id);
  if (!run) { reply.code(404).send({ error: 'run not found' }); return; }
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  reply.raw.write(`: connected ${new Date().toISOString()}\n\n`);
  bus.subscribe(req.params.id, reply);
  const heartbeat = setInterval(() => { try { reply.raw.write(': ping\n\n'); } catch {} }, 20000);
  reply.raw.on('close', () => clearInterval(heartbeat));
});

app.get('/api/runs/:id/export', async (req, reply) => {
  const run = store.get(req.params.id);
  if (!run) return reply.code(404).send({ error: 'run not found' });
  if (!(run.status === 'finished' || run.status === 'stopped')) {
    return reply.code(409).send({ error: 'run not finished yet' });
  }
  reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${csvFilename(run)}"`)
    .send(exportRun(run));
});

try {
  await app.listen({ port: config.port, host: '127.0.0.1' });
  app.log.info(`Meta Ad Library harvester listening on http://127.0.0.1:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

const cleanup = async () => {
  app.log.info('shutting down…');
  try { await app.close(); } catch {}
  try { await shutdown(); } catch {}
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

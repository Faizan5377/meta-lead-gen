// Fastify server.
//
//   GET  /api/health
//   GET  /api/filters                 all Meta filter definitions
//   GET  /api/library/stats           shared-library size + which store is live
//   GET  /api/library                 filtered slice of the library
//   GET  /api/library/facets          distinct values for the filter panel
//   GET  /api/library/export          CSV of a filtered slice
//   POST /api/library/clear           wipe the library (local + remote)
//   POST /api/runs                    { ...filters } -> creates a run
//   POST /api/runs/:id/start          begins the harvest pipeline
//   POST /api/runs/:id/stop           requests cancellation
//   GET  /api/runs/:id                snapshot (for late subscribers / refresh)
//   GET  /api/runs/:id/events         SSE stream
//   GET  /api/runs/:id/export         CSV of that run

import cors from '@fastify/cors';
import Fastify from 'fastify';
import { config } from './config.js';
import { bus } from './eventStream.js';
import { FILTER_META, normalizeFilters } from './filters.js';
import { csvFilename, exportRows, exportRun, libraryFilename } from './exporter.js';
import { library } from './library.js';
import { runPipeline, stopRun } from './orchestrator.js';
import { shutdown } from './scraper/engine.js';
import { store } from './store.js';

const app = Fastify({ logger: { level: 'info' } });
await app.register(cors, { origin: true });

await library.init();

app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));
app.get('/api/filters', async () => FILTER_META);

// ── Library ─────────────────────────────────────────────────────────────────
app.get('/api/library/stats', async () => library.stats());
app.post('/api/library/clear', async () => library.clear());

// Executions: the Library is organised as a list of runs, each expandable.
app.get('/api/library/runs', async (req, reply) => {
  try { return await library.listRuns({ search: req.query.search }); }
  catch (err) { return reply.code(500).send({ error: err.message }); }
});

app.get('/api/library/runs/:id/ads', async (req, reply) => {
  try { return await library.runAds(req.params.id); }
  catch (err) { return reply.code(500).send({ error: err.message }); }
});

app.patch('/api/library/runs/:id', async (req, reply) => {
  const name = (req.body?.name || '').trim();
  if (!name) return reply.code(400).send({ error: 'name is required' });
  try { return await library.renameRun(req.params.id, name); }
  catch (err) { return reply.code(500).send({ error: err.message }); }
});

app.delete('/api/library/runs/:id', async (req, reply) => {
  try { return await library.deleteRun(req.params.id); }
  catch (err) { return reply.code(500).send({ error: err.message }); }
});

app.get('/api/library/runs/:id/export', async (req, reply) => {
  try {
    const { rows } = await library.runAds(req.params.id);
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${libraryFilename()}"`)
      .send(exportRows(rows));
  } catch (err) { return reply.code(500).send({ error: err.message }); }
});

// Query params arrive as strings; coerce into the shape library.query expects.
function parseQuery(q = {}) {
  const list = (v) => (v === undefined || v === '' ? undefined
    : (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean));
  const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
  const bool = (v) => (v === undefined || v === '' ? undefined : v === 'true' || v === true);
  return {
    search: q.search || undefined,
    countries: list(q.countries),
    keywords: list(q.keywords),
    platforms: list(q.platforms),
    categories: list(q.categories),
    isActive: bool(q.isActive),
    hasWebsite: bool(q.hasWebsite),
    minFollowers: num(q.minFollowers),
    maxFollowers: num(q.maxFollowers),
    minDays: num(q.minDays),
    maxDays: num(q.maxDays),
    minAds: num(q.minAds),
    minRelevance: num(q.minRelevance),
    startedAfter: q.startedAfter || undefined,
    startedBefore: q.startedBefore || undefined,
    sort: q.sort || 'first_seen_at',
    dir: q.dir === 'asc' ? 'asc' : 'desc',
    limit: Math.min(Number(q.limit) || 100, 1000),
    offset: Number(q.offset) || 0,
  };
}

app.get('/api/library', async (req, reply) => {
  try {
    return await library.query(parseQuery(req.query));
  } catch (err) {
    return reply.code(500).send({ error: err.message });
  }
});

app.get('/api/library/export', async (req, reply) => {
  try {
    // Export the whole filtered set, not just the visible page.
    const { rows } = await library.query({ ...parseQuery(req.query), limit: 1000, offset: 0 });
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${libraryFilename()}"`)
      .send(exportRows(rows));
  } catch (err) {
    return reply.code(500).send({ error: err.message });
  }
});

// ── Runs ────────────────────────────────────────────────────────────────────
app.post('/api/runs', async (req, reply) => {
  const { filters, errors } = normalizeFilters(req.body || {});
  if (errors.length) return reply.code(400).send({ error: errors.join('; '), errors });
  const run = store.create(filters);
  // Name it up front so the execution is identifiable even while it's running,
  // and so a repeat of the same search is obviously a different execution.
  try {
    const { name, seq } = await library.nameRun(filters);
    run.name = name;
    run.seq = seq;
  } catch { run.name = (filters.keywords || []).join(', '); }
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
  // Allow export once the run has ended for any reason (including 'error') so a
  // partial failure never traps the data the user already collected.
  if (run.status === 'running' || run.status === 'idle') {
    return reply.code(409).send({ error: 'run not finished yet' });
  }
  reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${csvFilename(run)}"`)
    .send(exportRun(run));
});

try {
  await app.listen({ port: config.port, host: '127.0.0.1' });
  app.log.info(`Meta Ad Library scraper listening on http://127.0.0.1:${config.port}`);
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

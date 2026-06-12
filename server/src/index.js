// Fastify server. Endpoints:
//   GET  /api/health
//   GET  /api/locations
//   GET  /api/ad-categories
//   GET  /api/keyword-presets
//   POST /api/sessions               { location, locationCode, keywords[], adType }
//   POST /api/sessions/:id/start
//   POST /api/sessions/:id/stop
//   GET  /api/sessions/:id           snapshot for late subscribers
//   GET  /api/sessions/:id/events    SSE stream
//   GET  /api/sessions/:id/export    CSV (mode=ad|company, scope=hot_warm|all|everything)
//
// The session is created and started in one flow but split into two endpoints
// so the UI can subscribe to /events before the run begins (no missed events).

import cors from '@fastify/cors';
import Fastify from 'fastify';
import { config } from './config.js';
import { csvFilename, exportPerAd, exportPerCompany } from './csvExporter.js';
import { bus } from './eventStream.js';
import { KEYWORD_PRESETS } from './keywords.js';
import { AD_CATEGORIES, LOCATIONS } from './locations.js';
import { runContactEnrichment, runSession, stopContactEnrichment, stopSession } from './orchestrator.js';
import { shutdown } from './scraper/engine.js';
import { store } from './store.js';

const app = Fastify({ logger: { level: 'info' } });

await app.register(cors, { origin: true });

app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));

app.get('/api/locations', async () => LOCATIONS);
app.get('/api/ad-categories', async () => AD_CATEGORIES);
app.get('/api/keyword-presets', async () => KEYWORD_PRESETS);

app.post('/api/sessions', async (req, reply) => {
  const { location, locationCode, keywords, adType = 'all', mode = 'leadgen', maxCards = 200 } = req.body || {};
  if (!locationCode || !location) return reply.code(400).send({ error: 'location required' });
  if (!Array.isArray(keywords) || !keywords.length) return reply.code(400).send({ error: 'keywords required' });
  if (!LOCATIONS.find(l => l.code === locationCode)) return reply.code(400).send({ error: 'invalid locationCode' });
  if (!AD_CATEGORIES.find(c => c.value === adType)) return reply.code(400).send({ error: 'invalid adType' });

  const adTypeLabel = AD_CATEGORIES.find(c => c.value === adType)?.label || adType;
  const cleaned = keywords
    .map(k => String(k).trim())
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 50);
  const cap = Math.max(1, Math.min(500, Number(maxCards) || 200));

  const session = store.create({
    location, locationCode, keywords: cleaned, adType, adTypeLabel,
    mode: mode === 'ecom' ? 'ecom' : 'leadgen', maxCards: cap,
  });
  return { sessionId: session.id, session: serializeSession(session) };
});

app.post('/api/sessions/:id/start', async (req, reply) => {
  const session = store.get(req.params.id);
  if (!session) return reply.code(404).send({ error: 'session not found' });
  if (session.status === 'running') return reply.code(409).send({ error: 'already running' });

  // Start asynchronously — caller doesn't wait for the whole scrape.
  runSession(session.id).catch(err => app.log.error(err, 'session run failed'));
  return { ok: true };
});

app.post('/api/sessions/:id/stop', async (req, reply) => {
  const ok = stopSession(req.params.id);
  if (!ok) return reply.code(404).send({ error: 'session not found' });
  return { ok: true };
});

app.post('/api/sessions/:id/enrich-contacts', async (req, reply) => {
  const session = store.get(req.params.id);
  if (!session) return reply.code(404).send({ error: 'session not found' });
  if (session.contactEnriching) return reply.code(409).send({ error: 'contact enrichment already running' });
  runContactEnrichment(session.id).catch(err => app.log.error(err, 'contact enrichment failed'));
  return { ok: true };
});

app.post('/api/sessions/:id/stop-contacts', async (req, reply) => {
  const ok = stopContactEnrichment(req.params.id);
  if (!ok) return reply.code(404).send({ error: 'session not found' });
  return { ok: true };
});

app.get('/api/sessions/:id', async (req, reply) => {
  const session = store.get(req.params.id);
  if (!session) return reply.code(404).send({ error: 'session not found' });
  return serializeSession(session);
});

app.get('/api/sessions/:id/events', (req, reply) => {
  const session = store.get(req.params.id);
  if (!session) {
    reply.code(404).send({ error: 'session not found' });
    return;
  }
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  reply.raw.write(`: connected ${new Date().toISOString()}\n\n`);

  bus.subscribe(req.params.id, reply);

  // Heartbeat every 20s so the connection isn't reaped by intermediaries.
  const heartbeat = setInterval(() => {
    try { reply.raw.write(`: ping\n\n`); } catch {}
  }, 20000);
  reply.raw.on('close', () => clearInterval(heartbeat));
});

app.get('/api/sessions/:id/export', async (req, reply) => {
  const session = store.get(req.params.id);
  if (!session) return reply.code(404).send({ error: 'session not found' });
  const mode = req.query.mode === 'company' ? 'company' : 'ad';
  const scope = ['hot_warm', 'all', 'everything'].includes(req.query.scope) ? req.query.scope : 'hot_warm';
  const csv = mode === 'company' ? exportPerCompany(session, { scope }) : exportPerAd(session, { scope });
  reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${csvFilename(session, mode)}"`)
    .send(csv);
});

function serializeSession(session) {
  return {
    id: session.id,
    createdAt: session.createdAt,
    status: session.status,
    location: session.location,
    locationCode: session.locationCode,
    adType: session.adType,
    adTypeLabel: session.adTypeLabel,
    mode: session.mode,
    maxCards: session.maxCards,
    keywords: session.keywords,
    currentKeywordIndex: session.currentKeywordIndex,
    currentKeyword: session.currentKeyword,
    totalLeads: session.leads.length,
    tierCounts: store.tierCounts(session),
    leads: session.leads,
    finishedAt: session.finishedAt,
    stoppedAt: session.stoppedAt,
  };
}

try {
  await app.listen({ port: config.port, host: '127.0.0.1' });
  app.log.info(`Ventix Meta Leads server listening on http://127.0.0.1:${config.port}`);
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

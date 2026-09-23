// Pipeline for one Maps run: harvest -> save.
//
// Same guarantees as the Ad Library scraper:
//   • the target is a HARD ceiling — exactly N places, never more
//   • places already in the shared library are skipped, so each run returns
//     only NEW businesses
//   • results are saved in one batch at the end, including when the run is
//     stopped early or errors, so collected work is never lost
//   • no phase can crash the run

import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { bus } from '../eventStream.js';
import { placesLibrary } from './library.js';
import { harvest } from './engine.js';

const runs = new Map();

export function createRun(filters) {
  const run = {
    id: randomUUID(),
    kind: 'maps',
    name: null,
    createdAt: new Date().toISOString(),
    status: 'idle',            // idle | running | finished | stopped | error
    phase: 'idle',             // idle | searching | saving | done
    filters,
    target: filters.target,
    places: [],
    byId: new Map(),           // feature id -> place
    counts: { found: 0, kept: 0, skippedKnown: 0, skippedNoPhone: 0 },
    cancelRequested: false,
    startedAt: null, finishedAt: null, stoppedAt: null,
    errors: [],
  };
  runs.set(run.id, run);
  return run;
}

export const getRun = (id) => runs.get(id);

export function snapshot(run) {
  return {
    id: run.id, kind: 'maps', name: run.name, createdAt: run.createdAt,
    status: run.status, phase: run.phase, filters: run.filters, target: run.target,
    counts: run.counts, places: run.places, errors: run.errors.slice(-100),
    startedAt: run.startedAt, finishedAt: run.finishedAt, stoppedAt: run.stoppedAt,
    saveResult: run.saveResult || null,
    exportReady: ['finished', 'stopped', 'error'].includes(run.status),
  };
}

export function stopRun(id) {
  const run = runs.get(id);
  if (!run) return false;
  run.cancelRequested = true;
  return true;
}

export async function runPipeline(runId) {
  const run = runs.get(runId);
  if (!run) return;
  run.status = 'running';
  run.startedAt = new Date().toISOString();
  run.phase = 'searching';
  emit(runId, { type: 'run_started', snapshot: snapshot(run) });

  try {
    await searchPhase(run);
    await savePhase(run);
    finalize(run, run.cancelRequested ? 'stopped' : 'finished');
  } catch (err) {
    run.errors.push({ scope: 'pipeline', message: err.message, ts: now() });
    try { await savePhase(run); } catch {}
    finalize(run, 'error', err.message);
  }
}

async function searchPhase(run) {
  run.phase = 'searching';
  emit(run.id, { type: 'phase_started', phase: 'searching', target: run.target });

  const requirePhone = run.filters.requirePhone === true;
  const requireWebsite = run.filters.requireWebsite === true;
  const minRating = Number(run.filters.minRating) || 0;
  const minReviews = Number(run.filters.minReviews) || 0;

  await harvest({
    filters: run.filters,
    shouldStop: () => run.cancelRequested || run.counts.kept >= run.target,
    onPlace: (p) => {
      run.counts.found++;

      // Already collected in a previous run — never resurface it.
      if (placesLibrary.has(p.feature_id, p.place_id)) {
        run.counts.skippedKnown++;
        return true;
      }
      // Same place from another query in THIS run.
      if (run.byId.has(p.feature_id)) return true;

      // Quality gates. Filtered places don't consume the target, so the run
      // still returns exactly the number asked for.
      if ((requirePhone && !p.phone)
        || (requireWebsite && !p.website)
        || (minRating && (p.rating ?? 0) < minRating)
        || (minReviews && (p.review_count ?? 0) < minReviews)) {
        run.counts.skippedNoPhone++;
        emit(run.id, { type: 'place_rejected', name: p.name, counts: run.counts });
        return true;
      }

      // Hard ceiling.
      if (run.places.length >= run.target) return false;

      run.places.push(p);
      run.byId.set(p.feature_id, p);
      run.counts.kept = run.places.length;
      placesLibrary.note(p.feature_id, p.place_id);
      emit(run.id, { type: 'place_added', place: p, counts: run.counts });
      return run.places.length < run.target;
    },
    // The rail finishes rendering after places have already streamed out, so
    // patch review counts onto what we kept rather than losing them.
    onReviewCounts: (counts) => {
      let patched = 0;
      for (const [fid, rc] of counts) {
        const p = run.byId.get(fid);
        if (p && p.review_count == null && rc != null) { p.review_count = rc; patched++; }
      }
      if (patched) emit(run.id, { type: 'places_patched', patched, snapshot: snapshot(run) });
    },
    onProgress: (info) => emit(run.id, {
      type: 'search_progress', query: info.query,
      found: run.counts.found, kept: run.counts.kept,
      skippedKnown: run.counts.skippedKnown, target: run.target,
    }),
    onError: (info) => {
      const kind = info.scope === 'no_results' ? 'notice' : 'error';
      run.errors.push({ scope: info.scope, message: info.message, kind, ts: now() });
      emit(run.id, { type: kind, scope: info.scope, message: info.message, recoverable: true });
    },
  }).catch((err) => {
    run.errors.push({ scope: 'search', message: err.message, ts: now() });
    emit(run.id, { type: 'error', scope: 'search', message: err.message, recoverable: true });
  });

  emit(run.id, { type: 'phase_done', phase: 'searching', kept: run.counts.kept });
}

async function savePhase(run) {
  if (run.saved) return;
  run.phase = 'saving';
  emit(run.id, { type: 'phase_started', phase: 'saving', total: run.places.length });
  try {
    const res = await placesLibrary.save(run.places, run.id);
    run.saved = true;
    run.saveResult = res;
    emit(run.id, { type: 'phase_done', phase: 'saving', saved: res.saved, remote: res.remote });
  } catch (err) {
    run.errors.push({ scope: 'save', message: err.message, ts: now() });
    emit(run.id, { type: 'error', scope: 'save', message: err.message, recoverable: true });
  }
}

function finalize(run, status, message) {
  run.status = status;
  run.phase = 'done';
  run.finishedAt = now();
  if (status === 'stopped') run.stoppedAt = now();
  placesLibrary.saveRun(run).catch(() => {});
  emit(run.id, {
    type: 'run_finished', status, message: message || null,
    counts: run.counts, saveResult: run.saveResult || null, snapshot: snapshot(run),
  });
}

function emit(runId, ev) { bus.emit(runId, ev); }
function now() { return new Date().toISOString(); }
export { config };

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
import { judge } from './quality.js';

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
    seen: new Set(),           // every feature id considered, kept or not
    categories: new Map(),     // what Google calls this niche — learned, never hardcoded
    counts: { found: 0, kept: 0, skippedKnown: 0, skippedFiltered: 0 },
    rejectReasons: new Map(),  // reason -> how many, for the shortfall advice
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
    // The exact tally, so a reloaded page shows what the filters dropped
    // rather than only what has streamed in since.
    rejectReasons: Object.fromEntries(run.rejectReasons),
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

  const quality = run.filters.quality;

  await harvest({
    filters: run.filters,
    shouldStop: () => run.cancelRequested || run.counts.kept >= run.target,
    // Google caps one search at ~120 results, so a strict quality gate can
    // leave a target unfilled. This tells the engine to sweep nearby viewports
    // — but only while the target is genuinely short.
    needsMore: () => !run.cancelRequested && run.counts.kept < run.target,
    relatedTerms: () => learnedCategories(run),
    onPlace: (p) => {
      // The area sweep deliberately re-runs the same search over overlapping
      // viewports, so one business arrives several times. Count it once, or
      // every tally in the UI inflates.
      if (run.seen.has(p.feature_id)) return true;
      run.seen.add(p.feature_id);
      run.counts.found++;

      // Judge first, but only to learn from it — a business we already have, or
      // one that just misses the quality bar, still tells us what this niche is
      // called, and that is what the related searches are built from.
      const verdict = judge(p, quality);
      noteCategory(run, p, verdict);

      // Already collected in a previous run — never resurface it.
      if (placesLibrary.has(p.feature_id, p.place_id)) {
        run.counts.skippedKnown++;
        return true;
      }

      // Quality gate. Filtered places don't consume the target, so the run
      // still returns exactly the number asked for.
      if (!verdict.keep) {
        run.counts.skippedFiltered++;
        // Reasons carry numbers ("rating 4.2 < 4.5"); group on the wording so
        // the tally points at the filter, not at every distinct value.
        const key = verdict.reason.replace(/-?\d[\d.,]*/g, 'N');
        run.rejectReasons.set(key, (run.rejectReasons.get(key) || 0) + 1);
        emit(run.id, { type: 'place_rejected', name: p.name, reason: verdict.reason, counts: run.counts });
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

  if (!run.cancelRequested && run.counts.kept < run.target) adviseOnShortfall(run);
  emit(run.id, { type: 'phase_done', phase: 'searching', kept: run.counts.kept });
}

// Rejections that mean "wrong kind of business" rather than "not good enough".
// Only these disqualify a place from teaching the run what the niche looks like.
const OFF_NICHE = new Set(['name excluded', 'category excluded', 'category not in list']);

// Remember what Google calls this kind of business.
//
// Deliberately counts places the quality gate REJECTED too: a plumber with 12
// reviews is still a plumber, and learning only from survivors starves the
// learner exactly when it's needed most — a strict gate keeps so few that no
// category ever gets a second vote.
//
// Only the PRIMARY category is learned. Secondary ones are where the drift
// lives: a plumber also carries "Contractor", which would pull in roofers.
export function noteCategory(run, place, verdict = { keep: true }) {
  if (!verdict.keep && OFF_NICHE.has(verdict.reason)) return;
  const c = (place.category || '').trim();
  if (c) run.categories.set(c, (run.categories.get(c) || 0) + 1);
}

// Those categories as extra search terms, commonest first. Same principle as the
// Ad Library's niche gate: learn the vertical from the data, never hardcode it —
// and one business is not evidence.
export function learnedCategories(run, max = 6) {
  return [...run.categories.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([c]) => c);
}

// A run that stops short is not a failure — Google's supply for one search is
// finite. But finishing at 9 of 100 with no explanation is indistinguishable
// from a bug, so say exactly which lever to pull.
export function adviseOnShortfall(run) {
  const { kept, skippedFiltered, skippedKnown } = run.counts;
  const parts = [`Google had no more results for this search — finished with ${kept} of ${run.target}.`];

  const worst = [...run.rejectReasons.entries()].sort((a, b) => b[1] - a[1])[0];
  if (worst && skippedFiltered >= Math.max(10, kept)) {
    parts.push(`${skippedFiltered} were dropped by your quality gates, mostly “${worst[0]}” (${worst[1]}) — loosening that one filter would help most.`);
  }
  if (skippedKnown >= Math.max(10, kept)) {
    parts.push(`${skippedKnown} were already in your library from earlier runs.`);
  }
  if (run.filters.autoExpand === false) {
    parts.push('Turning on “widen the search” lets the same search sweep neighbouring areas, which is the only way past Google’s ~120-result cap per search.');
  } else if ((run.filters.expandRing || 1) < 3) {
    parts.push('Searching further out, or adding more search terms, would widen the supply.');
  } else {
    parts.push('Adding more search terms is the biggest remaining lever — each one gets its own set of results.');
  }

  const message = parts.join(' ');
  run.errors.push({ scope: 'shortfall', message, kind: 'notice', ts: now() });
  emit(run.id, { type: 'notice', scope: 'shortfall', message });
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

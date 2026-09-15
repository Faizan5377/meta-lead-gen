// The automatic pipeline for one run:
//
//   1. Harvest  — pull ads off the Ad Library feed, drop anything already in the
//                 shared library or outside the searched niche, and stop the
//                 moment the target is hit.
//   2. Enrich   — optional: open each advertiser's ad-details panel for the
//                 Instagram handle and follower count the feed doesn't carry.
//   3. Save     — write the run to the shared library in one batch.
//
// Every phase is wrapped so a failure never crashes the run; per-item errors are
// logged and streamed, and the pipeline always finalizes. Results are saved even
// when the run is stopped early or errors, so collected work is never lost.

import { config } from './config.js';
import { bus } from './eventStream.js';
import { COUNTRIES } from './filters.js';
import { library } from './library.js';
import { createRelevanceGate } from './relevance.js';
import { store } from './store.js';
import { harvest, newPage } from './scraper/engine.js';
import { scrapeAdvertiserDetails } from './scraper/advertiserScraper.js';

const countryName = (code) => COUNTRIES.find((c) => c.code === code)?.name || code;

export async function runPipeline(runId) {
  const run = store.get(runId);
  if (!run) return;
  run.status = 'running';
  run.startedAt = new Date().toISOString();
  run.phase = 'harvesting';
  run.seenForLibrary = [];
  emit(runId, { type: 'run_started', snapshot: store.snapshot(run) });

  try {
    await harvestPhase(run);
    if (!run.cancelRequested && run.filters.deepEnrich) await enrichPhase(run);
    await savePhase(run);
    finalize(run, run.cancelRequested ? 'stopped' : 'finished');
  } catch (err) {
    run.errors.push({ scope: 'pipeline', message: err.message, ts: now() });
    // Still try to keep whatever was collected.
    try { await savePhase(run); } catch {}
    finalize(run, 'error', err.message);
  }
}

// ── Phase 1: harvest ─────────────────────────────────────────────────────────
async function harvestPhase(run) {
  run.phase = 'harvesting';
  emit(run.id, { type: 'phase_started', phase: 'harvesting', target: run.target });

  // One gate per run: it learns this niche's categories as the harvest proceeds.
  const relevance = config.relevance.enabled && run.filters.relevanceEnabled !== false
    ? createRelevanceGate({
      keywords: run.filters.keywords,
      extraTerms: run.filters.nicheTerms || [],
      minScore: run.filters.minRelevance ?? config.relevance.minScore,
    })
    : null;
  run.relevance = relevance;

  await harvest({
    filters: run.filters,
    shouldStop: () => run.cancelRequested || run.counts.kept >= run.target,
    onAd: (rec) => {
      const res = store.considerAd(run, rec, relevance);

      if (res.status === 'added' || res.status === 'updated') {
        library.note(rec.library_id, res.business.business_key);
        emit(run.id, {
          type: res.status === 'added' ? 'business_added' : 'business_updated',
          business: res.business, counts: run.counts,
        });
        return;
      }

      // Remember ads we rejected so a later run doesn't re-evaluate them.
      if (res.irrelevant) {
        run.seenForLibrary.push({ library_id: rec.library_id, page_id: rec.page_id, outcome: 'irrelevant' });
        emit(run.id, {
          type: 'ad_rejected',
          page_name: rec.page_name,
          score: res.verdict?.score ?? null,
          reason: res.verdict?.reason || null,
          counts: run.counts,
        });
      }
    },
    onProgress: (info) => {
      emit(run.id, {
        type: 'harvest_progress',
        country: countryName(info.country), keyword: info.keyword,
        rawSeen: run.counts.rawSeen, kept: run.counts.kept,
        skippedKnown: run.counts.skippedKnown,
        skippedIrrelevant: run.counts.skippedIrrelevant,
        target: run.target,
      });
    },
    onError: (info) => {
      // "no results for this keyword" is normal, not a failure.
      const kind = info.scope === 'no_results' ? 'notice' : 'error';
      run.errors.push({ scope: info.scope, message: info.message, kind, ts: now() });
      emit(run.id, { type: kind, scope: info.scope, message: info.message, recoverable: true });
    },
  }).catch((err) => {
    run.errors.push({ scope: 'harvest', message: err.message, ts: now() });
    emit(run.id, { type: 'error', scope: 'harvest', message: err.message, recoverable: true });
  });

  emit(run.id, {
    type: 'phase_done', phase: 'harvesting',
    kept: run.counts.kept,
    nicheProfile: relevance?.profile() || null,
  });
}

// ── Phase 2: advertiser details (optional) ───────────────────────────────────
// The feed carries Facebook followers but not Instagram; those only exist in the
// ad-details panel, which costs a page visit per advertiser. Off by default.
async function enrichPhase(run) {
  run.phase = 'enriching';
  const targets = run.businesses.filter((b) => b.library_id);
  emit(run.id, { type: 'phase_started', phase: 'enriching', total: targets.length });
  if (!targets.length) { emit(run.id, { type: 'phase_done', phase: 'enriching', done: 0 }); return; }

  await runPool(targets, config.enrichConcurrency, run, async (page, biz) => {
    let patch;
    try {
      patch = await scrapeAdvertiserDetails(page, biz.library_id);
    } catch (err) {
      patch = {};
      run.errors.push({ scope: 'enrich', business: biz.page_name, message: err.message, ts: now() });
    }
    store.patchBusiness(run, biz.business_key, patch);
    run.counts.enrichedDone++;
    emit(run.id, {
      type: 'business_enriched', business_key: biz.business_key, patch,
      done: run.counts.enrichedDone, total: targets.length, current: biz.page_name,
    });
  });

  emit(run.id, { type: 'phase_done', phase: 'enriching', done: run.counts.enrichedDone });
}

// ── Phase 3: save to the shared library ──────────────────────────────────────
async function savePhase(run) {
  if (run.saved) return;
  run.phase = 'saving';
  emit(run.id, { type: 'phase_started', phase: 'saving', total: run.businesses.length });
  try {
    const res = await library.save(run.businesses, run.id);
    await library.noteSeen(run.seenForLibrary || [], run.id);
    run.saved = true;
    run.saveResult = res;
    emit(run.id, { type: 'phase_done', phase: 'saving', saved: res.saved, remote: res.remote });
  } catch (err) {
    run.errors.push({ scope: 'save', message: err.message, ts: now() });
    emit(run.id, { type: 'error', scope: 'save', message: err.message, recoverable: true });
  }
}

// ── Shared worker pool ───────────────────────────────────────────────────────
async function runPool(items, concurrency, run, worker) {
  const queue = items.slice();
  const n = Math.min(Math.max(1, concurrency), queue.length);
  const workers = [];
  for (let i = 0; i < n; i++) {
    workers.push((async () => {
      let page;
      try { page = await newPage(); }
      catch (err) {
        run.errors.push({ scope: 'browser', message: `Could not open a page: ${err.message}`, ts: now() });
        return;
      }
      try {
        while (queue.length) {
          if (run.cancelRequested) return;
          const item = queue.shift();
          try { await worker(page, item); }
          catch (err) { run.errors.push({ scope: 'worker', message: err.message, ts: now() }); }
        }
      } finally {
        try { await page?.close(); } catch {}
      }
    })());
  }
  await Promise.all(workers);
}

// ── helpers ──────────────────────────────────────────────────────────────────
function finalize(run, status, message) {
  run.status = status;
  run.phase = 'done';
  run.finishedAt = now();
  if (status === 'stopped') run.stoppedAt = now();
  library.saveRun(run).catch(() => {});
  emit(run.id, {
    type: 'run_finished', status, message: message || null,
    counts: run.counts, saveResult: run.saveResult || null,
    snapshot: store.snapshot(run),
  });
}

export function stopRun(runId) {
  const run = store.get(runId);
  if (!run) return false;
  run.cancelRequested = true;
  return true;
}

function emit(runId, ev) { bus.emit(runId, ev); }
function now() { return new Date().toISOString(); }

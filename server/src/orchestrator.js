// The automatic pipeline for one run, in sequence:
//   1. Harvest   — collect unique businesses (one longest-running ad each),
//                  skipping anything already in the DB, up to the target.
//   2. Contacts  — visit each business's Facebook page for email/phone/website.
//   3. Owners    — Hunter.io decision-maker lookup, falling back to search
//                  engines and the company's own About page.
//   4. Done      — export becomes available.
//
// Every phase is wrapped so a failure never crashes the run; per-item errors are
// logged and streamed, and the pipeline always finalizes.

import { config } from './config.js';
import { db } from './db.js';
import { bus } from './eventStream.js';
import { COUNTRIES } from './filters.js';
import { store } from './store.js';
import { hunter } from './enrich/hunter.js';
import { resolveOwner } from './enrich/ownerResolver.js';
import { scrapeFacebookContact } from './scraper/contactScraper.js';
import { harvest, newPage } from './scraper/engine.js';

const countryName = (code) => COUNTRIES.find(c => c.code === code)?.name || code;

export async function runPipeline(runId) {
  const run = store.get(runId);
  if (!run) return;
  run.status = 'running';
  run.startedAt = new Date().toISOString();
  run.phase = 'harvesting';
  emit(runId, { type: 'run_started', snapshot: store.snapshot(run) });

  try {
    // Read the live Hunter credit balance before spending anything, so the run
    // (and the UI) knows up front whether paid lookups are available.
    if (config.ownerEnrichEnabled) {
      run.hunter = await hunter.preflight();
      emit(runId, { type: 'hunter_state', hunter: run.hunter });
    }

    await harvestPhase(run);
    if (!run.cancelRequested) await contactsPhase(run);
    if (!run.cancelRequested && config.ownerEnrichEnabled) await ownersPhase(run);
    finalize(run, run.cancelRequested ? 'stopped' : 'finished');
  } catch (err) {
    run.errors.push({ scope: 'pipeline', message: err.message, ts: now() });
    finalize(run, 'error', err.message);
  }
}

// ── Phase 1: harvest ─────────────────────────────────────────────────────────
async function harvestPhase(run) {
  run.phase = 'harvesting';
  emit(run.id, { type: 'phase_started', phase: 'harvesting', target: run.target });

  await harvest({
    filters: run.filters,
    shouldStop: () => run.cancelRequested || run.counts.kept >= run.target,
    onAd: (rec) => {
      const res = store.considerAd(run, rec);
      if (res.status === 'added') {
        db.markSeen(rec.library_id, res.business.business_key, run.id);
        persist(run, res.business);
        emit(run.id, { type: 'business_added', business: res.business, counts: run.counts });
      } else if (res.status === 'updated') {
        db.markSeen(rec.library_id, res.business.business_key, run.id);
        persist(run, res.business);
        emit(run.id, { type: 'business_updated', business: res.business, counts: run.counts });
      }
    },
    onProgress: (info) => {
      emit(run.id, {
        type: 'harvest_progress',
        country: countryName(info.country), keyword: info.keyword,
        rawSeen: run.counts.rawSeen,
        kept: run.counts.kept, skippedKnown: run.counts.skippedKnown, target: run.target,
      });
    },
    onError: (info) => {
      // "no results for this keyword" is normal, not a failure — surface it as
      // an informational notice so one empty keyword doesn't look like a crash.
      const kind = info.scope === 'no_results' ? 'notice' : 'error';
      run.errors.push({ scope: info.scope, message: info.message, kind, ts: now() });
      emit(run.id, { type: kind, scope: info.scope, message: info.message, recoverable: true });
    },
  }).catch((err) => {
    run.errors.push({ scope: 'harvest', message: err.message, ts: now() });
    emit(run.id, { type: 'error', scope: 'harvest', message: err.message, recoverable: true });
  });

  emit(run.id, { type: 'phase_done', phase: 'harvesting', kept: run.counts.kept });
}

// ── Phase 2: Facebook contact enrichment ─────────────────────────────────────
async function contactsPhase(run) {
  run.phase = 'contacts';
  const targets = run.businesses.filter(b => b.page_url && /facebook\.com/.test(b.page_url));
  emit(run.id, { type: 'phase_started', phase: 'contacts', total: targets.length });
  if (!targets.length) { emit(run.id, { type: 'phase_done', phase: 'contacts', done: 0 }); return; }

  await runPool(targets, config.enrichConcurrency, run, async (page, biz) => {
    store.patchBusiness(run, biz.business_key, { contact_status: 'pending' });
    emit(run.id, { type: 'contact_progress', current: biz.page_name, done: run.counts.contactsDone, total: targets.length });
    let patch;
    try {
      patch = await scrapeFacebookContact(page, biz.page_url);
    } catch (err) {
      patch = { contact_status: 'failed' };
      logItemError(run, 'contact', biz, err);
    }
    store.patchBusiness(run, biz.business_key, patch);
    db.updateBusiness(biz.business_key, patch);
    run.counts.contactsDone++;
    emit(run.id, {
      type: 'business_enriched', business_key: biz.business_key, patch,
      done: run.counts.contactsDone, total: targets.length,
    });
  });

  emit(run.id, { type: 'phase_done', phase: 'contacts', done: run.counts.contactsDone });
}

// ── Phase 3: owner enrichment (Hunter.io → search → website) ─────────────────
async function ownersPhase(run) {
  run.phase = 'owners';
  const targets = run.businesses.filter(b => b.page_name);
  emit(run.id, { type: 'phase_started', phase: 'owners', total: targets.length, hunter: hunter.budgetState() });
  if (!targets.length) { emit(run.id, { type: 'phase_done', phase: 'owners', done: 0 }); return; }

  await runPool(targets, Math.min(2, config.enrichConcurrency), run, async (page, biz) => {
    store.patchBusiness(run, biz.business_key, { owner_status: 'pending' });
    emit(run.id, { type: 'owner_progress', current: biz.page_name, done: run.counts.ownersDone, total: targets.length });
    let patch;
    try {
      // The contacts phase already found a website for many businesses; the
      // resolver uses it both as a Hunter domain and as an About-page source.
      patch = await resolveOwner(page, biz, {
        countryCode: biz.country,
        countryName: countryName(biz.country),
        log: (msg) => run.log?.push?.(msg),
      });
    } catch (err) {
      patch = { owner_status: 'failed' };
      logItemError(run, 'owners', biz, err);
    }
    delete patch.owner_error;
    store.patchBusiness(run, biz.business_key, patch);
    db.updateBusiness(biz.business_key, patch);
    run.counts.ownersDone++;
    run.hunter = hunter.budgetState();
    emit(run.id, {
      type: 'business_owner', business_key: biz.business_key, patch,
      done: run.counts.ownersDone, total: targets.length, hunter: run.hunter,
    });
  });

  emit(run.id, { type: 'phase_done', phase: 'owners', done: run.counts.ownersDone, hunter: hunter.budgetState() });
}

// ── Shared worker pool ───────────────────────────────────────────────────────
// Runs `worker(page, item)` over items with N reusable pages, honoring cancel.
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
function persist(run, business) {
  db.upsertBusiness({ ...business, run_id: run.id });
}

function logItemError(run, scope, biz, err) {
  run.errors.push({ scope, business: biz.page_name, message: err.message, ts: now() });
  emit(run.id, { type: 'error', scope, message: `${biz.page_name}: ${err.message}`, recoverable: true });
}

function finalize(run, status, message) {
  run.status = status;
  run.phase = 'done';
  run.finishedAt = now();
  if (status === 'stopped') run.stoppedAt = now();
  emit(run.id, {
    type: 'run_finished', status, message: message || null,
    counts: run.counts, dbStats: db.stats(), hunter: hunter.budgetState(),
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

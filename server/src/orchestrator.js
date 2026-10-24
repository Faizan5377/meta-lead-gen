// The automatic pipeline for one run:
//
//   1. Harvest  — pull ads off the Ad Library feed, drop anything already in the
//                 shared library or outside the searched niche, and stop the
//                 moment the target is hit. Google Maps verification and the
//                 Hunter contact lookup run ALONGSIDE it, not after, because
//                 the target counts finished leads: the harvest cannot know
//                 when to stop until the last gate has had its say.
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
import { settledOrStalled } from './watchdog.js';
import { harvest, newPage } from './scraper/engine.js';
import { startVerification } from './verify/phase.js';
import { startEnrichment } from './enrich/phase.js';
import { fromMetaBusiness } from './leadSchema.js';
import { learnNiche } from './verify/niche.js';
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
    if (run.filters.verifyOnMaps && !run.cancelRequested) await nichePhase(run);
    await harvestPhase(run);
    if (!run.cancelRequested && run.filters.enrichAdvertisers === true) await enrichPhase(run);
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

  // Both gates run ALONGSIDE the harvest, not after it. Their workers consume
  // candidates as they arrive and only FINISHED leads — confirmed by Google and
  // carrying a decision maker — count toward the target, which is what lets the
  // harvest keep digging until the number the user asked for actually exists.
  const contacts = await startContacts(run);
  const verifier = run.filters.verifyOnMaps
    ? startVerification(run, {
      emit: (ev) => emit(run.id, ev),
      // Once the credits are gone no further candidate can ever be finished,
      // so paying for more Maps lookups buys nothing.
      shouldStop: () => !!contacts?.exhausted,
    })
    : null;
  if (verifier) emit(run.id, { type: 'phase_started', phase: 'verifying', target: run.target });

  // Set when the harvest is abandoned mid-flight. The promise cannot be
  // cancelled, so the records it may still deliver have to be ignored instead —
  // otherwise it mutates a run that has already been finalized and saved.
  let harvestAbandoned = false;

  const harvesting = harvest({
    filters: run.filters,
    // `counts.kept` is the live count of finished leads, so this reads "stop
    // when the user has what they asked for" — not "stop after N attempts".
    // The other three are the rails: a niche that will not convert, a credit
    // cap, and the Maps lookup ceiling all end the dig rather than extend it.
    shouldStop: () => run.cancelRequested
      || run.counts.kept >= run.target
      || run.counts.harvested >= run.candidateCeiling
      || !!contacts?.exhausted
      || !!verifier?.ranOutOfChecks(),
    onAd: (rec) => {
      if (harvestAbandoned) return;
      const res = store.considerAd(run, rec, relevance);

      if (res.status === 'added' || res.status === 'updated') {
        // A candidate is not a lead yet — noting it in the library here would
        // hide it from every future run even if Google or Hunter rejects it.
        // That happens once the run is over, in noteFinished().
        emit(run.id, {
          type: res.status === 'added' ? 'business_added' : 'business_updated',
          business: res.business, counts: run.counts,
          // Not a lead yet: the table hides it until the gates have had their say.
          pending: !store.isFinished(run, res.business),
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

  // A browser call can wedge with no error and no timeout, and the ceiling
  // inside the harvest loop cannot fire while the loop is blocked. Everything
  // below — the drains, the save — is queued behind this await, so without a
  // watchdog a single stuck page costs the whole run.
  if (!await settledOrStalled(harvesting, {
    progress: () => run.counts.rawSeen,
    abandonWhen: () => run.cancelRequested, stallMs: config.stallMs,
  })) {
    harvestAbandoned = true;
    stalled(run, 'harvest', `the Ad Library stopped returning ads. Carrying on with the `
      + `${run.counts.harvested} advertisers already collected.`);
  }

  // The feed is exhausted; let the workers drain what is still queued.
  if (verifier) {
    verifier.harvestFinished();
    if (run.cancelRequested) verifier.stop();
    if (!await settledOrStalled(verifier.promise, {
      progress: () => run.counts.verifiedDone,
    abandonWhen: () => run.cancelRequested, stallMs: config.stallMs,
    })) {
      verifier.stop();
      stalled(run, 'verify', `Google Maps stopped responding after `
        + `${run.counts.verifiedDone} lookups.`);
    }
    emit(run.id, {
      type: 'phase_done', phase: 'verifying',
      checked: run.counts.verifiedDone, kept: run.counts.kept,
    });
  }

  // Verification has stopped producing, so the contact queue is now final.
  if (contacts) await finishContacts(run, contacts);

  reportShortfall(run, { verifier, contacts });

  // Only now is a lead final. Noting it here is what makes the next run return
  // NEW leads: the advertiser and the ad both become "already collected".
  noteFinished(run);

  emit(run.id, {
    type: 'phase_done', phase: 'harvesting',
    kept: run.counts.kept, harvested: run.counts.harvested,
    nicheProfile: relevance?.profile() || null,
  });
}

// Leads that survived everything are recorded as collected; candidates that
// died on the way are recorded as seen, so a repeat search spends neither a
// Maps lookup nor a credit arriving at the same answer twice.
function noteFinished(run) {
  for (const b of store.keptBusinesses(run)) library.note(b.library_id, b.business_key);
}

// A run that asked for 150 and delivered 94 has to say which wall it hit.
// Without this the two possible explanations — "this niche is thin" and "the
// scraper is broken" — look identical from the outside, and the user cannot
// tell whether to widen the search, raise the credit cap, or report a bug.
function reportShortfall(run, { verifier, contacts }) {
  if (run.cancelRequested || run.counts.kept >= run.target) return;

  const wall = contacts?.exhausted
    ? `the Hunter credit cap (${run.counts.creditsUsed} searches) was reached`
    : verifier?.ranOutOfChecks()
      ? `the Google Maps safety ceiling (${run.counts.verifiedDone} lookups) was reached`
      : run.counts.harvested >= run.candidateCeiling
        ? `${run.counts.harvested} advertisers were checked without finding enough`
        : 'the Ad Library ran out of new ads for this search';

  // The gate that cost the most leads is the one worth acting on.
  const biggest = [...(run.contactDrops || new Map())].sort((a, b) => b[1] - a[1])[0];
  const because = biggest ? ` Most were lost to: ${biggest[0]} (${biggest[1]}).` : '';

  const msg = `Finished with ${run.counts.kept} of ${run.target} leads — ${wall}.`
    + ` ${run.counts.harvested} advertisers harvested, ${run.counts.skippedKnown} already in your library.`
    + because;
  run.errors.push({ scope: 'target', message: msg, kind: 'notice', ts: now() });
  emit(run.id, { type: 'notice', scope: 'target', message: msg });
}

// ── Phase 0: what is this trade called on Google? ───────────────────────────
// Skipped when you pinned the categories yourself, and when verification would
// not use them anyway.
async function nichePhase(run) {
  const v = run.filters.verify;
  if (v.niche.length || !v.nicheCheck) return;

  run.phase = 'learning';
  emit(run.id, { type: 'phase_started', phase: 'learning' });
  const categories = await learnNiche({
    keywords: run.filters.keywords,
    region: (run.filters.countries || []).find((c) => c && c !== 'ALL')?.toLowerCase() || 'us',
    shouldStop: () => run.cancelRequested,
    onError: (e) => {
      run.errors.push({ scope: 'niche', message: e.message, kind: 'notice', ts: now() });
      emit(run.id, { type: 'notice', scope: 'niche', message: e.message });
    },
  });
  v.niche = categories;
  emit(run.id, { type: 'phase_done', phase: 'learning', categories });
}

// ── The decision maker, found while the harvest is still running ────────────
// One contactable person per business, or the lead is dropped. This is the last
// gate and the expensive one — Hunter bills a credit per domain that returns
// people, and it rejects roughly four leads in five — so running it after the
// harvest could only ever shrink the list below what was asked for. Running it
// here instead makes `counts.kept` a live count of finished leads, and the
// harvest keeps digging until that count reaches the target.
async function startContacts(run) {
  if (run.filters.enrichWithHunter === false) return null;
  if (!config.hunter.apiKey) {
    const msg = 'No Hunter API key set (HUNTER_API_KEY) — leads have no contact details.';
    run.errors.push({ scope: 'hunter', message: msg, kind: 'notice', ts: now() });
    emit(run.id, { type: 'notice', scope: 'hunter', message: msg });
    return null;
  }

  // Set BEFORE the first candidate is admitted: it is what makes a lead with
  // no email count as unfinished, which is what the target measures.
  run.contactsRequired = true;

  // Seeded with the companies and people earlier runs already produced, so a
  // business advertising under a new page cannot arrive as a second lead for
  // the same person.
  const known = await library.knownContacts().catch(() => null);

  emit(run.id, { type: 'phase_started', phase: 'contacts', target: run.target });

  const ready = (b) => (!run.filters.verifyOnMaps || b.verify_status === 'kept')
    && b.contact_status === 'pending';

  return startEnrichment({
    known,
    maxCredits: run.filters.hunterMaxCredits ?? config.hunter.defaultMaxCredits,
    cancelled: () => run.cancelRequested,
    // Finished leads only — a candidate still in a worker does not count.
    capacity: () => run.target - store.recount(run),

    nextLead: () => {
      const b = run.businesses.find(ready);
      if (!b) return null;
      b.contact_status = 'checking';
      // The lead view knows where the website lives — the Maps listing, never
      // the ad destination — so Hunter is never handed an fb.me or an Amazon
      // product page.
      const lead = fromMetaBusiness(b);
      b.website = lead.website;
      b.business_name = lead.business_name;
      return b;
    },

    onKept: (b) => {
      b.contact_status = 'kept';
      run.counts.enrichedContacts++;
      store.recount(run);
      emit(run.id, { type: 'contact_found', business: b, counts: run.counts, pending: false });
    },

    onDropped: (b, reason) => {
      // Remembered as seen: this advertiser's domain has nobody to email, and
      // a later run should not pay to find that out again.
      run.seenForLibrary.push({ library_id: b.library_id, page_id: b.page_id, outcome: 'no_contact' });
      store.dropContact(run, b, reason);
      emit(run.id, {
        type: 'contact_missing', page_name: b.business_name || b.page_name, reason, counts: run.counts,
      });
    },

    onProgress: ({ creditsUsed }) => {
      run.counts.creditsUsed = creditsUsed;
      emit(run.id, {
        type: 'contact_progress',
        done: run.counts.enrichedContacts + run.counts.skippedNoContact,
        kept: run.counts.kept, target: run.target, creditsUsed, counts: run.counts,
      });
    },

    onError: (info) => {
      run.errors.push({ scope: 'hunter', message: info.message, ts: now() });
      emit(run.id, { type: 'error', scope: 'hunter', message: info.message, recoverable: !info.fatal });
    },
  });
}

// The queue is final: drain it, then say honestly why the run ended where it
// did. A list that stops at 94 of 150 is only trustworthy if it names the wall
// it hit.
async function finishContacts(run, contacts) {
  contacts.harvestFinished();
  if (run.cancelRequested) contacts.stop();
  if (!await settledOrStalled(contacts.promise, {
    progress: () => run.counts.enrichedContacts + run.counts.skippedNoContact,
    abandonWhen: () => run.cancelRequested, stallMs: config.stallMs,
  })) {
    contacts.stop();
    stalled(run, 'hunter', `contact lookup stopped responding after `
      + `${run.counts.creditsUsed} searches.`);
  }

  run.counts.creditsUsed = contacts.creditsUsed;
  store.recount(run);

  if (contacts.fatal) {
    run.errors.push({ scope: 'hunter', message: contacts.fatal, kind: 'notice', ts: now() });
    emit(run.id, { type: 'notice', scope: 'hunter', message: contacts.fatal });
  }

  emit(run.id, {
    type: 'phase_done', phase: 'contacts',
    kept: run.counts.kept, credits: contacts.creditsUsed,
  });
}

// ── Phase 2: advertiser details ──────────────────────────────────────────────
// The feed carries Facebook followers but not Instagram, so every advertiser's
// About tab is read for the Instagram handle + follower count (plus page age and
// bio). One page load per advertiser, which is why it runs concurrently.
async function enrichPhase(run) {
  run.phase = 'enriching';
  // Only confirmed leads — enrichment costs a page load each, and a rejected
  // candidate is not going in the export.
  const targets = store.keptBusinesses(run).filter((b) => b.page_id);
  emit(run.id, { type: 'phase_started', phase: 'enriching', total: targets.length });
  if (!targets.length) { emit(run.id, { type: 'phase_done', phase: 'enriching', done: 0 }); return; }

  await runPool(targets, config.enrichConcurrency, run, async (page, biz) => {
    let patch;
    try {
      patch = await scrapeAdvertiserDetails(page, biz.page_id, biz.country);
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
  const toSave = store.keptBusinesses(run);
  emit(run.id, { type: 'phase_started', phase: 'saving', total: toSave.length });
  try {
    const res = await library.save(toSave, run.id);
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

// A phase was abandoned, not finished. Said plainly and in the run's own
// errors, because the alternative is a short list with no explanation — and
// the run still goes on to save what it has, which is the whole point of
// giving up on it.
function stalled(run, scope, what) {
  const mins = Math.round(config.stallMs / 60000);
  const msg = `Stopped waiting on the ${scope} step — no progress for ${mins} minutes: ${what}`;
  run.errors.push({ scope, message: msg, kind: 'notice', ts: now() });
  emit(run.id, { type: 'notice', scope, message: msg });
}

// ── helpers ──────────────────────────────────────────────────────────────────
function finalize(run, status, message) {
  store.purgeIncomplete(run);
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

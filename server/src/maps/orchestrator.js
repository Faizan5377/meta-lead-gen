// Pipeline for one Maps run: harvest (with contacts alongside) -> save.
//
// Same guarantees as the Ad Library scraper:
//   • the target counts FINISHED leads — places carrying a decision maker —
//     so the search keeps digging until that many exist, and never returns more
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
import { startEnrichment } from '../enrich/phase.js';
import { fromPlace } from '../leadSchema.js';
import { settledOrStalled } from '../watchdog.js';

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
    // That many FINISHED leads — a place with nobody to email is not a lead.
    target: filters.target,
    // …and the rail on how many places may be checked getting there, since
    // every one can cost a Hunter credit.
    candidateCeiling: Math.min(
      config.maxCandidates,
      Math.max(500, filters.target * config.candidatesPerLead),
    ),
    places: [],
    byId: new Map(),           // feature id -> place
    seen: new Set(),           // every feature id considered, kept or not
    categories: new Map(),     // what Google calls this niche — learned, never hardcoded
    contactDrops: new Map(),   // why Hunter rejected leads, for the shortfall advice
    counts: {
      found: 0,
      harvested: 0,        // places admitted as candidates — a diagnostic
      kept: 0,             // finished leads: contactable — THIS is the target
      skippedKnown: 0, skippedFiltered: 0,
      skippedNoContact: 0, enrichedContacts: 0, creditsUsed: 0,
    },
    rejectReasons: new Map(),  // reason -> how many, for the shortfall advice
    cancelRequested: false,
    startedAt: null, finishedAt: null, stoppedAt: null,
    errors: [],
  };
  runs.set(run.id, run);
  return run;
}

export const getRun = (id) => runs.get(id);

// A place with nobody to email is not a lead. Applied from the moment the
// contact lookup starts, not after it finishes: the two run together, and this
// count is what the search's stop condition reads.
export function keptPlaces(run) {
  return run.contactsRequired ? run.places.filter((p) => !!p.owner_email) : run.places;
}

function recount(run) {
  run.counts.kept = keptPlaces(run).length;
  return run.counts.kept;
}

// Hunter found no one worth emailing. The place leaves the array entirely, so
// the snapshot stays small on a run that checks thousands to keep hundreds —
// and `run.seen` already holds its id, so this run will not reconsider it.
function dropContact(run, place, reason) {
  place.contact_status = 'dropped';
  const i = run.places.indexOf(place);
  if (i >= 0) run.places.splice(i, 1);
  run.byId.delete(place.feature_id);
  run.counts.skippedNoContact++;
  // Grouped on the wording so the tally points at the cause, not at every
  // distinct error string.
  const key = String(reason).replace(/:.*$/, '');
  run.contactDrops.set(key, (run.contactDrops.get(key) || 0) + 1);
  recount(run);
}

// The run is over: anything still waiting on Hunter was never going to finish.
function purgeIncomplete(run) {
  if (!run.contactsRequired) return 0;
  const left = run.places.filter((p) => !p.owner_email);
  for (const p of left) dropContact(run, p, 'not checked — target already met');
  return left.length;
}

export function snapshot(run) {
  return {
    id: run.id, kind: 'maps', name: run.name, createdAt: run.createdAt,
    status: run.status, phase: run.phase, filters: run.filters, target: run.target,
    counts: run.counts, places: keptPlaces(run), errors: run.errors.slice(-100),
    contactDrops: Object.fromEntries(run.contactDrops || []),
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

  // The contact lookup runs ALONGSIDE the search, not after it. Hunter rejects
  // most places, so running it last could only ever shrink the list below what
  // was asked for; running it here makes `counts.kept` a live count of finished
  // leads, and the search keeps digging — including into neighbouring
  // viewports — until that count reaches the target.
  const contacts = await startContacts(run);

  // Set before the first place is admitted so candidates are marked for the
  // contact workers to pick up.
  const stop = () => run.cancelRequested
    || run.counts.kept >= run.target
    || run.counts.harvested >= run.candidateCeiling
    || !!contacts?.exhausted;

  const searching = harvest({
    filters: run.filters,
    shouldStop: stop,
    // Google caps one search at ~120 results, and Hunter then rejects most of
    // what survives, so one search almost never yields the target on its own.
    // This is what sends the engine into related terms and nearby viewports —
    // and it reads FINISHED leads, so it keeps going until they exist.
    needsMore: () => !stop(),
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

      // The ceiling here is on CANDIDATES, not on leads: the target counts
      // finished leads, and `stop()` ends the search when it reaches them.
      // This rail only stops a niche that keeps producing places and never
      // produces a decision maker.
      //
      // With the contact lookup switched off there is no later gate, so the
      // places ARE the leads and the target is the ceiling again — the old
      // "exactly N, never more" guarantee, unchanged.
      const ceiling = run.contactsRequired ? run.candidateCeiling : run.target;
      if (run.counts.harvested >= ceiling) return false;

      if (run.contactsRequired) p.contact_status = 'pending';
      run.places.push(p);
      run.byId.set(p.feature_id, p);
      run.counts.harvested++;
      recount(run);
      // NOT noted in the library yet: a place Hunter rejects must stay
      // available to a later run rather than being hidden forever. That
      // happens in noteFinished(), once it is actually a lead.
      emit(run.id, {
        type: 'place_added', place: p, counts: run.counts,
        pending: !!run.contactsRequired,
      });
      return !stop();
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
      harvested: run.counts.harvested,
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

  // A browser call can wedge with no error and no timeout, and everything
  // below — the contact drain, the save — is queued behind this await.
  if (!await settledOrStalled(searching, {
    progress: () => run.counts.found,
    abandonWhen: () => run.cancelRequested, stallMs: config.stallMs,
  })) {
    stalled(run, 'search', `Google Maps stopped returning results. Carrying on with the `
      + `${run.counts.harvested} places already collected.`);
  }

  // The search has stopped producing, so the contact queue is now final.
  if (contacts) await finishContacts(run, contacts);

  // Only now is a place a lead. Noting it here is what makes the next run
  // return NEW businesses.
  for (const p of keptPlaces(run)) placesLibrary.note(p.feature_id, p.place_id);

  if (!run.cancelRequested && run.counts.kept < run.target) adviseOnShortfall(run, contacts);
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
export function adviseOnShortfall(run, contacts) {
  const { kept, harvested, skippedFiltered, skippedKnown, creditsUsed } = run.counts;

  // Which wall the run actually hit. Naming it matters more than the advice:
  // "a thin niche", "you ran out of credits" and "the scraper is broken" all
  // look identical from a short list.
  const wall = contacts?.exhausted
    ? `the Hunter credit cap (${creditsUsed} searches) was reached`
    : harvested >= run.candidateCeiling
      ? `${harvested} places were checked without finding enough decision makers`
      : 'Google had no more results for this search';
  const parts = [`${wall} — finished with ${kept} of ${run.target} leads.`];

  // The contact lookup is the gate that rejects most, so when it is the main
  // cost it is the first thing to say.
  const lostToHunter = [...(run.contactDrops || new Map())].sort((a, b) => b[1] - a[1])[0];
  if (lostToHunter && run.counts.skippedNoContact >= Math.max(10, kept)) {
    parts.push(`${run.counts.skippedNoContact} places had no decision maker to email, mostly “${lostToHunter[0]}” (${lostToHunter[1]}).`);
  }

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

// The same decision-maker step the Ad Library runs, driven the same way — one
// shared module, so a Maps lead and a Meta lead are enriched identically and
// stack into one list. One contactable person per business, or the place is
// dropped.
async function startContacts(run) {
  if (run.filters.enrichWithHunter === false) return null;
  if (!config.hunter.apiKey) {
    const msg = 'No Hunter API key set (HUNTER_API_KEY) — leads have no contact details.';
    run.errors.push({ scope: 'hunter', message: msg, kind: 'notice', ts: now() });
    emit(run.id, { type: 'notice', scope: 'hunter', message: msg });
    return null;
  }

  run.contactsRequired = true;

  // Seeded with the people BOTH scrapers already found, so a business with a
  // Maps listing and a Facebook page cannot arrive as two leads for one owner.
  const known = await placesLibrary.knownContacts().catch(() => null);

  emit(run.id, { type: 'phase_started', phase: 'contacts', target: run.target });

  return startEnrichment({
    known,
    maxCredits: run.filters.hunterMaxCredits ?? config.hunter.defaultMaxCredits,
    cancelled: () => run.cancelRequested,
    capacity: () => run.target - recount(run),

    nextLead: () => {
      const p = run.places.find((x) => x.contact_status === 'pending');
      if (!p) return null;
      p.contact_status = 'checking';
      // The lead view decides which of a place's fields is the company site.
      const lead = fromPlace(p);
      p.website = lead.website;
      p.business_name = lead.business_name;
      return p;
    },

    onKept: (p) => {
      p.contact_status = 'kept';
      run.counts.enrichedContacts++;
      recount(run);
      emit(run.id, { type: 'contact_found', place: p, counts: run.counts, pending: false });
    },

    onDropped: (p, reason) => {
      const name = p.business_name || p.name;
      dropContact(run, p, reason);
      emit(run.id, { type: 'contact_missing', name, reason, counts: run.counts });
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

async function finishContacts(run, contacts) {
  contacts.harvestFinished();
  if (run.cancelRequested) contacts.stop();
  if (!await settledOrStalled(contacts.promise, {
    progress: () => run.counts.enrichedContacts + run.counts.skippedNoContact,
    abandonWhen: () => run.cancelRequested, stallMs: config.stallMs,
  })) {
    contacts.stop();
    stalled(run, 'hunter', `contact lookup stopped responding after ${run.counts.creditsUsed} searches.`);
  }

  run.counts.creditsUsed = contacts.creditsUsed;
  recount(run);

  if (contacts.fatal) {
    run.errors.push({ scope: 'hunter', message: contacts.fatal, kind: 'notice', ts: now() });
    emit(run.id, { type: 'notice', scope: 'hunter', message: contacts.fatal });
  }
  emit(run.id, {
    type: 'phase_done', phase: 'contacts',
    kept: run.counts.kept, credits: contacts.creditsUsed,
  });
}

// A phase was abandoned, not finished — said plainly, with the run still going
// on to save what it has.
function stalled(run, scope, what) {
  const mins = Math.round(config.stallMs / 60000);
  const msg = `Stopped waiting on the ${scope} step — no progress for ${mins} minutes: ${what}`;
  run.errors.push({ scope, message: msg, kind: 'notice', ts: now() });
  emit(run.id, { type: 'notice', scope, message: msg });
}

async function savePhase(run) {
  if (run.saved) return;
  run.phase = 'saving';
  emit(run.id, { type: 'phase_started', phase: 'saving', total: keptPlaces(run).length });
  try {
    const res = await placesLibrary.save(keptPlaces(run), run.id);
    run.saved = true;
    run.saveResult = res;
    emit(run.id, { type: 'phase_done', phase: 'saving', saved: res.saved, remote: res.remote });
  } catch (err) {
    run.errors.push({ scope: 'save', message: err.message, ts: now() });
    emit(run.id, { type: 'error', scope: 'save', message: err.message, recoverable: true });
  }
}

function finalize(run, status, message) {
  purgeIncomplete(run);
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

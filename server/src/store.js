// In-memory run state. One run = one search. Owns the per-business dedup and the
// "keep the single longest continuously running ad" selection. Persistence to
// SQLite is handled by the orchestrator via db.js.

import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { ctaMatches } from './filters.js';
import { library } from './library.js';

class RunStore {
  constructor() { this.runs = new Map(); }

  create(filters) {
    const id = randomUUID();
    const run = {
      id,
      createdAt: new Date().toISOString(),
      name: null,
      seq: null,
      status: 'idle',            // idle | running | finished | stopped | error
      phase: 'idle',             // idle | harvesting | enriching | saving | done
      filters,
      // What the user asked for: that many FINISHED leads — verified on Maps
      // and carrying a decision maker — however many ads that takes.
      target: filters.target,
      // …and the rail on "however many". Harvesting is cheap, but every
      // candidate costs a Maps visit and may cost a Hunter credit, so a niche
      // that converts badly ends rather than running all night.
      candidateCeiling: Math.min(
        config.maxCandidates,
        Math.max(500, filters.target * config.candidatesPerLead),
      ),
      businesses: [],            // kept businesses (this run), insertion order
      businessByPage: new Map(), // dedup key -> business
      rejectedKeys: new Set(),   // verification said no — don't pay to check twice
      contactDrops: new Map(),   // why Hunter rejected leads, for the run summary
      counts: {
        rawSeen: 0,            // unique ads pulled off the feed
        harvested: 0,          // advertisers admitted as candidates — a diagnostic
        kept: 0,               // finished leads: verified AND contactable — THIS is the target
        skippedKnown: 0,       // already in the shared library
        skippedIrrelevant: 0,  // failed the niche relevance gate
        skippedCta: 0,         // the ad's button was not one you asked for
        skippedUnverified: 0,  // Google Maps could not confirm it
        skippedNoContact: 0,   // Hunter found no decision maker
        enrichedContacts: 0,   // Hunter lookups completed
        creditsUsed: 0,        // Hunter search credits spent this run
        verifiedDone: 0,       // Maps verification progress
        enrichedDone: 0,       // advertiser-detail enrichment progress
      },
      cancelRequested: false,
      startedAt: null,
      finishedAt: null,
      stoppedAt: null,
      errors: [],
    };
    this.runs.set(id, run);
    return run;
  }

  get(id) { return this.runs.get(id); }

  // `businesses` holds CANDIDATES at every stage — Google has yet to confirm
  // some, Hunter has yet to find a person at others — so the target, the save
  // and the export all have to ask for the finished ones rather than the whole
  // array. This is also the number the harvest's stop condition reads, which is
  // what makes "150 leads" mean 150 leads rather than 150 attempts.
  keptBusinesses(run) {
    let list = run.businesses;
    if (run.filters?.verifyOnMaps) list = list.filter((b) => b.verify_status === 'kept');
    // A lead with nobody to email is not a lead. Applied from the moment
    // contact lookup starts, not after it finishes: the two run together now.
    if (run.contactsRequired) list = list.filter((b) => !!b.owner_email);
    return list;
  }

  recount(run) {
    run.counts.kept = this.keptBusinesses(run).length;
    return run.counts.kept;
  }

  // The run is over. Any candidate still waiting on Google, or still waiting on
  // a decision maker, was never going to be finished — the target filled first —
  // and must not be mistaken for a lead.
  purgeIncomplete(run) {
    const left = run.businesses.filter((b) => !this.isFinished(run, b));
    // Attributed to the gate it actually died at: one that Google confirmed and
    // Hunter never reached is a contact shortfall, not a verification failure,
    // and filing it under the wrong tally sends you tuning the wrong filter.
    for (const b of left) {
      const reason = 'not checked — target already met';
      if (b.verify_status === 'kept') this.dropContact(run, b, reason);
      else this.dropCandidate(run, b, reason);
    }
    return left.length;
  }

  isFinished(run, b) {
    if (run.filters?.verifyOnMaps && b.verify_status !== 'kept') return false;
    if (run.contactsRequired && !b.owner_email) return false;
    return true;
  }

  // Verification said no. The candidate leaves the array entirely so the
  // snapshot stays small on a run that checks thousands to keep hundreds.
  dropCandidate(run, business, reason) {
    business.verify_status = 'dropped';
    business.verify_reason = reason || null;
    const i = run.businesses.indexOf(business);
    if (i >= 0) run.businesses.splice(i, 1);
    run.businessByPage.delete(business.business_key);
    run.rejectedKeys.add(business.business_key);
    run.counts.skippedUnverified++;
    this.recount(run);
  }

  // Hunter found no one worth emailing. Same disposal as a failed verification —
  // out of the array, remembered as rejected — but tallied separately, because
  // "no decision maker" and "not the right business" are different problems and
  // the run summary has to be able to tell you which one cost you the list.
  dropContact(run, business, reason) {
    business.contact_status = 'dropped';
    business.contact_reason = reason || null;
    const i = run.businesses.indexOf(business);
    if (i >= 0) run.businesses.splice(i, 1);
    run.businessByPage.delete(business.business_key);
    run.rejectedKeys.add(business.business_key);
    run.counts.skippedNoContact++;
    // Grouped on the wording so the tally points at the cause, not at every
    // distinct error string.
    const key = String(reason).replace(/:.*$/, '');
    run.contactDrops.set(key, (run.contactDrops.get(key) || 0) + 1);
    this.recount(run);
  }

  // Decide what to do with one freshly-harvested ad. Returns
  // { status: 'added'|'updated'|'skipped', business? }.
  //
  // `relevance` is the run's niche gate; ads that fail it never enter the run.
  considerAd(run, rec, relevance) {
    run.counts.rawSeen++;
    const key = businessKey(rec);
    if (!key) return { status: 'skipped' };

    // Already checked and rejected in this run. Re-admitting it would cost
    // another Maps lookup to reach the same answer.
    if (run.rejectedKeys?.has(key)) return { status: 'skipped', rejectedBefore: true };

    // Check THIS run first: the same business often resurfaces under another
    // keyword or country, and we want to record that extra keyword. (The
    // library check below would otherwise swallow it, because businesses added
    // during this run are already marked as known.)
    const existing = run.businessByPage.get(key);

    // Captured in a PREVIOUS run → don't surface again.
    if (!existing && (library.hasBusiness(key) || library.hasSeenAd(rec.library_id))) {
      run.counts.skippedKnown++;
      return { status: 'skipped', known: true };
    }

    // CTA gate. Free — the button is already in the feed record — so it runs
    // before relevance scoring and long before anything that costs a page load.
    if (!existing && !ctaMatches(rec, run.filters?.ctas || [])) {
      run.counts.skippedCta++;
      return { status: 'skipped', wrongCta: true };
    }

    // Niche gate. Meta's keyword search is loose, so an ad that isn't actually
    // in the searched niche is dropped before it can take a slot against the
    // target — otherwise "plumbing" spends slots on cholesterol supplements.
    if (!existing && relevance) {
      const verdict = relevance.evaluate(rec);
      rec.relevance_score = verdict.score;
      rec.relevance_reason = verdict.reason;
      if (verdict.decision === 'drop') {
        run.counts.skippedIrrelevant++;
        return { status: 'skipped', irrelevant: true, verdict };
      }
    }

    if (existing) {
      // Same business surfaced again (another ad, or another keyword/country).
      // Record the extra keyword, and swap in the better ad if this one has
      // been running longer.
      const grew = addKeyword(existing, rec.keyword);
      if (isLongerRunning(rec, existing)) {
        mergeKeptAd(existing, rec);
        return { status: 'updated', business: existing };
      }
      return grew ? { status: 'updated', business: existing } : { status: 'skipped' };
    }

    // The ceiling here is on CANDIDATES, not on leads: the target is how many
    // finished leads to deliver, and the harvest stops when `counts.kept`
    // reaches it. This rail only stops a run that keeps harvesting without ever
    // converting. Counted cumulatively — a candidate dropped later by Maps or
    // Hunter has still cost its lookup and must not reopen a slot.
    // Note this guards new businesses only; updates to ones already kept (an
    // extra keyword, a longer-running ad) are applied above.
    if (run.counts.harvested >= (run.candidateCeiling ?? run.target)) {
      return { status: 'skipped', atCeiling: true };
    }

    const business = {
      ...rec,
      business_key: key,
      keywords: rec.keyword ? [rec.keyword] : [],
      ...(run.filters?.verifyOnMaps ? { verify_status: 'pending' } : {}),
      ...(run.contactsRequired ? { contact_status: 'pending' } : {}),
    };
    run.businesses.push(business);
    run.businessByPage.set(key, business);
    run.counts.harvested++;
    this.recount(run);
    return { status: 'added', business };
  }

  patchBusiness(run, key, patch) {
    const b = run.businessByPage.get(key);
    if (!b) return null;
    Object.assign(b, patch);
    return b;
  }

  snapshot(run) {
    return {
      id: run.id,
      name: run.name || null,
      seq: run.seq || null,
      createdAt: run.createdAt,
      status: run.status,
      phase: run.phase,
      filters: run.filters,
      target: run.target,
      counts: run.counts,
      contactDrops: Object.fromEntries(run.contactDrops || []),
      businesses: this.keptBusinesses(run),
      errors: run.errors.slice(-100),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      stoppedAt: run.stoppedAt,
      exportReady: run.status === 'finished' || run.status === 'stopped' || run.status === 'error',
    };
  }
}

// Prefer numeric page_id; fall back to the page URL slug or the page name so we
// still dedup businesses when an id is missing.
function businessKey(rec) {
  if (rec.page_id) return String(rec.page_id);
  if (rec.page_url) {
    try {
      const u = new URL(rec.page_url);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0] === 'profile.php') return 'slug:' + u.searchParams.get('id');
      if (parts[0]) return 'slug:' + parts[0].toLowerCase();
    } catch {}
  }
  if (rec.page_name) return 'name:' + rec.page_name.toLowerCase();
  return null;
}

// Is `cand` a longer-running ad than the currently kept `cur`?
// Priority: still-active beats inactive → then earliest start date (longest
// continuous run) → then most recent as the tie-break.
function isLongerRunning(cand, cur) {
  const ca = cand.is_active ? 1 : 0;
  const ua = cur.is_active ? 1 : 0;
  if (ca !== ua) return ca > ua;

  const cs = cand.start_date, us = cur.start_date;
  if (cs && us && cs !== us) return cs < us;      // earlier start = longer running
  if (cs && !us) return true;
  if (!cs && us) return false;

  const cd = cand.days_running || 0, ud = cur.days_running || 0;
  if (cd !== ud) return cd > ud;

  // Tie-break: keep the most recently updated creative.
  const ce = cand.end_date || '', ue = cur.end_date || '';
  return ce > ue;
}

// Track every keyword that surfaced this business. Returns true if new.
function addKeyword(business, keyword) {
  if (!keyword) return false;
  if (!Array.isArray(business.keywords)) business.keywords = business.keyword ? [business.keyword] : [];
  if (business.keywords.some((k) => k.toLowerCase() === keyword.toLowerCase())) return false;
  business.keywords.push(keyword);
  return true;
}

function mergeKeptAd(existing, rec) {
  // Copy ad/creative fields from the better ad; keep enrichment fields and the
  // accumulated keyword list intact.
  const keep = {
    followers_instagram: existing.followers_instagram,
    instagram_handle: existing.instagram_handle,
    facebook_handle: existing.facebook_handle,
    page_category: existing.page_category,
    advertiser_bio: existing.advertiser_bio,
    page_created_on: existing.page_created_on,
    relevance_score: existing.relevance_score,
    relevance_reason: existing.relevance_reason,
    business_key: existing.business_key, keywords: existing.keywords,
    keyword: existing.keyword || rec.keyword,
  };
  // An advertiser can run several ads; keep the highest count we've seen rather
  // than whatever the displacing creative happens to report.
  const ads = Math.max(Number(existing.ads_running) || 0, Number(rec.ads_running) || 0);
  // Platforms accumulate across the advertiser's ads.
  const platforms = Array.from(new Set([...(existing.platforms || []), ...(rec.platforms || [])]));
  Object.assign(existing, rec, keep, { ads_running: ads, platforms });
}

export const store = new RunStore();

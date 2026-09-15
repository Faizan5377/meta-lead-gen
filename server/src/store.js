// In-memory run state. One run = one search. Owns the per-business dedup and the
// "keep the single longest continuously running ad" selection. Persistence to
// SQLite is handled by the orchestrator via db.js.

import { randomUUID } from 'node:crypto';
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
      target: filters.target,
      businesses: [],            // kept businesses (this run), insertion order
      businessByPage: new Map(), // dedup key -> business
      counts: {
        rawSeen: 0,            // unique ads pulled off the feed
        kept: 0,               // businesses kept (== businesses.length)
        skippedKnown: 0,       // already in the shared library
        skippedIrrelevant: 0,  // failed the niche relevance gate
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

  // Decide what to do with one freshly-harvested ad. Returns
  // { status: 'added'|'updated'|'skipped', business? }.
  //
  // `relevance` is the run's niche gate; ads that fail it never enter the run.
  considerAd(run, rec, relevance) {
    run.counts.rawSeen++;
    const key = businessKey(rec);
    if (!key) return { status: 'skipped' };

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

    // Hard ceiling. The engine also stops mid-buffer at the target, but this is
    // the invariant that guarantees it: a run NEVER returns more businesses than
    // were asked for. Fewer only if the Ad Library genuinely runs out.
    // Note this guards new businesses only — updates to ones already kept (an
    // extra keyword, a longer-running ad) must still be applied above.
    if (run.businesses.length >= run.target) return { status: 'skipped', atTarget: true };

    const business = { ...rec, business_key: key, keywords: rec.keyword ? [rec.keyword] : [] };
    run.businesses.push(business);
    run.businessByPage.set(key, business);
    run.counts.kept = run.businesses.length;
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
      businesses: run.businesses,
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

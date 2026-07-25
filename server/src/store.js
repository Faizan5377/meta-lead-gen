// In-memory run state. One run = one search. Owns the per-business dedup and the
// "keep the single longest continuously running ad" selection. Persistence to
// SQLite is handled by the orchestrator via db.js.

import { randomUUID } from 'node:crypto';
import { db } from './db.js';

class RunStore {
  constructor() { this.runs = new Map(); }

  create(filters) {
    const id = randomUUID();
    const run = {
      id,
      createdAt: new Date().toISOString(),
      status: 'idle',            // idle | running | finished | stopped | error
      phase: 'idle',             // idle | harvesting | contacts | google | done
      filters,
      target: filters.target,
      businesses: [],            // kept businesses (this run), insertion order
      businessByPage: new Map(), // dedup key -> business
      counts: { rawSeen: 0, kept: 0, contactsDone: 0, googleDone: 0, skippedKnown: 0 },
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
  considerAd(run, rec) {
    run.counts.rawSeen++;
    const key = businessKey(rec);
    if (!key) return { status: 'skipped' };

    // Check THIS run first: the same business often resurfaces under another
    // keyword or country, and we want to record that extra keyword. (The DB
    // check below would otherwise swallow it, because businesses added during
    // this run are already persisted.)
    const existing = run.businessByPage.get(key);

    // Captured in a PREVIOUS run → don't surface again.
    if (!existing && (db.hasBusiness(key) || db.hasSeenAd(rec.library_id))) {
      run.counts.skippedKnown++;
      return { status: 'skipped' };
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
    contact_email: existing.contact_email, contact_phone: existing.contact_phone,
    contact_website: existing.contact_website, contact_status: existing.contact_status,
    owner_name: existing.owner_name, owner_title: existing.owner_title,
    owner_source: existing.owner_source, google_status: existing.google_status,
    business_key: existing.business_key, keywords: existing.keywords,
    keyword: existing.keyword || rec.keyword,
  };
  Object.assign(existing, rec, keep);
}

export const store = new RunStore();

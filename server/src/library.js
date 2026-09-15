// The shared ad library.
//
// Supabase is the source of truth: every run reads it to skip ads we already
// have, and writes new ones back, so repeat searches only ever surface NEW
// advertisers — across machines, not just across runs on one laptop.
//
// Local SQLite stays as a mirror and a fallback. If Supabase is unreachable
// (no credentials, project paused, network down) the app keeps working against
// the local library instead of failing the run; `mode` tells the UI which is
// live. That also makes the very first run fast: dedup checks hit an in-memory
// set warmed at boot rather than a round-trip per ad.

import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { db } from './db.js';

const CHUNK = 500;   // rows per upsert; Supabase rejects very large payloads

// Columns that are arrays in Postgres but joined strings in SQLite.
const ARRAY_COLUMNS = ['page_categories', 'platforms', 'keywords'];

function toRow(b, runId) {
  const arr = (v) => (Array.isArray(v) ? v : v ? String(v).split(/;\s*/).filter(Boolean) : []);
  const int = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null);
  return {
    library_id: String(b.library_id),
    page_id: b.page_id != null ? String(b.page_id) : null,
    business_key: String(b.business_key || b.page_id || b.library_id),
    page_name: b.page_name || null,
    page_url: b.page_url || null,
    page_profile_picture_url: b.page_profile_picture_url || null,
    page_categories: arr(b.page_categories),
    followers_facebook: int(b.followers_facebook),
    followers_instagram: int(b.followers_instagram),
    instagram_handle: b.instagram_handle || null,
    facebook_handle: b.facebook_handle || null,
    page_category: b.page_category || null,
    advertiser_bio: b.advertiser_bio || null,
    page_created_on: b.page_created_on || null,
    platforms: arr(b.platforms),
    ads_running: int(b.ads_running) ?? 1,
    collation_id: b.collation_id || null,
    ad_url: b.ad_url || null,
    is_active: b.is_active === true || b.is_active === 'true' || b.is_active === 1,
    start_date: b.start_date || null,
    end_date: b.end_date || null,
    days_running: int(b.days_running),
    cta_text: b.cta_text || null,
    cta_type: b.cta_type || null,
    title: b.title || null,
    body_text: b.body_text || null,
    link_url: b.link_url || null,
    display_domain: b.display_domain || null,
    display_format: b.display_format || null,
    image_url: b.image_url || null,
    video_url: b.video_url || null,
    keyword: b.keyword || null,
    keywords: arr(b.keywords),
    country: b.country || null,
    relevance_score: int(b.relevance_score),
    relevance_reason: b.relevance_reason || null,
    run_id: runId || null,
    last_updated_at: new Date().toISOString(),
  };
}

class Library {
  constructor() {
    this.sb = null;
    this.mode = 'local';          // 'supabase' | 'local'
    this.lastError = null;
    // Warmed at boot so per-ad dedup is a memory hit, not a network call.
    this.knownAds = new Set();
    this.knownBusinesses = new Set();
    this.remoteCount = 0;
  }

  async init() {
    await db.init();
    // Seed from the local mirror first — instantly useful even if Supabase is
    // slow or unavailable.
    for (const id of db.memSeenAds) this.knownAds.add(id);
    for (const k of db.memSeenPages) this.knownBusinesses.add(k);

    const { url, serviceKey, enabled } = config.supabase;
    if (!enabled || !url || !serviceKey) {
      console.log('[library] Supabase not configured — using the local library only');
      return this.state();
    }

    try {
      this.sb = createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      // A cheap call that proves credentials AND that the table exists.
      const { count, error } = await this.sb
        .from('ads').select('library_id', { count: 'exact', head: true });
      if (error) throw new Error(error.message);

      this.remoteCount = count || 0;
      await this.#warm();
      this.mode = 'supabase';
      console.log(`[library] Supabase connected — ${this.remoteCount} ads in the shared library`);
    } catch (err) {
      this.sb = null;
      this.mode = 'local';
      this.lastError = err.message;
      console.warn(`[library] Supabase unavailable, falling back to the local library (${err.message})`);
    }
    return this.state();
  }

  // Pull every known id once, so dedup during a harvest costs nothing.
  async #warm() {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.sb
        .from('ads').select('library_id,business_key').range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      for (const r of data || []) {
        if (r.library_id) this.knownAds.add(String(r.library_id));
        if (r.business_key) this.knownBusinesses.add(String(r.business_key));
      }
      if (!data || data.length < PAGE) break;
    }
    // seen_ads covers ads we processed but didn't keep (e.g. irrelevant ones),
    // so we never re-evaluate them on a later run.
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.sb
        .from('seen_ads').select('library_id').range(from, from + PAGE - 1);
      if (error) break;
      for (const r of data || []) if (r.library_id) this.knownAds.add(String(r.library_id));
      if (!data || data.length < PAGE) break;
    }
  }

  // ── dedup (hot path — memory only) ────────────────────────────────────────
  hasSeenAd(libraryId) {
    return libraryId != null && this.knownAds.has(String(libraryId));
  }

  hasBusiness(key) {
    return key != null && this.knownBusinesses.has(String(key));
  }

  // Remember locally straight away; the remote write is batched at run end.
  note(libraryId, businessKey) {
    if (libraryId != null) this.knownAds.add(String(libraryId));
    if (businessKey != null) this.knownBusinesses.add(String(businessKey));
    db.markSeen(libraryId, businessKey, null);
  }

  // ── writes ────────────────────────────────────────────────────────────────
  // Saving happens once, at the end of a run: one batched round-trip instead of
  // thousands, and a run that gets stopped early still saves what it collected.
  async save(businesses, runId) {
    for (const b of businesses) db.upsertBusiness({ ...b, run_id: runId });
    if (!this.sb || !businesses.length) {
      return { saved: businesses.length, remote: false };
    }

    const rows = businesses.map((b) => toRow(b, runId));
    let saved = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await this.sb
        .from('ads').upsert(chunk, { onConflict: 'business_key', ignoreDuplicates: false });
      if (error) {
        this.lastError = error.message;
        console.warn(`[library] remote save failed (${error.message}) — rows are safe in the local library`);
        return { saved, remote: false, error: error.message };
      }
      saved += chunk.length;
    }
    this.remoteCount += saved;
    return { saved, remote: true };
  }

  // Record ads we processed but did not keep, so later runs skip them outright.
  async noteSeen(entries, runId) {
    if (!this.sb || !entries.length) return;
    const rows = entries.map((e) => ({
      library_id: String(e.library_id),
      page_id: e.page_id != null ? String(e.page_id) : null,
      run_id: runId || null,
      outcome: e.outcome || 'irrelevant',
    }));
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await this.sb
        .from('seen_ads').upsert(rows.slice(i, i + CHUNK), { onConflict: 'library_id' });
      if (error) { console.warn('[library] seen_ads write failed:', error.message); return; }
    }
  }

  // A label the user can actually find later. Two searches for the same keyword
  // must be distinguishable, so each gets a sequence number:
  //   "plumbing · US · #1",  "plumbing · US · #2"
  async nameRun(filters) {
    const base = [
      (filters.keywords || []).join(', ') || 'untitled',
      (filters.countries || []).join('/'),
    ].filter(Boolean).join(' · ');

    // How many runs of this exact search already exist?
    let seq = 1;
    if (this.sb) {
      try {
        const { count } = await this.sb
          .from('runs').select('id', { count: 'exact', head: true })
          .like('name', `${base.replace(/[%_]/g, ' ')} · #%`);
        if (Number.isFinite(count)) seq = count + 1;
      } catch { /* a naming collision is cosmetic — never block the run */ }
    }
    return { name: `${base} · #${seq}`, seq };
  }

  async saveRun(run) {
    if (!this.sb) return;
    const { error } = await this.sb.from('runs').upsert({
      id: run.id,
      name: run.name || null,
      seq: run.seq || null,
      keywords: run.filters?.keywords || [],
      countries: run.filters?.countries || [],
      filters: run.filters,
      target: run.target,
      status: run.status,
      kept: run.counts.kept,
      skipped_known: run.counts.skippedKnown,
      skipped_irrelevant: run.counts.skippedIrrelevant,
      raw_seen: run.counts.rawSeen,
      started_at: run.startedAt,
      finished_at: run.finishedAt,
    }, { onConflict: 'id' });
    if (error) console.warn('[library] run write failed:', error.message);
  }

  // ── Executions (the Library page) ─────────────────────────────────────────
  // Every run that collected at least one ad, newest first.
  async listRuns({ search, limit = 200 } = {}) {
    if (!this.sb) return { runs: [], source: 'local' };
    let sel = this.sb.from('runs').select('*').order('created_at', { ascending: false }).limit(limit);
    if (search) sel = sel.ilike('name', `%${String(search).replace(/[%,]/g, ' ').trim()}%`);
    const { data, error } = await sel;
    if (error) throw new Error(error.message);
    return { runs: data || [], source: 'supabase' };
  }

  // The ads one execution collected.
  async runAds(runId, { limit = 1000 } = {}) {
    if (!this.sb) {
      const rows = db.allBusinesses().filter((r) => String(r.run_id) === String(runId));
      return { rows, total: rows.length, source: 'local' };
    }
    const { data, error, count } = await this.sb
      .from('ads').select('*', { count: 'exact' })
      .eq('run_id', runId)
      .order('days_running', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return { rows: data || [], total: count || 0, source: 'supabase' };
  }

  async renameRun(runId, name) {
    if (!this.sb) return { ok: false };
    const { error } = await this.sb.from('runs').update({ name: String(name).slice(0, 120) }).eq('id', runId);
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  // Deleting an execution removes its ads too, so they can be harvested again.
  async deleteRun(runId) {
    if (!this.sb) return { ok: false };
    const { data } = await this.sb.from('ads').select('library_id,business_key').eq('run_id', runId);
    for (const r of data || []) {
      this.knownAds.delete(String(r.library_id));
      this.knownBusinesses.delete(String(r.business_key));
    }
    await this.sb.from('ads').delete().eq('run_id', runId);
    await this.sb.from('seen_ads').delete().eq('run_id', runId);
    const { error } = await this.sb.from('runs').delete().eq('id', runId);
    if (error) throw new Error(error.message);
    return { ok: true, removed: (data || []).length };
  }

  // ── reads (the Library page) ──────────────────────────────────────────────
  async query(q = {}) {
    const {
      search, countries, keywords, platforms, categories, isActive,
      minFollowers, maxFollowers, minDays, maxDays, minAds, minRelevance,
      startedAfter, startedBefore, hasWebsite,
      sort = 'first_seen_at', dir = 'desc', limit = 100, offset = 0,
    } = q;

    if (!this.sb) return this.#queryLocal(q);

    let sel = this.sb.from('ads').select('*', { count: 'exact' });

    if (search) {
      const s = String(search).replace(/[%,()]/g, ' ').trim();
      if (s) sel = sel.or(`page_name.ilike.%${s}%,title.ilike.%${s}%,body_text.ilike.%${s}%,display_domain.ilike.%${s}%`);
    }
    if (countries?.length) sel = sel.in('country', countries);
    if (keywords?.length) sel = sel.overlaps('keywords', keywords);
    if (platforms?.length) sel = sel.overlaps('platforms', platforms);
    if (categories?.length) sel = sel.overlaps('page_categories', categories);
    if (isActive === true || isActive === false) sel = sel.eq('is_active', isActive);
    if (Number.isFinite(minFollowers)) sel = sel.gte('followers_facebook', minFollowers);
    if (Number.isFinite(maxFollowers)) sel = sel.lte('followers_facebook', maxFollowers);
    if (Number.isFinite(minDays)) sel = sel.gte('days_running', minDays);
    if (Number.isFinite(maxDays)) sel = sel.lte('days_running', maxDays);
    if (Number.isFinite(minAds)) sel = sel.gte('ads_running', minAds);
    if (Number.isFinite(minRelevance)) sel = sel.gte('relevance_score', minRelevance);
    if (startedAfter) sel = sel.gte('start_date', startedAfter);
    if (startedBefore) sel = sel.lte('start_date', startedBefore);
    if (hasWebsite === true) sel = sel.not('link_url', 'is', null);

    const SORTABLE = new Set([
      'first_seen_at', 'days_running', 'followers_facebook', 'ads_running',
      'start_date', 'page_name', 'relevance_score', 'country',
    ]);
    const col = SORTABLE.has(sort) ? sort : 'first_seen_at';
    sel = sel.order(col, { ascending: dir === 'asc', nullsFirst: false })
             .range(offset, offset + Math.min(limit, 1000) - 1);

    const { data, error, count } = await sel;
    if (error) throw new Error(error.message);
    return { rows: data || [], total: count || 0, source: 'supabase' };
  }

  // Same filters against the local mirror, so the Library page works offline.
  #queryLocal(q) {
    const rows = db.allBusinesses();
    const norm = (v) => (Array.isArray(v) ? v : String(v || '').split(/;\s*/).filter(Boolean));
    const has = (arr, want) => want.some((w) => arr.map((x) => String(x).toLowerCase()).includes(String(w).toLowerCase()));

    let out = rows.filter((r) => {
      if (q.search) {
        const s = String(q.search).toLowerCase();
        const hay = `${r.page_name || ''} ${r.title || ''} ${r.body_text || ''} ${r.display_domain || ''}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      if (q.countries?.length && !q.countries.includes(r.country)) return false;
      if (q.keywords?.length && !has(norm(r.keywords), q.keywords)) return false;
      if (q.platforms?.length && !has(norm(r.platforms), q.platforms)) return false;
      if (q.categories?.length && !has(norm(r.page_categories), q.categories)) return false;
      if (q.isActive === true && !(r.is_active === '1' || r.is_active === 1 || r.is_active === true)) return false;
      if (q.isActive === false && (r.is_active === '1' || r.is_active === 1 || r.is_active === true)) return false;
      const n = (v) => Number(v) || 0;
      if (Number.isFinite(q.minFollowers) && n(r.followers_facebook) < q.minFollowers) return false;
      if (Number.isFinite(q.maxFollowers) && n(r.followers_facebook) > q.maxFollowers) return false;
      if (Number.isFinite(q.minDays) && n(r.days_running) < q.minDays) return false;
      if (Number.isFinite(q.maxDays) && n(r.days_running) > q.maxDays) return false;
      if (Number.isFinite(q.minAds) && n(r.ads_running) < q.minAds) return false;
      if (Number.isFinite(q.minRelevance) && n(r.relevance_score) < q.minRelevance) return false;
      if (q.startedAfter && String(r.start_date || '') < q.startedAfter) return false;
      if (q.startedBefore && String(r.start_date || '') > q.startedBefore) return false;
      if (q.hasWebsite === true && !r.link_url) return false;
      return true;
    });

    const col = q.sort || 'first_seen_at';
    const dir = q.dir === 'asc' ? 1 : -1;
    out.sort((a, b) => {
      const av = a[col], bv = b[col];
      const an = Number(av), bn = Number(bv);
      if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * dir;
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
    });

    const total = out.length;
    const offset = q.offset || 0;
    return {
      rows: out.slice(offset, offset + Math.min(q.limit || 100, 1000)).map((r) => ({
        ...r,
        page_categories: norm(r.page_categories),
        platforms: norm(r.platforms),
        keywords: norm(r.keywords),
        is_active: r.is_active === '1' || r.is_active === 1 || r.is_active === true,
      })),
      total,
      source: 'local',
    };
  }

  // Distinct values, so the Library filter panel offers only what exists.
  async facets() {
    const { rows } = await this.query({ limit: 1000 });
    const bag = (key) => {
      const counts = new Map();
      for (const r of rows) {
        const vals = Array.isArray(r[key]) ? r[key] : [r[key]].filter(Boolean);
        for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
      }
      return Array.from(counts, ([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count).slice(0, 60);
    };
    return {
      countries: bag('country'),
      keywords: bag('keywords'),
      platforms: bag('platforms'),
      categories: bag('page_categories'),
    };
  }

  async stats() {
    if (this.sb) {
      const { count } = await this.sb.from('ads').select('library_id', { count: 'exact', head: true });
      return { total: count || 0, mode: 'supabase', seenAds: this.knownAds.size };
    }
    const local = db.stats();
    return { total: local.businesses, mode: 'local', seenAds: local.seenAds, persisted: local.persisted };
  }

  async clear() {
    db.clear();
    this.knownAds.clear();
    this.knownBusinesses.clear();
    if (this.sb) {
      for (const t of ['ads', 'seen_ads']) {
        const { error } = await this.sb.from(t).delete().neq('library_id', '');
        if (error) console.warn(`[library] clearing ${t} failed:`, error.message);
      }
      this.remoteCount = 0;
    }
    return this.stats();
  }

  state() {
    return { mode: this.mode, error: this.lastError, known: this.knownBusinesses.size };
  }
}

export const library = new Library();

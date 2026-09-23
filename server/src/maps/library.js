// Shared library for Google Maps places.
//
// Mirrors the ad library: Supabase is the source of truth so repeat searches
// only ever return NEW businesses, dedup is an in-memory Set warmed at boot
// (not a round-trip per place), and saving is one batched write at the end.
// Without Supabase it still runs — it just can't dedup across machines.

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

const CHUNK = 500;

function toRow(p, runId) {
  const int = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null);
  const flt = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    feature_id: String(p.feature_id),
    place_id: p.place_id || null,
    knowledge_id: p.knowledge_id || null,
    name: p.name || null,
    address: p.address || null,
    street: p.street || null,
    city: p.city || null,
    neighborhood: p.neighborhood || null,
    country: p.country || null,
    timezone: p.timezone || null,
    latitude: flt(p.latitude),
    longitude: flt(p.longitude),
    category: p.category || null,
    categories: Array.isArray(p.categories) ? p.categories : [],
    rating: flt(p.rating),
    review_count: int(p.review_count),
    phone: p.phone || null,
    phone_e164: p.phone_e164 || null,
    website: p.website || null,
    website_domain: p.website_domain || null,
    hours: p.hours || null,
    open_state: p.open_state || null,
    photo_url: p.photo_url || null,
    owner_name: p.owner_name || null,
    maps_url: p.maps_url || null,
    cid_url: p.cid_url || null,
    query: p.query || null,
    search_location: p.search_location || null,
    run_id: runId || null,
    last_updated_at: new Date().toISOString(),
  };
}

class PlacesLibrary {
  constructor() {
    this.sb = null;
    this.mode = 'local';
    this.known = new Set();       // feature ids AND place ids
    this.total = 0;
    this.lastError = null;
  }

  async init() {
    const { url, serviceKey, enabled } = config.supabase;
    if (!enabled || !url || !serviceKey) {
      console.log('[places] Supabase not configured — Maps dedup is per-process only');
      return this.state();
    }
    try {
      this.sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { count, error } = await this.sb.from('places').select('feature_id', { count: 'exact', head: true });
      if (error) throw new Error(error.message);
      this.total = count || 0;
      await this.#warm();
      this.mode = 'supabase';
      console.log(`[places] Supabase connected — ${this.total} places in the shared library`);
    } catch (err) {
      this.sb = null;
      this.mode = 'local';
      this.lastError = err.message;
      console.warn(`[places] Supabase unavailable for Maps (${err.message})`);
    }
    return this.state();
  }

  async #warm() {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.sb
        .from('places').select('feature_id,place_id').range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      for (const r of data || []) {
        if (r.feature_id) this.known.add(String(r.feature_id));
        if (r.place_id) this.known.add(String(r.place_id));
      }
      if (!data || data.length < PAGE) break;
    }
  }

  has(featureId, placeId) {
    return (featureId != null && this.known.has(String(featureId)))
      || (placeId != null && this.known.has(String(placeId)));
  }

  note(featureId, placeId) {
    if (featureId != null) this.known.add(String(featureId));
    if (placeId != null) this.known.add(String(placeId));
  }

  async save(places, runId) {
    if (!this.sb || !places.length) return { saved: places.length, remote: false };
    const rows = places.map((p) => toRow(p, runId));
    let saved = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await this.sb
        .from('places').upsert(rows.slice(i, i + CHUNK), { onConflict: 'feature_id', ignoreDuplicates: false });
      if (error) {
        this.lastError = error.message;
        console.warn(`[places] remote save failed (${error.message})`);
        return { saved, remote: false, error: error.message };
      }
      saved += Math.min(CHUNK, rows.length - i);
    }
    this.total += saved;
    return { saved, remote: true };
  }

  // Name each run so repeats of the same search are distinguishable.
  async nameRun(filters) {
    const base = [
      (filters.queries || []).join(', ') || 'untitled',
      (filters.locations || []).join('/'),
    ].filter(Boolean).join(' · ');
    let seq = 1;
    if (this.sb) {
      try {
        const { count } = await this.sb.from('place_runs')
          .select('id', { count: 'exact', head: true })
          .like('name', `${base.replace(/[%_]/g, ' ')} · #%`);
        if (Number.isFinite(count)) seq = count + 1;
      } catch { /* naming is cosmetic — never block a run */ }
    }
    return { name: `${base} · #${seq}`, seq };
  }

  async saveRun(run) {
    if (!this.sb) return;
    const { error } = await this.sb.from('place_runs').upsert({
      id: run.id,
      name: run.name || null,
      seq: run.seq || null,
      queries: run.filters?.queries || [],
      locations: run.filters?.locations || [],
      filters: run.filters,
      target: run.target,
      status: run.status,
      kept: run.counts.kept,
      found: run.counts.found,
      skipped_known: run.counts.skippedKnown,
      skipped_filtered: run.counts.skippedFiltered,
      started_at: run.startedAt,
      finished_at: run.finishedAt,
    }, { onConflict: 'id' });
    if (error) console.warn('[places] run write failed:', error.message);
  }

  async listRuns({ search } = {}) {
    if (!this.sb) return { runs: [], source: 'local' };
    let sel = this.sb.from('place_runs').select('*').order('created_at', { ascending: false }).limit(200);
    if (search) sel = sel.ilike('name', `%${String(search).replace(/[%,]/g, ' ').trim()}%`);
    const { data, error } = await sel;
    if (error) throw new Error(error.message);
    return { runs: data || [], source: 'supabase' };
  }

  async runPlaces(runId) {
    if (!this.sb) return { rows: [], total: 0, source: 'local' };
    const { data, error, count } = await this.sb
      .from('places').select('*', { count: 'exact' })
      .eq('run_id', runId)
      .order('review_count', { ascending: false, nullsFirst: false })
      .limit(2500);
    if (error) throw new Error(error.message);
    return { rows: data || [], total: count || 0, source: 'supabase' };
  }

  async renameRun(runId, name) {
    if (!this.sb) return { ok: false };
    const { error } = await this.sb.from('place_runs').update({ name: String(name).slice(0, 120) }).eq('id', runId);
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  async deleteRun(runId) {
    if (!this.sb) return { ok: false };
    const { data } = await this.sb.from('places').select('feature_id,place_id').eq('run_id', runId);
    for (const r of data || []) {
      this.known.delete(String(r.feature_id));
      if (r.place_id) this.known.delete(String(r.place_id));
    }
    await this.sb.from('places').delete().eq('run_id', runId);
    const { error } = await this.sb.from('place_runs').delete().eq('id', runId);
    if (error) throw new Error(error.message);
    return { ok: true, removed: (data || []).length };
  }

  async stats() {
    if (!this.sb) return { total: 0, mode: 'local', known: this.known.size };
    const { count } = await this.sb.from('places').select('feature_id', { count: 'exact', head: true });
    return { total: count || 0, mode: 'supabase', known: this.known.size };
  }

  state() { return { mode: this.mode, error: this.lastError, known: this.known.size }; }
}

export const placesLibrary = new PlacesLibrary();

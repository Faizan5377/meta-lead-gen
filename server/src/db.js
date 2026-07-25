// Local persistence via Node's built-in SQLite (node:sqlite). Two roles:
//   1. seen_ads   — every unique ad id we've ever processed, so re-searches skip
//                   ads (and businesses) we already have.
//   2. businesses — one kept ad per business (page_id), the longest continuously
//                   running one, with all its scraped + enriched data.
//
// If node:sqlite isn't available for any reason, we fall back to an in-memory
// store so the app still runs (persistence is simply disabled for that session).

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const BUSINESS_COLUMNS = [
  'page_id', 'library_id', 'page_name', 'page_url', 'page_categories', 'followers',
  'is_active', 'start_date', 'end_date', 'days_running', 'collation_count',
  'cta_text', 'cta_type', 'title', 'body_text', 'link_url', 'display_domain',
  'display_format', 'image_url', 'video_url',
  'keyword', 'keywords', 'country',
  'contact_email', 'contact_phone', 'contact_website', 'contact_status',
  'owner_name', 'owner_title', 'owner_source', 'google_status',
  'run_id', 'first_seen_at', 'last_updated_at',
];

class Database {
  constructor() {
    this.db = null;
    this.ok = false;
    // In-memory fallbacks (also used as fast lookup mirrors).
    this.memSeenAds = new Set();
    this.memSeenPages = new Set();
    this.memBusinesses = new Map();
  }

  async init() {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
      this.db = new DatabaseSync(config.dbPath);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS seen_ads (
          library_id TEXT PRIMARY KEY,
          page_id    TEXT,
          run_id     TEXT,
          seen_at    TEXT
        );
        CREATE TABLE IF NOT EXISTS businesses (
          ${BUSINESS_COLUMNS.map(c => `${c} TEXT`).join(',\n          ')},
          PRIMARY KEY (page_id)
        );
        CREATE INDEX IF NOT EXISTS idx_business_run ON businesses(run_id);
        CREATE INDEX IF NOT EXISTS idx_seen_page ON seen_ads(page_id);
      `);
      this.ok = true;
      this.#migrate();
      // Warm the in-memory mirrors for fast dedup during a harvest.
      for (const r of this.db.prepare('SELECT library_id, page_id FROM seen_ads').all()) {
        if (r.library_id) this.memSeenAds.add(String(r.library_id));
        if (r.page_id) this.memSeenPages.add(String(r.page_id));
      }
      for (const r of this.db.prepare('SELECT page_id FROM businesses').all()) {
        if (r.page_id) this.memSeenPages.add(String(r.page_id));
      }
      console.log(`[db] ready at ${config.dbPath} — ${this.memSeenAds.size} seen ads, ${this.memSeenPages.size} known businesses`);
    } catch (err) {
      this.ok = false;
      console.warn(`[db] node:sqlite unavailable — running without persistence. (${err.message})`);
    }
  }

  // Add any columns introduced after a user's database was first created, so
  // upgrading the app never breaks an existing leads.db.
  #migrate() {
    try {
      const existing = new Set(
        this.db.prepare('PRAGMA table_info(businesses)').all().map((r) => r.name)
      );
      for (const col of BUSINESS_COLUMNS) {
        if (!existing.has(col)) {
          this.db.exec(`ALTER TABLE businesses ADD COLUMN ${col} TEXT`);
          console.log(`[db] migrated: added businesses.${col}`);
        }
      }
    } catch (err) {
      console.warn('[db] migration check failed:', err.message);
    }
  }

  hasSeenAd(libraryId) { return this.memSeenAds.has(String(libraryId)); }
  hasBusiness(pageId) { return pageId != null && this.memSeenPages.has(String(pageId)); }

  markSeen(libraryId, pageId, runId) {
    const lid = String(libraryId);
    if (this.memSeenAds.has(lid)) return;
    this.memSeenAds.add(lid);
    if (pageId != null) this.memSeenPages.add(String(pageId));
    if (!this.ok) return;
    try {
      this.db.prepare('INSERT OR IGNORE INTO seen_ads (library_id, page_id, run_id, seen_at) VALUES (?, ?, ?, ?)')
        .run(lid, pageId != null ? String(pageId) : null, runId || null, new Date().toISOString());
    } catch (err) { console.warn('[db] markSeen failed:', err.message); }
  }

  upsertBusiness(rec) {
    const row = {};
    for (const c of BUSINESS_COLUMNS) row[c] = serialize(rec[c]);
    row.last_updated_at = new Date().toISOString();
    if (!row.first_seen_at) row.first_seen_at = row.last_updated_at;
    if (rec.page_id != null) this.memSeenPages.add(String(rec.page_id));
    this.memBusinesses.set(String(rec.page_id), rec);
    if (!this.ok) return;
    try {
      const cols = BUSINESS_COLUMNS.join(', ');
      const placeholders = BUSINESS_COLUMNS.map(() => '?').join(', ');
      this.db.prepare(`INSERT OR REPLACE INTO businesses (${cols}) VALUES (${placeholders})`)
        .run(...BUSINESS_COLUMNS.map(c => row[c] ?? null));
    } catch (err) { console.warn('[db] upsertBusiness failed:', err.message); }
  }

  updateBusiness(pageId, patch) {
    const existing = this.memBusinesses.get(String(pageId));
    if (existing) Object.assign(existing, patch);
    if (!this.ok) return;
    try {
      const keys = Object.keys(patch).filter(k => BUSINESS_COLUMNS.includes(k));
      if (!keys.length) return;
      keys.push('last_updated_at');
      const set = keys.map(k => `${k} = ?`).join(', ');
      const vals = keys.map(k => (k === 'last_updated_at' ? new Date().toISOString() : serialize(patch[k])));
      this.db.prepare(`UPDATE businesses SET ${set} WHERE page_id = ?`).run(...vals, String(pageId));
    } catch (err) { console.warn('[db] updateBusiness failed:', err.message); }
  }

  clear() {
    this.memSeenAds.clear();
    this.memSeenPages.clear();
    this.memBusinesses.clear();
    if (this.ok) {
      try { this.db.exec('DELETE FROM seen_ads; DELETE FROM businesses;'); }
      catch (err) { console.warn('[db] clear failed:', err.message); }
    }
    console.log('[db] cleared — starting fresh');
    return this.stats();
  }

  stats() {
    if (!this.ok) return { seenAds: this.memSeenAds.size, businesses: this.memBusinesses.size, persisted: false };
    try {
      const seenAds = this.db.prepare('SELECT COUNT(*) n FROM seen_ads').get().n;
      const businesses = this.db.prepare('SELECT COUNT(*) n FROM businesses').get().n;
      return { seenAds, businesses, persisted: true };
    } catch { return { seenAds: this.memSeenAds.size, businesses: this.memBusinesses.size, persisted: false }; }
  }
}

function serialize(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.join('; ');
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return String(v);
  return String(v);
}

export const db = new Database();

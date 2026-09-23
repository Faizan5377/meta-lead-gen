import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const bool = (v, d) => (v === undefined ? d : /^(1|true|yes|on)$/i.test(String(v)));
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 8787),

  // Scraping runs headless by design — the browser window never opens. Set
  // HEADFUL=true only for local debugging.
  headless: !bool(process.env.HEADFUL, false),
  slowMoMs: num(process.env.SLOW_MO_MS, 0),

  // Harvest target. The scraper keeps going until it collects this many unique
  // businesses OR genuinely runs out of ads while scrolling. MAX_TARGET is a
  // hard ceiling enforced when normalising filters.
  targetAds: num(process.env.TARGET_ADS, 500),
  maxTarget: num(process.env.MAX_TARGET, 2500),

  // Safety ceiling for the WHOLE harvest (all keywords × countries), so a stuck
  // run eventually ends. Generous, because a multi-keyword sweep to 5,000 ads
  // legitimately takes a while.
  maxRunMs: num(process.env.MAX_RUN_MS, 90 * 60 * 1000),
  scrollSettleMs: num(process.env.SCROLL_SETTLE_MS, 2200),
  // How many consecutive scroll cycles with zero new ads before we conclude the
  // feed is exhausted. Kept high because Meta back-fills lazily.
  stableScrollsToStop: num(process.env.STABLE_SCROLLS_TO_STOP, 5),
  noNewAdsGraceMs: num(process.env.NO_NEW_ADS_GRACE_MS, 7000),

  // Parallel pages for the optional advertiser-detail enrichment.
  enrichConcurrency: num(process.env.ENRICH_CONCURRENCY, 3),

  // Relevance gate. Meta's keyword search is loose — searching "plumbing"
  // returns medical and ecommerce ads — so every harvested ad is scored against
  // the keyword's niche and anything below the threshold is dropped.
  relevance: {
    enabled: bool(process.env.RELEVANCE_ENABLED, true),
    minScore: num(process.env.RELEVANCE_MIN_SCORE, 40),
  },

  // Supabase — the shared library every run reads and writes. Cross-run dedup
  // lives here so repeat searches only ever surface NEW ads, and the Library
  // page queries it directly. Falls back to local SQLite when unreachable.
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceKey: process.env.SUPABASE_SERVICE_KEY || '',
    enabled: bool(process.env.SUPABASE_ENABLED, true),
  },

  // Google Maps scraper.
  maps: {
    maxTarget: num(process.env.MAPS_MAX_TARGET, 2500),
    defaultTarget: num(process.env.MAPS_DEFAULT_TARGET, 100),
    // Scrolling the results rail is how Maps paginates.
    scrollSettleMs: num(process.env.MAPS_SCROLL_SETTLE_MS, 1600),
    stableScrollsToStop: num(process.env.MAPS_STABLE_SCROLLS, 4),
    maxQueryMs: num(process.env.MAPS_MAX_QUERY_MS, 10 * 60 * 1000),
    maxRunMs: num(process.env.MAPS_MAX_RUN_MS, 60 * 60 * 1000),
  },

  dbPath: process.env.DB_PATH || path.resolve(__dirname, '../data/leads.db'),

  storageState: process.env.STORAGE_STATE && fs.existsSync(process.env.STORAGE_STATE)
    ? process.env.STORAGE_STATE
    : undefined,

  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

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
  // businesses OR genuinely runs out of ads while scrolling.
  targetAds: num(process.env.TARGET_ADS, 5000),

  // Safety ceiling for the WHOLE harvest (all keywords × countries), so a stuck
  // run eventually ends. Generous, because a multi-keyword sweep to 5,000 ads
  // legitimately takes a while.
  maxRunMs: num(process.env.MAX_RUN_MS, 90 * 60 * 1000),
  scrollSettleMs: num(process.env.SCROLL_SETTLE_MS, 2200),
  // How many consecutive scroll cycles with zero new ads before we conclude the
  // feed is exhausted. Kept high because Meta back-fills lazily.
  stableScrollsToStop: num(process.env.STABLE_SCROLLS_TO_STOP, 5),
  noNewAdsGraceMs: num(process.env.NO_NEW_ADS_GRACE_MS, 7000),

  // Parallel pages for the enrichment phases (FB contacts, owner lookup).
  enrichConcurrency: num(process.env.ENRICH_CONCURRENCY, 3),

  // The automatic owner-enrichment phase. On by default; can be disabled.
  // GOOGLE_ENRICH is the legacy name for this flag and is still honoured.
  ownerEnrichEnabled: bool(process.env.OWNER_ENRICH ?? process.env.GOOGLE_ENRICH, true),

  // Search-engine owner fallback, used when Hunter has no answer.
  ownerSearchEnabled: bool(process.env.OWNER_SEARCH_ENABLED, true),

  // Hunter.io — the primary owner/decision-maker source.
  //
  // Credits are metered per month and a harvest can surface thousands of
  // businesses, so paid calls are budgeted twice over: `maxCreditsPerRun` caps
  // one run, and `minCreditsReserve` stops us from draining the account to zero
  // (leaving headroom for other tooling on the same key). Both are enforced in
  // enrich/hunter.js on top of the free email-count gate.
  hunter: {
    apiKey: process.env.HUNTER_API_KEY || '',
    enabled: bool(process.env.HUNTER_ENABLED, true),
    maxCreditsPerRun: num(process.env.HUNTER_MAX_CREDITS_PER_RUN, 100),
    minCreditsReserve: num(process.env.HUNTER_MIN_CREDITS_RESERVE, 10),
    cacheDays: num(process.env.HUNTER_CACHE_DAYS, 30),
  },

  dbPath: process.env.DB_PATH || path.resolve(__dirname, '../data/leads.db'),

  storageState: process.env.STORAGE_STATE && fs.existsSync(process.env.STORAGE_STATE)
    ? process.env.STORAGE_STATE
    : undefined,

  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

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
  headful: bool(process.env.HEADFUL, true),
  slowMoMs: num(process.env.SLOW_MO_MS, 0),
  maxCardsPerKeyword: num(process.env.MAX_CARDS_PER_KEYWORD, 200),
  maxScrollMs: num(process.env.MAX_SCROLL_MS, 180000),
  stableScrollsToStop: num(process.env.STABLE_SCROLLS_TO_STOP, 2),
  scrollSettleMs: num(process.env.SCROLL_SETTLE_MS, 2500),
  noNewAdsGraceMs: num(process.env.NO_NEW_ADS_GRACE_MS, 8000),
  enrichConcurrency: num(process.env.ENRICH_CONCURRENCY, 2),
  storageState: process.env.STORAGE_STATE && fs.existsSync(process.env.STORAGE_STATE)
    ? process.env.STORAGE_STATE
    : undefined,
};

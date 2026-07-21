// Headless Ad Library harvester driven by the internal GraphQL feed.
//
// Strategy: navigate to a search URL, intercept the GraphQL responses that carry
// `search_results_connection`, and normalize them into unique ad records (one
// per collation group). Scroll to trigger the next feed page; stop when the
// orchestrator's target is reached or the feed genuinely runs dry.
//
// Media/images/fonts are blocked at the network layer — we already get every
// asset URL from the JSON, so there's no reason to download them. This is what
// makes harvesting thousands of ads headless-fast and memory-stable.

import pw from 'playwright';
import { config } from '../config.js';
import { buildSearchUrl } from '../urlBuilder.js';
import { extractAdsFromFeed } from './feedParser.js';
import { humanScroll, jitter } from './humanize.js';

const { chromium } = pw;

let browserPromise = null;
let contextPromise = null;

export async function getContext() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: config.headless,
      slowMo: config.slowMoMs,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    });
  }
  const browser = await browserPromise;
  if (!contextPromise) {
    contextPromise = browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      userAgent: config.userAgent,
      storageState: config.storageState,
    }).then(async (ctx) => {
      // Drop heavy assets we never need (we read their URLs from the feed JSON).
      await ctx.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (type === 'image' || type === 'media' || type === 'font') return route.abort();
        return route.continue();
      });
      return ctx;
    });
  }
  return contextPromise;
}

export async function shutdown() {
  try { (await contextPromise)?.close(); } catch {}
  try { (await browserPromise)?.close(); } catch {}
  browserPromise = null;
  contextPromise = null;
}

// Defensively parse a GraphQL response body (Meta may prefix anti-JSON tokens or
// concatenate multiple JSON objects).
function parseBodies(text) {
  if (!text || !/collated_results|ad_archive_id/.test(text)) return [];
  const bodies = [];
  const t = text.replace(/^for\s*\(;;\);/, '').trim();
  try { bodies.push(JSON.parse(t)); return bodies; } catch {}
  for (const line of t.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { bodies.push(JSON.parse(s)); } catch {}
  }
  return bodies;
}

// Harvest across all selected countries into a single deduped stream.
//   onAd(record)      — one unique feed ad (deduped by library_id within the run)
//   onProgress(info)  — { country, rawSeen, scrolls, phase }
//   onError(info)     — recoverable per-country error
//   shouldStop()      — orchestrator: target reached or user cancelled
export async function harvest({ filters, onAd, onProgress, onError, shouldStop }) {
  const ctx = await getContext();
  const rawSeen = new Set();          // library_ids emitted this run
  const countries = (filters.countries?.length ? filters.countries : ['US']);
  const runStart = Date.now();

  for (const country of countries) {
    if (shouldStop?.()) break;
    if (Date.now() - runStart > config.maxRunMs) break;
    try {
      await harvestCountry({ ctx, filters, country, rawSeen, onAd, onProgress, onError, shouldStop, runStart });
    } catch (err) {
      onError?.({ scope: 'country', country, message: err.message });
    }
  }
  return rawSeen.size;
}

async function harvestCountry({ ctx, filters, country, rawSeen, onAd: rawOnAd, onProgress, onError, shouldStop, runStart }) {
  const page = await ctx.newPage();
  const buffer = [];
  // Tag every record with the country it was harvested from.
  const onAd = (rec) => { rec.country = country; rawOnAd?.(rec); };

  const listener = async (res) => {
    try {
      if (!/\/api\/graphql/i.test(res.url())) return;
      const text = await res.text().catch(() => '');
      for (const json of parseBodies(text)) {
        for (const rec of extractAdsFromFeed(json)) buffer.push(rec);
      }
    } catch { /* ignore individual response errors */ }
  };
  page.on('response', listener);

  try {
    const url = buildSearchUrl(filters, country);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // The Ad Library streams results from its GraphQL feed a few seconds after
    // the SPA boots, and really only flows once you start scrolling. So gently
    // scroll while waiting for the first feed page (up to 60s). The feed is the
    // ONLY data source — there is no DOM fallback.
    const readyDeadline = Date.now() + 60000;
    while (Date.now() < readyDeadline && !buffer.length) {
      if (shouldStop?.()) return;
      await humanScroll(page, 700);
      await jitter(1400, 2200);
    }
    if (!buffer.length) {
      onError?.({ scope: 'country', country, message: `No ads returned for "${filters.keyword}" in ${country}.` });
      return;
    }

    let stableScrolls = 0;
    onProgress?.({ country, rawSeen: rawSeen.size, phase: 'harvesting' });

    while (!shouldStop?.()
        && stableScrolls < config.stableScrollsToStop
        && Date.now() - runStart < config.maxRunMs) {

      let added = drain(buffer, rawSeen, onAd);
      if (added === 0) {
        // Give Meta time to back-fill before declaring the feed exhausted.
        await jitter(config.noNewAdsGraceMs, config.noNewAdsGraceMs + 800);
        added = drain(buffer, rawSeen, onAd);
      }
      stableScrolls = added === 0 ? stableScrolls + 1 : 0;
      onProgress?.({ country, rawSeen: rawSeen.size, phase: 'harvesting' });

      await humanScroll(page, 1600);
      await jitter(config.scrollSettleMs, config.scrollSettleMs + 900);
    }
    drain(buffer, rawSeen, onAd); // final drain
  } finally {
    page.off('response', listener);
    try { await page.close(); } catch {}
  }
}

function drain(buffer, rawSeen, onAd) {
  let added = 0;
  while (buffer.length) {
    const rec = buffer.shift();
    if (!rec?.library_id || rawSeen.has(rec.library_id)) continue;
    rawSeen.add(rec.library_id);
    added++;
    try { onAd?.(rec); } catch { /* orchestrator handles its own errors */ }
  }
  return added;
}

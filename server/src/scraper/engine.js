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

// The browser is cached across runs, but a cached handle can go stale — the
// process can crash, run out of memory, be killed externally, or die while the
// machine sleeps. If we kept handing out a dead handle, every later run would
// fail with "Target page, context or browser has been closed" until the server
// was restarted by hand. So the browser is health-checked and relaunched on
// demand, and page creation retries once against a fresh browser.
let browserRef = null;
let contextRef = null;
let launching = null;

async function createContext() {
  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.slowMoMs,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  // Drop our cached handles the moment the browser goes away.
  browser.on('disconnected', () => {
    if (browserRef === browser) { browserRef = null; contextRef = null; }
  });

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    userAgent: config.userAgent,
    storageState: config.storageState,
  });
  // Drop heavy assets we never need (we read their URLs from the feed JSON).
  await ctx.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'media' || type === 'font') return route.abort();
    return route.continue();
  });

  browserRef = browser;
  contextRef = ctx;
  return ctx;
}

export async function getContext() {
  if (contextRef && browserRef?.isConnected()) return contextRef;
  // Reset stale handles, and make concurrent callers share one launch.
  browserRef = null;
  contextRef = null;
  if (!launching) {
    launching = createContext().finally(() => { launching = null; });
  }
  return launching;
}

// Open a page, healing a dead browser once. Use this everywhere instead of
// calling ctx.newPage() on a possibly-stale context.
export async function newPage() {
  try {
    return await (await getContext()).newPage();
  } catch (err) {
    console.warn('[browser] page creation failed, relaunching:', err.message);
    try { await browserRef?.close(); } catch {}
    browserRef = null;
    contextRef = null;
    return await (await getContext()).newPage();
  }
}

export async function shutdown() {
  try { await contextRef?.close(); } catch {}
  try { await browserRef?.close(); } catch {}
  browserRef = null;
  contextRef = null;
  launching = null;
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
  const rawSeen = new Set();          // library_ids emitted this run
  const countries = (filters.countries?.length ? filters.countries : ['US']);
  const keywords = (filters.keywords?.length ? filters.keywords : [filters.keyword]).filter(Boolean);
  const runStart = Date.now();

  // Each keyword is searched separately (Meta has no OR syntax — a combined
  // string would be treated as one literal phrase and match nothing) and every
  // country is searched per keyword. Results merge into one deduped stream.
  outer:
  for (const keyword of keywords) {
    for (const country of countries) {
      if (shouldStop?.()) break outer;
      if (Date.now() - runStart > config.maxRunMs) break outer;
      onProgress?.({ country, keyword, rawSeen: rawSeen.size, phase: 'harvesting' });
      try {
        await harvestCountry({ filters, country, keyword, rawSeen, onAd, onProgress, onError, shouldStop, runStart });
      } catch (err) {
        onError?.({ scope: 'keyword', country, keyword, message: err.message });
      }
    }
  }
  return rawSeen.size;
}

async function harvestCountry({ filters, country, keyword, rawSeen, onAd: rawOnAd, onProgress, onError, shouldStop, runStart }) {
  const page = await newPage();
  const buffer = [];
  // Tag every record with the country + keyword it was harvested from.
  const onAd = (rec) => { rec.country = country; rec.keyword = keyword; rawOnAd?.(rec); };

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
    const url = buildSearchUrl(filters, country, keyword);
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
      // Not an error — just a keyword with no matching ads in this country.
      onError?.({ scope: 'no_results', country, keyword, message: `No ads for "${keyword}" in ${country}.` });
      return;
    }

    let stableScrolls = 0;
    onProgress?.({ country, keyword, rawSeen: rawSeen.size, phase: 'harvesting' });

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
      onProgress?.({ country, keyword, rawSeen: rawSeen.size, phase: 'harvesting' });

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

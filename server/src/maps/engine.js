// Google Maps harvester.
//
// Strategy mirrors the Ad Library scraper: drive the real UI headlessly, but
// take the data from the internal JSON feed rather than the DOM. Scrolling the
// results rail is what makes Maps fetch the next page, so scrolling is the
// pagination mechanism.
//
// One thing genuinely does have to come from the DOM: the review COUNT. The
// `/search?tbm=map` payload carries the rating but not the count, while the rail
// exposes it on an accessibility label ("4.9 stars 905 Reviews"). Those labels
// are far more stable than class names, and each card's href carries the feature
// id, so the two sources join on a real key rather than on position.

import { config } from '../config.js';
import { newPage } from '../scraper/engine.js';
import { humanScroll, jitter } from '../scraper/humanize.js';
import { extractPlaces, parseBody } from './parser.js';

const SEARCH_RE = /\/search\?tbm=map|\/maps\/preview\/place|\/maps\/rpc\/search/;

// Read review counts + feature ids straight off the rail.
const READ_RAIL = `
(() => {
  const out = [];
  const feed = document.querySelector('div[role="feed"]');
  if (!feed) return out;
  for (const a of feed.querySelectorAll('a[href*="/maps/place/"]')) {
    // The card's href embeds the feature id: .../data=!4m7!3m6!1s0x...:0x...
    const m = (a.getAttribute('href') || '').match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
    const card = a.closest('div[jsaction]') || a.parentElement;
    if (!card) continue;
    // "4.9 stars 905 Reviews" — an accessibility label, so it survives restyles.
    const lbl = card.querySelector('span[role="img"][aria-label*="star"]');
    const aria = lbl ? lbl.getAttribute('aria-label') || '' : '';
    const rc = aria.match(/([\\d,.]+)\\s*Review/i);
    const rt = aria.match(/([\\d.]+)\\s*star/i);
    out.push({
      feature_id: m ? m[1] : null,
      name: (a.getAttribute('aria-label') || '').trim() || null,
      review_count: rc ? Number(rc[1].replace(/[,.]/g, '')) : null,
      rating: rt ? Number(rt[1]) : null,
    });
  }
  return out;
})()
`;

function searchUrl(query, { language = 'en', region = 'us' } = {}) {
  return `https://www.google.com/maps/search/${encodeURIComponent(query)}`
    + `?hl=${encodeURIComponent(language)}&gl=${encodeURIComponent(region)}`;
}

// Harvest one query. Calls onPlace for each unique place as it is found.
export async function harvestQuery({
  query, location, language, region,
  shouldStop, onPlace, onProgress, onError, onReviewCounts,
}) {
  const full = [query, location].filter(Boolean).join(' in ');
  const page = await newPage();
  const seen = new Set();       // feature ids emitted for this query
  const buffer = [];            // decoded place records awaiting drain
  const reviewCounts = new Map(); // feature id -> count, read from the rail

  const onResponse = async (res) => {
    try {
      if (!SEARCH_RE.test(res.url())) return;
      const text = await res.text().catch(() => '');
      if (!text || text.length < 500) return;
      const json = parseBody(text);
      if (!json) return;
      for (const p of extractPlaces(json, { query, location })) buffer.push(p);
    } catch { /* one bad response must not stop the run */ }
  };
  page.on('response', onResponse);

  try {
    await page.goto(searchUrl(full, { language, region }), {
      waitUntil: 'domcontentloaded', timeout: 60000,
    });

    // Maps sometimes lands on a consent interstitial before the rail renders.
    await dismissConsent(page);

    // Wait for the first payload; the rail only streams once it has rendered.
    const readyBy = Date.now() + 45000;
    while (Date.now() < readyBy && !buffer.length) {
      if (shouldStop?.()) return;
      await jitter(900, 1400);
    }
    if (!buffer.length) {
      onError?.({ scope: 'no_results', query: full, message: `No Maps results for "${full}".` });
      return;
    }

    let stableScrolls = 0;
    const started = Date.now();

    while (!shouldStop?.()
        && stableScrolls < config.maps.stableScrollsToStop
        && Date.now() - started < config.maps.maxQueryMs) {

      await readRail(page, reviewCounts);
      let added = drain(buffer, seen, reviewCounts, onPlace);

      if (added === 0) {
        // Give Maps a moment to backfill before calling the list exhausted.
        await jitter(1500, 2200);
        await readRail(page, reviewCounts);
        added = drain(buffer, seen, reviewCounts, onPlace);
      }
      stableScrolls = added === 0 ? stableScrolls + 1 : 0;
      onProgress?.({ query: full, found: seen.size });

      if (shouldStop?.()) break;
      await scrollRail(page);
      await jitter(config.maps.scrollSettleMs, config.maps.scrollSettleMs + 700);
    }

    // Final pass, so the last page isn't dropped.
    await readRail(page, reviewCounts);
    drain(buffer, seen, reviewCounts, onPlace);

    // Backfill review counts.
    //
    // The network payload lands with ~20 places well before the rail has
    // rendered cards for them, and a small target finishes in seconds — so
    // without waiting, the rail is still empty here and every count is lost.
    // Poll until the rail has covered what we emitted (or we run out of
    // patience), then hand the whole map back for the caller to patch.
    const wantBy = Date.now() + 12000;
    while (Date.now() < wantBy) {
      await readRail(page, reviewCounts);
      const covered = [...seen].filter((id) => reviewCounts.has(id)).length;
      if (seen.size && covered >= seen.size) break;
      await jitter(700, 1100);
    }
    onReviewCounts?.(reviewCounts);
  } finally {
    page.off('response', onResponse);
    try { await page.close(); } catch {}
  }
  return seen.size;
}

// Hand buffered places to the caller one at a time, re-checking the stop
// condition after every record so a target is never overshot.
function drain(buffer, seen, reviewCounts, onPlace) {
  let added = 0;
  while (buffer.length) {
    const p = buffer.shift();
    if (!p?.feature_id || seen.has(p.feature_id)) continue;
    seen.add(p.feature_id);
    added++;
    // Merge the rail's review count in on the way out.
    if (p.review_count == null && reviewCounts.has(p.feature_id)) {
      p.review_count = reviewCounts.get(p.feature_id);
    }
    try {
      if (onPlace?.(p) === false) { buffer.length = 0; break; }  // caller is full
    } catch { /* caller handles its own errors */ }
  }
  return added;
}

async function readRail(page, into) {
  const rows = await page.evaluate(READ_RAIL).catch(() => []);
  for (const r of rows || []) {
    if (r.feature_id && r.review_count != null) into.set(r.feature_id, r.review_count);
  }
}

// Scroll the results rail — this is what makes Maps load the next page.
async function scrollRail(page) {
  const moved = await page.evaluate(() => {
    const feed = document.querySelector('div[role="feed"]');
    if (!feed) return false;
    const before = feed.scrollTop;
    feed.scrollTop = feed.scrollHeight;
    return feed.scrollTop !== before;
  }).catch(() => false);
  // If the rail isn't scrollable (single result, or a different layout),
  // fall back to scrolling the window so the page still advances.
  if (!moved) await humanScroll(page, 900).catch(() => {});
}

async function dismissConsent(page) {
  for (const sel of [
    'button[aria-label*="Accept all"]', 'button[aria-label*="Reject all"]',
    'form[action*="consent"] button', 'button:has-text("Reject all")',
  ]) {
    try {
      const b = page.locator(sel).first();
      if (await b.count().then((c) => c > 0).catch(() => false)) {
        // Decline non-essential cookies where the choice exists.
        await b.click({ timeout: 2000 });
        await jitter(800, 1200);
        return;
      }
    } catch { /* try the next selector */ }
  }
}

// Run every query in turn, merging into one deduped stream.
export async function harvest({ filters, shouldStop, onPlace, onProgress, onError, onReviewCounts }) {
  const queries = (filters.queries || []).filter(Boolean);
  const locations = (filters.locations || []).filter(Boolean);
  // No location means "search the term as given".
  const pairs = locations.length
    ? queries.flatMap((q) => locations.map((l) => ({ query: q, location: l })))
    : queries.map((q) => ({ query: q, location: null }));

  const startedAt = Date.now();
  for (const { query, location } of pairs) {
    if (shouldStop?.()) break;
    if (Date.now() - startedAt > config.maps.maxRunMs) break;
    onProgress?.({ query: [query, location].filter(Boolean).join(' in '), found: 0, phase: 'searching' });
    try {
      await harvestQuery({
        query, location,
        language: filters.language, region: filters.region,
        shouldStop, onPlace, onProgress, onError, onReviewCounts,
      });
    } catch (err) {
      onError?.({ scope: 'query', query, message: err.message });
    }
  }
}

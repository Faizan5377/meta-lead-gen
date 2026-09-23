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

// How many learned category searches one run may fan out into. Enough to widen
// a niche, few enough that a broad keyword can't wander off into another trade.
const MAX_LEARNED_SEARCHES = 8;

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

function searchUrl(query, { language = 'en', region = 'us', at = null } = {}) {
  // `at` pins the search to a map viewport: /maps/search/<q>/@lat,lng,zoomz.
  // That is how the same query can be re-run over different parts of a city.
  const centre = at ? `/@${at.lat},${at.lng},${at.zoom}z` : '';
  return `https://www.google.com/maps/search/${encodeURIComponent(query)}${centre}`
    + `?hl=${encodeURIComponent(language)}&gl=${encodeURIComponent(region)}`;
}

// Maps rewrites the URL to /@lat,lng,zoomz once it settles on a viewport.
export function readViewport(url) {
  const m = String(url).match(/@(-?\d+\.\d+),(-?\d+\.\d+),([\d.]+)z/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]), zoom: Number(m[3]) } : null;
}

// A ring of viewports around a centre, so one query can sweep a whole city.
//
// Google returns at most ~120 results per search no matter how far you scroll,
// which is why a single "plumbers in Dallas" can never fill a target of 100 once
// quality filters bite. Each cell is a *different* viewport and so comes back
// with its own ~120 — different businesses, because Maps ranks by proximity to
// the centre.
//
// Cells come back NEAREST FIRST, which is what makes a generous ring safe: the
// sweep walks outward and stops the moment the target is met, so asking for a
// wide search costs nothing when the leads were nearby all along.
export function gridAround({ lat, lng, zoom }, ring = 1) {
  // Each cell is one zoom level tighter, so it covers about half the width of
  // the centre view — which makes a step of half that width tile it. Roughly
  // 0.09° ≈ 10 km at zoom 12, doubling for every level further out.
  const step = 0.09 * Math.pow(2, Math.max(0, 12 - zoom));
  const cells = [];
  for (let dy = -ring; dy <= ring; dy++) {
    for (let dx = -ring; dx <= ring; dx++) {
      if (dx === 0 && dy === 0) continue;        // the centre was already done
      cells.push({
        lat: Number((lat + dy * step).toFixed(6)),
        lng: Number((lng + dx * step).toFixed(6)),
        zoom: Math.min(14, zoom + 1),
        d: dx * dx + dy * dy,
      });
    }
  }
  return cells.sort((a, b) => a.d - b.d).map(({ d, ...cell }) => cell);
}

// Harvest one query. Calls onPlace for each unique place as it is found.
export async function harvestQuery({
  query, location, language, region, at,
  shouldStop, onPlace, onProgress, onError, onReviewCounts, onViewport,
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
    await page.goto(searchUrl(full, { language, region, at }), {
      waitUntil: 'domcontentloaded', timeout: 60000,
    });

    // Maps sometimes lands on a consent interstitial before the rail renders.
    await dismissConsent(page);

    // Remember where Maps centred, so the caller can sweep around it later.
    // Maps rewrites the URL with the viewport only once it has settled, so this
    // is reported whenever it becomes readable — the last reading wins.
    const reportViewport = () => {
      try { const v = readViewport(page.url()); if (v) onViewport?.(v); } catch {}
    };
    reportViewport();

    // Wait for the first payload; the rail only streams once it has rendered.
    const readyBy = Date.now() + 45000;
    while (Date.now() < readyBy && !buffer.length) {
      if (shouldStop?.()) return;
      reportViewport();
      await jitter(900, 1400);
    }
    if (!buffer.length) {
      onError?.({ scope: 'no_results', query: full, message: `No Maps results for "${full}".` });
      return;
    }
    reportViewport();

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
    reportViewport();

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

// Run every search in turn, merging into one deduped stream.
//
// Google caps ONE search at roughly 120 results however far you scroll. That cap
// is on the query, not on us: a target of 100 behind a strict quality gate
// finishes in single figures unless the supply is widened. So: the searches as
// typed, then the two ways to widen them, cheapest first — ask differently, then
// ask elsewhere. Each later pass is only entered while the target is short.
export async function harvest({
  filters, shouldStop, onPlace, onProgress, onError, onReviewCounts,
  needsMore, relatedTerms,
}) {
  const queries = (filters.queries || []).filter(Boolean);
  const locations = (filters.locations || []).filter(Boolean);
  // No location means "search the term as given".
  const pairsFor = (terms) => (locations.length
    ? terms.flatMap((q) => locations.map((l) => ({ query: q, location: l })))
    : terms.map((q) => ({ query: q, location: null })));

  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > config.maps.maxRunMs;
  const keepGoing = () => !shouldStop?.() && !outOfTime();
  const viewports = new Map();   // label -> the viewport Maps settled on
  const done = new Set();        // never search the same thing twice

  const label = ({ query, location }) => [query, location].filter(Boolean).join(' in ');

  async function runOne(pair, { at = null, phase = 'searching', note = '' } = {}) {
    const key = `${label(pair)}|${at ? `${at.lat},${at.lng},${at.zoom}` : ''}`.toLowerCase();
    if (done.has(key)) return;
    done.add(key);
    onProgress?.({ query: label(pair) + note, phase });
    try {
      await harvestQuery({
        ...pair, at,
        language: filters.language, region: filters.region,
        shouldStop, onPlace, onProgress, onError, onReviewCounts,
        onViewport: at ? undefined : (v) => viewports.set(label(pair), v),
      });
    } catch (err) {
      onError?.({ scope: phase === 'searching' ? 'query' : phase, query: pair.query, message: err.message });
    }
  }

  // ── Pass 1: the searches exactly as typed ─────────────────────────────────
  for (const pair of pairsFor(queries)) {
    if (!keepGoing()) return;
    await runOne(pair);
  }

  if (filters.autoExpand === false) return;

  // ── Pass 2: the categories Google gave the leads that passed ──────────────
  //
  // Nothing about any trade is hardcoded here. "Plumbers" teaches us that the
  // results worth keeping are categorised "Plumber", "Drainage service",
  // "Water heater installer" — each a fresh search with its own ~120 results,
  // and on-niche because it was learned from leads the user's own filters
  // accepted. Far cheaper per new lead than travelling.

  // "Plumbers" and "Plumber" are the same search to Google — don't spend a
  // minute proving it.
  const stem = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/s$/, '');
  const tried = new Set(queries.map(stem));

  // Re-learn between terms rather than deciding everything up front: each term
  // that lands teaches the next one.
  for (let i = 0; i < MAX_LEARNED_SEARCHES && keepGoing() && needsMore?.(); i++) {
    const term = (relatedTerms?.() || []).find((t) => t && !tried.has(stem(t)));
    if (!term) break;
    tried.add(stem(term));
    for (const pair of pairsFor([term])) {
      if (!keepGoing() || !needsMore?.()) return;
      await runOne(pair, { phase: 'related', note: ' — related search' });
    }
  }

  // ── Pass 3: sweep the surrounding area ────────────────────────────────────
  //
  // Cells come back nearest-first, and the target is re-checked before each
  // one, so `expandRing` is a ceiling rather than a plan.
  if (!needsMore?.()) return;

  for (const pair of pairsFor(queries)) {
    const centre = viewports.get(label(pair));
    if (!centre) continue;                        // Maps never settled on one

    const cells = gridAround(centre, filters.expandRing || 1);
    for (let i = 0; i < cells.length; i++) {
      if (!keepGoing() || !needsMore?.()) return;
      await runOne(pair, {
        at: cells[i], phase: 'expanding',
        note: ` — nearby area ${i + 1} of ${cells.length}`,
      });
    }
  }
}

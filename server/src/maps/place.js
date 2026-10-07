// Look one specific business up on Google Maps.
//
// This is Maps-as-verification, the mirror of maps/engine.js (Maps-as-a-source).
// There we ask "which businesses are in this city"; here we already have a
// business from the Ad Library and ask Google what it knows about it.
//
// The difference that drives the whole design: the results rail only carries
// TODAY's opening hours, while the place panel carries all seven days plus the
// review count. Verified against live payloads (scripts/probe-place.js):
//
//   /search?tbm=map      [64][i][1][203][0]  ->  [["Wednesday", …]]        today
//   /maps/preview/place  [6][203][0]         ->  [["Wednesday"…"Tuesday"]] full week
//
// So a 24-hours check has to reach the place panel. Everything else we need
// comes back in the same payload, which is why one visit is enough.

import { config } from '../config.js';
import { jitter } from '../scraper/humanize.js';
import { normalizePlace, parseBody } from './parser.js';

const PLACE_RE = /\/maps\/preview\/place|\/search\?tbm=map/;
const FEATURE_ID = /^0x[0-9a-f]+:0x[0-9a-f]+$/i;

// Find the place record wherever Google put it.
//
// Its root moves with the response — [6] in a place payload, [0][1][0][14] when
// a search resolves straight to one place, [64][i][1] in a rail — so this
// matches on SHAPE rather than a path: a place record is the array carrying a
// feature id at [10] and a name at [11]. Those two indices are what
// normalizePlace already requires, so anything this finds is normalizable.
export function findPlaceRecord(node, depth = 0) {
  if (depth > 14 || !Array.isArray(node)) return null;
  if (FEATURE_ID.test(String(node[10] ?? '')) && typeof node[11] === 'string' && node[11].trim()) {
    return node;
  }
  for (const child of node) {
    const hit = findPlaceRecord(child, depth + 1);
    if (hit) return hit;
  }
  return null;
}

// Day -> "Open 24 hours" / "8 AM–5 PM" / "Closed", for the whole week.
//
// Google annotates holidays into the DOM label ("Monday (Columbus Day)") but
// leaves the JSON day name clean; the regex strips it anyway, because a
// bank-holiday run must not silently drop a day.
export function weekHours(rec) {
  const days = rec?.[203]?.[0];
  if (!Array.isArray(days)) return null;
  const out = {};
  for (const d of days) {
    if (!Array.isArray(d)) continue;
    const day = String(d[0] ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
    const span = d?.[3]?.[0]?.[0];
    if (day && typeof span === 'string' && span.trim()) out[day] = span.trim();
  }
  return Object.keys(out).length ? out : null;
}

// Did we land on the place panel, or only on the rail?
//
// A rail payload repeats one day for every result; a place payload names
// several. Counting distinct days is what separates them, and it is also
// exactly the question the 24-hour gate needs answered.
export function isFullWeek(hours) {
  return !!hours && Object.keys(hours).length >= 5;
}

export async function lookupPlace(page, { query, language = 'en', region = 'us' } = {}) {
  const payloads = [];
  const onResponse = async (res) => {
    try {
      if (!PLACE_RE.test(res.url())) return;
      const text = await res.text().catch(() => '');
      if (!text || text.length < 500) return;
      const json = parseBody(text);
      if (json) payloads.push({ place: /preview\/place/.test(res.url()), json });
    } catch { /* one bad response must not fail the lookup */ }
  };
  page.on('response', onResponse);

  // Best record seen so far — a rail hit is better than nothing, but a place
  // payload replaces it because only that one carries the full week.
  const best = () => {
    for (const p of payloads) {
      if (!p.place) continue;
      const rec = findPlaceRecord(p.json);
      if (rec && isFullWeek(weekHours(rec))) return { rec, full: true };
    }
    for (const p of payloads) {
      const rec = findPlaceRecord(p.json);
      if (rec && isFullWeek(weekHours(rec))) return { rec, full: true };
    }
    for (const p of payloads) {
      const rec = findPlaceRecord(p.json);
      if (rec) return { rec, full: false };
    }
    return null;
  };

  try {
    await page.goto(
      `https://www.google.com/maps/search/${encodeURIComponent(query)}`
      + `?hl=${encodeURIComponent(language)}&gl=${encodeURIComponent(region)}`,
      { waitUntil: 'domcontentloaded', timeout: 45000 },
    );
    await dismissConsent(page);

    const deadline = Date.now() + config.verify.lookupMs;
    while (Date.now() < deadline && !best()) await jitter(600, 900);

    // Maps stops on the rail when the name is ambiguous. Opening the top card
    // is what makes it fetch the place panel — and the full week with it.
    if (!best()?.full) {
      try {
        const card = page.locator('div[role="feed"] a[href*="/maps/place/"]').first();
        if (await card.count().then((c) => c > 0).catch(() => false)) {
          await card.click({ timeout: 4000 });
          const until = Date.now() + config.verify.lookupMs;
          while (Date.now() < until && !best()?.full) await jitter(600, 900);
        }
      } catch { /* the rail record is still better than nothing */ }
    }

    const hit = best();
    if (!hit) return null;

    const place = normalizePlace(hit.rec, { query });
    if (!place) return null;
    return { ...place, hours: weekHours(hit.rec), hours_full_week: hit.full };
  } finally {
    page.off('response', onResponse);
  }
}

async function dismissConsent(page) {
  for (const sel of [
    'button[aria-label*="Reject all"]', 'button[aria-label*="Accept all"]',
    'form[action*="consent"] button',
  ]) {
    try {
      const b = page.locator(sel).first();
      if (await b.count().then((c) => c > 0).catch(() => false)) {
        await b.click({ timeout: 2000 });
        await jitter(600, 900);
        return;
      }
    } catch { /* try the next selector */ }
  }
}

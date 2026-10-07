// Does this Ad Library advertiser survive verification against Google Maps?
//
// Pure and side-effect free so it can be unit-tested without a browser, and so
// every rejection carries a reason. Nothing here knows what trade you searched
// for: the niche is a list of Google Maps categories handed in by the caller,
// which it works out per run (see verify/niche.js).
//
// Rejected advertisers never consume the run's target — same rule as the niche
// gate — so tightening these makes the list better rather than shorter.

const lower = (v) => String(v ?? '').toLowerCase();

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
export const ALL_DAYS = [...WEEKDAYS, 'Saturday', 'Sunday'];

export function termList(v) {
  return (Array.isArray(v) ? v : String(v ?? '').split(/[,;\n]/))
    .map((s) => lower(s).trim())
    .filter(Boolean);
}

const no = (reason) => ({ keep: false, reason });

// ── Opening hours ─────────────────────────────────────────────────────────
//
// "Open 24 hours" is Google's own wording for a round-the-clock day. A span
// like "8 AM–5 PM" is not 24 hours however long it looks, so this matches the
// phrase rather than trying to do arithmetic on the span.
export const isAllDay = (span) => /open\s*24\s*hours/i.test(String(span ?? ''));

// `days` is which days must be round-the-clock. Weekdays-only is the useful
// default: plenty of genuine 24/7 trades close their office at the weekend and
// still answer the phone at 3am on a Tuesday.
export function judgeHours(hours, { require24h = false, days = WEEKDAYS } = {}) {
  if (!require24h) return { keep: true };
  if (!hours || !Object.keys(hours).length) return no('no hours listed');

  const missing = days.filter((d) => !(d in hours));
  // A day Google never reported is not a day we can vouch for.
  if (missing.length) return no(`hours missing for ${missing.join(', ')}`);

  const notAllDay = days.filter((d) => !isAllDay(hours[d]));
  if (notAllDay.length) {
    return no(`${notAllDay[0]} is ${hours[notAllDay[0]]}, not 24 hours`);
  }
  return { keep: true };
}

// ── Matching the advertiser to the listing ────────────────────────────────
//
// This is a fuzzy join and getting it wrong attaches someone else's rating and
// hours to your lead, which is worse than having no data at all. So a match has
// to be evidenced, and the evidence is recorded on the lead.

const NOISE = /\b(inc|llc|ltd|co|corp|company|the|and|&|of|services?|service)\b/g;

export function normalizeName(v) {
  return lower(v).replace(/[.,'’"()]/g, ' ').replace(NOISE, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// Strip to the registrable-looking part so "www.acme.com" and
// "acme.com/careers" both reduce to "acme.com".
export function normalizeDomain(v) {
  const s = lower(v).replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].trim();
  return s && s.includes('.') ? s : '';
}

function tokenOverlap(a, b) {
  const A = new Set(a.split(' ').filter((t) => t.length > 2));
  const B = new Set(b.split(' ').filter((t) => t.length > 2));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / Math.min(A.size, B.size);
}

// Returns { ok, how, confidence }. `how` is what the UI and the CSV show, so a
// human can see why a lead was joined to a listing.
export function matchPlace(ad = {}, place = {}) {
  const adDomain = normalizeDomain(ad.domain);
  const placeDomain = normalizeDomain(place.website_domain || place.website);
  if (adDomain && placeDomain && adDomain === placeDomain) {
    return { ok: true, how: 'domain', confidence: 95 };
  }

  const adName = normalizeName(ad.name);
  const placeName = normalizeName(place.name);
  if (!adName || !placeName) return { ok: false, how: 'no match', confidence: 0 };

  if (adName === placeName) return { ok: true, how: 'exact name', confidence: 85 };

  const overlap = tokenOverlap(adName, placeName);
  // One shared word is a coincidence — "Comfort", "Air", "Services" are in
  // half the trade. Most of the name has to line up.
  if (overlap >= 0.8) return { ok: true, how: 'name', confidence: 70 };
  return { ok: false, how: 'no match', confidence: Math.round(overlap * 100) };
}

// ── The niche ─────────────────────────────────────────────────────────────
//
// Google's own category for the business, tested against the categories this
// run decided belong to the niche. This is what stops a technical school, a
// parts supplier or a marketing agency arriving in a list of contractors: they
// all advertise the trade heavily, so keyword scoring rates them highly, but
// Google files them as "Technical school", "Motor supplier" and so on.
export function matchesNiche(place = {}, categories = []) {
  if (!categories.length) return true;                 // not configured: allow
  const own = [place.category, ...(place.categories || [])].filter(Boolean).map(lower);
  if (!own.length) return false;
  return own.some((c) => categories.some((want) => c === want || c.includes(want)));
}

// ── The whole verdict ─────────────────────────────────────────────────────

export const DEFAULT_VERIFY = {
  nicheCheck: true,     // ask Google what the trade is called, and hold leads to it
  require24h: false,
  hoursDays: WEEKDAYS,
  niche: [],            // allowed Google Maps categories, lowercase
  minRating: 0,
  minReviews: 0,
  minMatch: 70,         // reject a join we cannot evidence
};

export function judgeVerified(ad, place, match, rules = DEFAULT_VERIFY) {
  if (!place) return no('not found on Google Maps');
  if (!match?.ok || match.confidence < (rules.minMatch ?? 70)) {
    return no(`no confident Google Maps match (${match?.how || 'none'})`);
  }
  if (!matchesNiche(place, rules.niche || [])) {
    return no(`category "${place.category || 'unknown'}" is not in the niche`);
  }

  const hours = judgeHours(place.hours, rules);
  if (!hours.keep) return hours;

  if (rules.minRating && (place.rating ?? 0) < rules.minRating) {
    return no(`rating ${place.rating ?? 0} < ${rules.minRating}`);
  }
  if (rules.minReviews && (place.review_count ?? 0) < rules.minReviews) {
    return no(`${place.review_count ?? 0} reviews < ${rules.minReviews}`);
  }
  return { keep: true };
}

export function normalizeVerifyFilters(body = {}) {
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const days = Array.isArray(body.hoursDays) && body.hoursDays.length
    ? ALL_DAYS.filter((d) => body.hoursDays.includes(d))
    : WEEKDAYS;
  return {
    // On by default: "only the businesses I'm actually looking for" is the
    // whole point of verifying, and the category is what delivers it.
    nicheCheck: body.nicheCheck !== false,
    require24h: body.require24h === true,
    hoursDays: days.length ? days : WEEKDAYS,
    niche: termList(body.niche).slice(0, 40),
    minRating: Math.max(0, Math.min(5, num(body.minRating, 0))),
    minReviews: Math.max(0, num(body.minReviews, 0)),
    minMatch: Math.max(0, Math.min(100, num(body.minMatch, 70))),
  };
}

// Is verification doing anything, or would it just cost a page load per lead?
export function isActive(v) {
  return !!v && (v.nicheCheck || v.require24h || v.niche.length > 0
    || v.minRating > 0 || v.minReviews > 0);
}

// Lead-quality gate for Maps results.
//
// Pure and side-effect free so it can be unit-tested without a browser. Every
// rejection carries a reason, because silently dropping results makes a scraper
// impossible to trust — the UI shows exactly what was filtered and why.
//
// Filtered places deliberately do NOT count toward the run's target, so asking
// for 100 good leads gives 100 good leads rather than 100 minus the rejects.

const lower = (v) => String(v ?? '').toLowerCase();

// Parse a comma/semicolon/newline separated list into lowercase terms.
export function termList(v) {
  return (Array.isArray(v) ? v : String(v ?? '').split(/[,;\n]/))
    .map((s) => lower(s).trim())
    .filter(Boolean);
}

const matchesAny = (haystack, terms) => terms.some((t) => lower(haystack).includes(t));

export const DEFAULT_QUALITY = {
  phone: 'any',            // any | required | none
  website: 'any',          // any | required | none
  minRating: 0,
  maxRating: 5,
  minReviews: 0,
  maxReviews: 0,           // 0 = no upper bound
  unratedOk: true,         // keep places with no rating yet
  excludeNames: [],        // drop if the business name contains any of these
  excludeCategories: [],   // drop if any category matches
  onlyCategories: [],      // if set, keep ONLY places matching one of these
  openNow: false,          // only places currently open
};

export function normalizeQuality(body = {}) {
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const mode = (v) => (['any', 'required', 'none'].includes(v) ? v : 'any');
  return {
    // `requirePhone` / `requireWebsite` are the older booleans; keep honouring
    // them so existing saved runs and API callers don't break.
    phone: mode(body.phone ?? (body.requirePhone ? 'required' : 'any')),
    website: mode(body.website ?? (body.requireWebsite ? 'required' : 'any')),
    minRating: Math.max(0, Math.min(5, num(body.minRating, 0))),
    maxRating: Math.max(0, Math.min(5, num(body.maxRating, 5))) || 5,
    minReviews: Math.max(0, num(body.minReviews, 0)),
    maxReviews: Math.max(0, num(body.maxReviews, 0)),
    unratedOk: body.unratedOk !== false,
    excludeNames: termList(body.excludeNames).slice(0, 40),
    excludeCategories: termList(body.excludeCategories).slice(0, 40),
    onlyCategories: termList(body.onlyCategories).slice(0, 40),
    openNow: body.openNow === true,
  };
}

// Returns { keep: true } or { keep: false, reason: '…' }.
export function judge(place, q = DEFAULT_QUALITY) {
  const rating = place.rating ?? null;
  const reviews = place.review_count ?? null;

  if (q.phone === 'required' && !place.phone) return no('no phone');
  if (q.phone === 'none' && place.phone) return no('has a phone');

  if (q.website === 'required' && !place.website) return no('no website');
  if (q.website === 'none' && place.website) return no('has a website');

  if (rating == null) {
    if (!q.unratedOk) return no('not rated yet');
  } else {
    if (q.minRating && rating < q.minRating) return no(`rating ${rating} < ${q.minRating}`);
    if (q.maxRating < 5 && rating > q.maxRating) return no(`rating ${rating} > ${q.maxRating}`);
  }

  // A place with no review count is only excluded when a minimum was asked for.
  if (q.minReviews && (reviews ?? 0) < q.minReviews) return no(`${reviews ?? 0} reviews < ${q.minReviews}`);
  if (q.maxReviews && (reviews ?? 0) > q.maxReviews) return no(`${reviews} reviews > ${q.maxReviews}`);

  if (q.excludeNames.length && matchesAny(place.name, q.excludeNames)) return no('name excluded');

  const cats = [place.category, ...(place.categories || [])].filter(Boolean).join(' | ');
  if (q.excludeCategories.length && matchesAny(cats, q.excludeCategories)) return no('category excluded');
  if (q.onlyCategories.length && !matchesAny(cats, q.onlyCategories)) return no('category not in list');

  if (q.openNow && !/^open/i.test(place.open_state || '')) return no('closed now');

  return { keep: true };
}

const no = (reason) => ({ keep: false, reason });

// Is any filter actually doing something? Used to label the UI honestly.
export function isActive(q) {
  return q.phone !== 'any' || q.website !== 'any'
    || q.minRating > 0 || q.maxRating < 5
    || q.minReviews > 0 || q.maxReviews > 0
    || !q.unratedOk || q.openNow
    || q.excludeNames.length > 0 || q.excludeCategories.length > 0 || q.onlyCategories.length > 0;
}

// Decode Google Maps' internal search response into place records.
//
// Maps' results rail is backed by `/search?tbm=map`, which returns a deeply
// nested JSON array behind an anti-XSSI prefix. Reading that is far more robust
// than scraping the DOM: the shape is machine-generated, so it survives the UI
// restyling that breaks class-name scrapers.
//
// Layout confirmed against a live response (scripts/probe-maps.js):
//
//   data[64]          the results block
//   data[64][0..1]    sponsored/ad entries  (skipped — they aren't real results)
//   data[64][i][1]    a place record, for i >= 2
//
// Field indices inside a place record:
//
//   [2]   address lines      ["1700 S 1st St", "Austin, TX 78704"]
//   [4][7] rating            4.9
//   [7]   website            ["https://…", "atxfamilydental.com", …]
//   [9]   geo                [null, null, lat, lng]
//   [10]  feature id         "0x8644b4eb0b01986f:0x6b241d4769ed491e"
//   [11]  name               "ATX Family Dental"
//   [13]  categories         ["Dentist", "Cosmetic dentist", …]
//   [14]  neighbourhood      "Bouldin Creek"
//   [30]  timezone           "America/Chicago"
//   [39]  full address       "1700 S 1st St, Austin, TX 78704"
//   [78]  place id           "ChIJb5gBC-u0RIYRHkntaUcdJGs"
//   [89]  google knowledge   "/g/11cn2mvqwc"
//   [157] profile photo
//   [166] city               "Austin, TX"
//   [178] phone              [["(512) 717-3147", …, "+15127173147", …]]
//   [203] opening hours
//   [243] country            "US"
//
// Review COUNT is deliberately absent from this response. It is read from the
// results rail instead and merged on feature id — see engine.js.

const at = (arr, ...path) => {
  let cur = arr;
  for (const k of path) {
    if (cur == null) return null;
    cur = cur[k];
  }
  return cur ?? null;
};

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// Strip the anti-XSSI prefix Google puts in front of the JSON.
export function parseBody(text) {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/^\)\]\}'\n?/, '')
    .replace(/^\/\*""\*\//, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Occasionally the payload is wrapped one level deeper.
    const i = cleaned.indexOf('[');
    if (i < 0) return null;
    try { return JSON.parse(cleaned.slice(i)); } catch { return null; }
  }
}

// Opening hours -> { Monday: "8 AM–5 PM", … } plus a plain "open now" string.
// block[0] is the list of day entries:
//   [["Wednesday", 3, [2026,9,23], [["8 AM–5 PM", [[8],[17]]]], 0, 1], …]
// Note this endpoint usually reports only TODAY's hours, not the whole week —
// the full week needs the place-detail endpoint.
function parseHours(block) {
  if (!Array.isArray(block)) return { hours: null, open_state: null };
  const out = {};
  const days = Array.isArray(block[0]) ? block[0] : [];
  for (const d of days) {
    if (!Array.isArray(d)) continue;               // guard: a string here would
    const day = str(at(d, 0));                     // index into its characters
    const span = str(at(d, 3, 0, 0));
    if (day && span) out[day] = span;
  }
  // "Open · Closes 5 PM"
  const state = str(at(block, 1, 4, 0)) || str(at(block, 1, 5, 0));
  return { hours: Object.keys(out).length ? out : null, open_state: state };
}

function parsePhone(block) {
  if (!Array.isArray(block)) return { phone: null, phone_e164: null };
  const first = block[0];
  return {
    phone: str(at(first, 0)),
    // The E.164 form is the one worth storing for dialling/CRM import.
    phone_e164: str(at(first, 3)),
  };
}

// The place's own website, ignoring Google's redirector entries.
function parseWebsite(block) {
  if (!Array.isArray(block)) return { website: null, website_domain: null };
  const url = str(block[0]);
  if (!url || /google\.[a-z.]+\//i.test(url)) return { website: null, website_domain: null };
  return { website: url, website_domain: str(block[1]) };
}

// One record -> our normalized shape. Returns null if it isn't a real place.
export function normalizePlace(rec, ctx = {}) {
  if (!Array.isArray(rec)) return null;

  const featureId = str(at(rec, 10));
  const name = str(at(rec, 11));
  if (!featureId || !name) return null;

  const { hours, open_state } = parseHours(at(rec, 203));
  const { phone, phone_e164 } = parsePhone(at(rec, 178));
  const { website, website_domain } = parseWebsite(at(rec, 7));

  const categories = (at(rec, 13) || []).filter((c) => typeof c === 'string');
  const lat = num(at(rec, 9, 2));
  const lng = num(at(rec, 9, 3));
  const placeId = str(at(rec, 78));

  return {
    // Identity
    feature_id: featureId,
    place_id: placeId,
    knowledge_id: str(at(rec, 89)),
    name,

    // Where
    address: str(at(rec, 39)) || (at(rec, 2) || []).filter(Boolean).join(', ') || null,
    street: str(at(rec, 2, 0)),
    city: str(at(rec, 166)),
    neighborhood: str(at(rec, 14)),
    country: str(at(rec, 243)),
    timezone: str(at(rec, 30)),
    latitude: lat,
    longitude: lng,

    // What
    category: categories[0] || null,
    categories,

    // Reputation — rating comes from the feed, review_count is merged from the
    // results rail because this endpoint omits it.
    rating: num(at(rec, 4, 7)),
    review_count: null,

    // Contact
    phone,
    phone_e164,
    website,
    website_domain,

    // Extras
    hours,
    open_state,
    photo_url: str(at(rec, 157)),
    owner_name: str(at(rec, 57, 1)),

    // Links a human can open
    maps_url: placeId
      ? `https://www.google.com/maps/place/?q=place_id:${placeId}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`,
    // The classic CID link, handy for Google Business Profile lookups.
    cid_url: cidFromFeatureId(featureId),

    // Provenance
    query: ctx.query || null,
    search_location: ctx.location || null,
  };
}

// Feature id "0x…:0xHEX" -> the decimal CID Google Business links use.
export function cidFromFeatureId(featureId) {
  const m = String(featureId || '').match(/0x[0-9a-f]+:0x([0-9a-f]+)/i);
  if (!m) return null;
  try {
    return `https://maps.google.com/?cid=${BigInt('0x' + m[1]).toString(10)}`;
  } catch {
    return null;
  }
}

// Pull every place out of one decoded response body.
export function extractPlaces(json, ctx = {}) {
  if (!Array.isArray(json)) return [];

  // The results block is normally index 64, but Google moves it occasionally —
  // so fall back to whichever top-level entry carries the most feature ids.
  let block = json[64];
  if (!Array.isArray(block) || !JSON.stringify(block).includes('0x')) {
    let best = null;
    let bestCount = 0;
    for (const v of json) {
      if (!Array.isArray(v)) continue;
      const n = (JSON.stringify(v).match(/0x[0-9a-f]{6,}:0x[0-9a-f]{6,}/g) || []).length;
      if (n > bestCount) { bestCount = n; best = v; }
    }
    block = best;
  }
  if (!Array.isArray(block)) return [];

  const out = [];
  for (const entry of block) {
    // A real result is [null, record]; sponsored entries have a different shape.
    const rec = Array.isArray(entry) && entry.length === 2 ? entry[1] : null;
    const place = normalizePlace(rec, ctx);
    if (place) out.push(place);
  }
  return out;
}

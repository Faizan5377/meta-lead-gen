// Work out what the searched trade is called in Google's own taxonomy.
//
// The problem this solves, from a live "HVAC" run: keyword relevance scored
// Lincoln Tech 79, HVAC-Plumber SEO Webmasters 85 and United HVAC Motors 84,
// while genuine contractors like Bourque Heating and Cooling scored 45. A
// company that SELLS TO or TRAINS a trade talks about that trade constantly, so
// text scoring rates it highly. Raising the threshold loses the contractors and
// keeps the suppliers.
//
// Google already made this distinction for us. Businesses that DO the work are
// filed as "HVAC contractor"; the others are "Technical school", "Marketing
// agency", "Motor supplier". So before the harvest starts we run one ordinary
// Maps search for the keyword and take a census of the categories that come
// back — those businesses are, by construction, the ones doing the job.
//
// Nothing about any trade is hardcoded. Searching "plumber" learns plumbing
// categories; searching "home services" learns a broad set, which is what a
// broad search deserves.

import { harvestQuery } from '../maps/engine.js';

const MIN_VOTES = 2;      // one business is not evidence — same rule as relevance.js
const MAX_CATEGORIES = 10;

// Big enough for the long tail to clear two votes. Measured on a live "HVAC"
// census: 119 businesses gave hvac contractor 105, air conditioning contractor
// 8, heating contractor 4 — at a 60 sample "heating contractor" never reached
// two and genuine furnace-led contractors would have been dropped.
const MAX_SAMPLE = 120;

// Only the PRIMARY category is counted. Secondary ones are where the drift
// lives: plumbers carry "Contractor" second, which would let roofers in.
export function censusCategories(places, { minVotes = MIN_VOTES, max = MAX_CATEGORIES } = {}) {
  const tally = new Map();
  for (const p of places) {
    const c = (p?.category || '').trim().toLowerCase();
    if (c) tally.set(c, (tally.get(c) || 0) + 1);
  }
  return [...tally.entries()]
    .filter(([, n]) => n >= minVotes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([c]) => c);
}

export async function learnNiche({
  keywords = [], language = 'en', region = 'us', shouldStop, onProgress, onError,
} = {}) {
  const term = keywords.find(Boolean);
  if (!term) return [];

  const places = [];
  onProgress?.({ phase: 'learning', query: term });
  try {
    await harvestQuery({
      query: term,
      location: null,
      language,
      region,
      // A census only needs enough businesses for the common categories to
      // repeat; it is not trying to find leads.
      shouldStop: () => places.length >= MAX_SAMPLE || !!shouldStop?.(),
      onPlace: (p) => { places.push(p); return places.length < MAX_SAMPLE; },
    });
  } catch (err) {
    onError?.({ scope: 'niche', message: err.message });
    return [];
  }

  const categories = censusCategories(places);
  onProgress?.({ phase: 'learned', categories, sampled: places.length });
  return categories;
}

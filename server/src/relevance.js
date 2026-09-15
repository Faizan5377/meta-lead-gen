// Niche relevance gate.
//
// Meta's keyword search is loose: searching "plumbing" returns a cholesterol
// supplement, a drain-hair gadget and a washing-machine tablet alongside actual
// plumbers. Every harvested ad is therefore scored against the niche and the
// weak ones are dropped.
//
// Two design rules, both deliberate:
//
//   1. NOTHING about any vertical is hardcoded. There is no list of "plumbing
//      words" or "medical words" — such a list can never cover every niche and
//      rots immediately. Scoring uses only the searched keyword, the ad's own
//      text, and Meta's own page-category taxonomy.
//
//   2. The niche is LEARNED during the run. A keyword like "home services"
//      rarely appears verbatim in a plumber's ad copy, so matching text alone
//      would reject good leads. Instead, ads that match the keyword directly
//      teach us which page categories belong to this niche ("Plumbing Service",
//      "Home Improvement"), and later ads are then accepted on category alone.
//      The niche profile therefore adapts to whatever was searched.
//
// The user can widen the niche with extra terms — data they supply per run,
// never code.

// Crude but effective suffix stripping so "plumbing", "plumber", "plumbers" and
// "plumb" all collapse together. A real stemmer would be overkill here.
export function stem(word) {
  let w = String(word || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (w.length <= 3) return w;
  for (const suf of ['ing', 'ers', 'er', 'ies', 'ion', 'ions', 'als', 'al', 'es', 's']) {
    if (w.length - suf.length >= 3 && w.endsWith(suf)) {
      w = w.slice(0, -suf.length);
      break;
    }
  }
  return w;
}

// Words too common to indicate a niche. Kept tiny and vertical-agnostic — these
// are English stopwords, not industry terms.
// Stemmed at construction, because tokens are compared after stemming — an
// unstemmed set would let "local" through as "loc".
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'you', 'your', 'our', 'we', 'us', 'a', 'an', 'of',
  'in', 'on', 'at', 'to', 'from', 'by', 'is', 'are', 'be', 'get', 'best', 'top',
  'near', 'me', 'my', 'all', 'new', 'now', 'more', 'service', 'services',
  'company', 'business', 'local', 'professional', 'quality', 'affordable',
].map(stem));

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(stem)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

// Distinctive terms from the searched keywords. If a keyword is entirely
// stopwords ("home services") we fall back to its raw tokens so the gate still
// has something to work with, just weakly.
function nicheTerms(keywords, extraTerms) {
  const raw = [...(keywords || []), ...(extraTerms || [])].join(' ');
  const strong = tokenize(raw);
  if (strong.length) return new Set(strong);
  const loose = String(raw).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3).map(stem);
  return new Set(loose);
}

const hasAny = (haystackTokens, terms) => haystackTokens.some((t) => terms.has(t));
const countAny = (haystackTokens, terms) => haystackTokens.reduce((n, t) => n + (terms.has(t) ? 1 : 0), 0);

// Weights. Ordered by how strongly each field says what a business actually DOES
// rather than what a single ad happens to mention.
const W = {
  category: 45,   // Meta's own classification of the advertiser
  pageName: 40,   // business names are descriptive ("Curly's Plumbing Inc.")
  domain: 22,     // their website usually names the trade
  copy: 45,       // ad text — weakest per mention, but repetition is real signal
  // A category carried by two or more confidently-relevant advertisers is
  // strong evidence on its own — it has to clear the threshold unaided, since
  // for a broad keyword like "home services" it is the ONLY signal a good
  // plumber will have. The corroboration requirement is what keeps it honest.
  learned: 45,
};

export function createRelevanceGate({ keywords = [], extraTerms = [], minScore = 40 } = {}) {
  const terms = nicheTerms(keywords, extraTerms);

  // category (lowercased) -> how many confidently-relevant ads carried it.
  const categoryProfile = new Map();
  // Learned categories need corroboration before they can vouch for an ad on
  // their own, otherwise one false positive would open the floodgates.
  const LEARN_THRESHOLD = 2;
  const CONFIDENT = 60;

  function categoriesOf(ad) {
    const raw = Array.isArray(ad.page_categories) ? ad.page_categories : [];
    return raw.map((c) => String(c).toLowerCase().trim()).filter(Boolean);
  }

  function score(ad) {
    if (!terms.size) return { score: 100, reason: 'no niche terms to check', decision: 'keep' };

    const cats = categoriesOf(ad);
    const catTokens = tokenize(cats.join(' '));
    const nameTokens = tokenize(ad.page_name);
    const domainTokens = tokenize(`${ad.display_domain || ''} ${ad.link_url || ''}`);
    const copyTokens = tokenize(
      `${ad.title || ''} ${ad.body_text || ''} ${ad.link_description || ''} ${ad.cta_text || ''}`,
    );

    let s = 0;
    const why = [];

    if (hasAny(catTokens, terms)) { s += W.category; why.push('category'); }
    if (hasAny(nameTokens, terms)) { s += W.pageName; why.push('name'); }
    if (hasAny(domainTokens, terms)) { s += W.domain; why.push('domain'); }

    const copyHits = countAny(copyTokens, terms);
    if (copyHits) {
      // One passing mention is not enough to pass on its own (24 < the default
      // 40 threshold); three mentions is genuinely on-topic.
      s += Math.min(W.copy, 14 + copyHits * 10);
      why.push(`copy×${copyHits}`);
    }

    // Learned niche categories carry an ad that never names the keyword —
    // the "home services" -> "Plumbing Service" bridge.
    if (!why.length || s < minScore) {
      const learnedHit = cats.find((c) => (categoryProfile.get(c) || 0) >= LEARN_THRESHOLD);
      if (learnedHit) { s += W.learned; why.push(`niche-category:${learnedHit}`); }
    }

    const finalScore = Math.min(100, s);
    return {
      score: finalScore,
      reason: why.length ? why.join(', ') : 'no niche signal',
      decision: finalScore >= minScore ? 'keep' : 'drop',
    };
  }

  // Teach the profile from an ad we're confident about, so its categories can
  // vouch for later ads. Only strong, text-backed matches teach.
  function learn(ad, result) {
    if (!result || result.score < CONFIDENT) return;
    if (String(result.reason).includes('niche-category')) return;  // don't self-reinforce
    // Learn ONLY the primary category — Meta lists it first and it is what the
    // business mainly is. Learning secondary ones bleeds the niche: plumbers
    // often carry "Construction" second, which then let a homebuilder through
    // on a plumbing search.
    const primary = categoriesOf(ad)[0];
    if (primary) categoryProfile.set(primary, (categoryProfile.get(primary) || 0) + 1);
  }

  function evaluate(ad) {
    const result = score(ad);
    learn(ad, result);
    return result;
  }

  return {
    evaluate,
    score,
    learn,
    terms: () => Array.from(terms),
    profile: () => Object.fromEntries(categoryProfile),
  };
}

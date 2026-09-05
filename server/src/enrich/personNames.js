// Pure helpers for pulling a person's name + role out of free text.
//
// Shared by the search-engine path, the company-website path, and Hunter's
// `position` strings so all three rank roles identically. Kept side-effect free
// so it can be unit-tested without a browser or network.

export const TITLES =
  'Founder|Co-?Founder|Co-?Founders|Founders|Owner|Co-?Owner|Proprietor|Proprietress|' +
  'CEO|C\\.E\\.O|Chief Executive(?: Officer)?|Managing Director|Managing Partner|' +
  'Managing Member|Director of Operations|Practice Owner|Practice Manager|' +
  'President|Vice President|Principal|Partner|Director|Head Coach|Broker|' +
  'Broker Owner|Managing Broker|Dentist|Physician|Attorney|Realtor';

// 2-4 tokens where the first and last are capitalised. Allows O'Brien,
// Jean-Luc, D'Angelo and initials, plus the lowercase particles that appear in
// real names ("Maria del Carmen Ruiz", "Jan van der Berg", "Omar bin Rashid").
// Only a single-letter INITIAL may carry a period. Allowing "Kim." would let a
// name run straight across a sentence boundary and fuse two people into one
// ("Ernest Kim. Zach Gordon").
const INITIAL = '[A-Z]\\.';
const WORD = "[A-Z][a-zA-Z'’\\-]{1,20}";
const CAP = `(?:${INITIAL}|${WORD})`;
const PARTICLE = '(?:de|del|della|di|da|dos|van|von|der|den|bin|ibn|al|el|la|le)';
export const NAME = `${CAP}(?:\\s+(?:${PARTICLE}|${CAP})){0,2}\\s+${WORD}`;

const HONORIFICS = 'Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Sir|Dame|Eng|Rev|Hon|Capt';

const LEADING_TITLE_RE = new RegExp(`^(?:${TITLES}|${HONORIFICS})\\.?\\s+`, 'i');
const TRAILING_TITLE_RE = new RegExp(`\\s+(?:${TITLES})$`, 'i');

// ── Role ranking ────────────────────────────────────────────────────────────
// Higher = more likely to be the actual owner of a small business.
export function titleRank(title = '') {
  const s = String(title).toLowerCase();
  if (!s) return 0;
  if (/\b(owner|proprietor|proprietress)\b/.test(s)) return 10;
  if (/\bfounder\b/.test(s)) return 9;
  if (/\b(ceo|c\.e\.o|chief executive)\b/.test(s)) return 8;
  if (/\bmanaging (director|partner|member|broker)\b/.test(s)) return 7;
  if (/\bpresident\b/.test(s)) return 6;
  if (/\bprincipal\b/.test(s)) return 5;
  if (/\b(broker|partner)\b/.test(s)) return 4;
  if (/\bdirector\b/.test(s)) return 3;
  if (/\b(manager|head)\b/.test(s)) return 2;
  return 1;
}

// Words that mean "this is an organisation, not a person".
const ORG_WORDS = new RegExp(
  '\\b(LLC|L\\.L\\.C|Inc|Incorporated|Ltd|Limited|GmbH|Pty|PLLC|LLP|Corp|Corporation|Co|' +
  'Company|Group|Holdings|Ventures|Partners|Associates|Agency|Agencies|Studio|Studios|' +
  'Clinic|Clinics|Dental|Dentistry|Orthodontics|Medical|Health|Hospital|Pharmacy|' +
  'Realty|Realtors|Properties|Property|Estates|Homes|Mortgage|Lending|Insurance|' +
  'Marketing|Media|Digital|Solutions|Services|Systems|Technologies|Consulting|' +
  'Fitness|Gym|Salon|Spa|Barbershop|Boutique|Cafe|Restaurant|Bakery|Kitchen|' +
  'Law|Legal|Attorneys|Academy|School|Institute|University|College|Church|' +
  'Center|Centre|Plumbing|Roofing|Landscaping|Construction|Builders|Contracting|' +
  'Auto|Motors|Detailing|Cleaning|Moving|Storage|Travel|Tours|Photography|Films)\\b',
  'i'
);

// Individual tokens that are never part of a person's name.
const STOP_WORDS = new Set([
  'facebook', 'instagram', 'linkedin', 'google', 'youtube', 'twitter', 'tiktok', 'x',
  'privacy', 'policy', 'cookie', 'cookies', 'terms', 'conditions', 'about', 'contact',
  'home', 'search', 'sign', 'log', 'login', 'register', 'menu', 'close', 'read',
  'more', 'learn', 'click', 'here', 'our', 'team', 'the', 'company', 'us', 'we',
  'staff', 'meet', 'welcome', 'skip', 'main', 'content', 'navigation', 'reviews',
  'review', 'rating', 'stars', 'photos', 'videos', 'hours', 'directions', 'call',
  'email', 'phone', 'website', 'address', 'map', 'share', 'follow', 'subscribe',
  'newsletter', 'blog', 'news', 'press', 'careers', 'jobs', 'services', 'products',
  'pricing', 'faq', 'help', 'support', 'copyright', 'reserved', 'rights', 'all',
  'united', 'states', 'kingdom', 'america', 'canada', 'australia', 'york', 'angeles',
  'chicago', 'houston', 'phoenix', 'london', 'dubai', 'toronto', 'sydney', 'texas',
  'california', 'florida', 'ontario', 'january', 'february', 'march', 'april', 'may',
  'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'chief', 'executive', 'officer', 'managing', 'director', 'president', 'founder',
  'owner', 'ceo', 'principal', 'partner', 'manager', 'view', 'profile', 'connect',
  'message', 'experience', 'education', 'skills', 'endorsements', 'posts',
  // Positional / call-to-action words that get swept onto the end of a name
  // when a page breaks a line oddly ("Seth Senestraro Above").
  'above', 'below', 'near', 'nearby', 'book', 'booking', 'appointment', 'call',
  'now', 'today', 'free', 'get', 'start', 'join', 'save', 'shop', 'find', 'open',
  'closed', 'next', 'previous', 'back', 'first', 'last', 'aka', 'formerly',
  'family', 'kids', 'care', 'smile', 'smiles', 'office', 'practice', 'location',
  'locations', 'patients', 'patient', 'insurance', 'emergency', 'schedule',
]);

const NAME_SHAPE = new RegExp(`^${NAME}$`);

// Page-layout words that get glued onto a name when a line breaks oddly. These
// are TRIMMED rather than used to reject the whole candidate, so
// "Seth Senestraro Above" recovers as "Seth Senestraro" instead of being lost.
const TRIM_WORDS = new Set([
  'above', 'below', 'near', 'nearby', 'book', 'booking', 'appointment', 'call',
  'now', 'today', 'free', 'get', 'start', 'join', 'save', 'shop', 'find', 'open',
  'closed', 'next', 'previous', 'back', 'more', 'less', 'read', 'learn', 'view',
  'click', 'here', 'home', 'about', 'contact', 'menu', 'close', 'share',
  'follow', 'subscribe', 'schedule', 'reviews', 'review', 'photos', 'hours',
  'location', 'locations', 'directions', 'map', 'welcome', 'meet', 'our', 'your',
]);

// Strip a role or honorific that got swept into the name ("CEO Jane Doe",
// "Jane Doe Founder", "Dr. Jane Doe"), plus any layout words on either end.
export function cleanName(raw) {
  let name = String(raw || '')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[,.;:|\-–—]+$/, '')
    .trim();
  // Apply repeatedly: "Dr. Founder Jane Doe" needs two passes.
  for (let i = 0; i < 3; i++) {
    const before = name;
    name = name.replace(LEADING_TITLE_RE, '').replace(TRAILING_TITLE_RE, '').trim();
    if (name === before) break;
  }

  // Trim layout words from either end, never below two tokens.
  let parts = name.split(/\s+/).filter(Boolean);
  const bare = (t) => t.replace(/[^a-zA-Z]/g, '').toLowerCase();
  while (parts.length > 2 && TRIM_WORDS.has(bare(parts[parts.length - 1]))) parts.pop();
  while (parts.length > 2 && TRIM_WORDS.has(bare(parts[0]))) parts.shift();
  return parts.join(' ');
}

// Would this string plausibly be a person's name, and not this business's own?
export function isPlausibleName(raw, businessName = '') {
  const name = String(raw || '').trim();
  if (!name || name.length < 4 || name.length > 60) return false;
  if (!NAME_SHAPE.test(name)) return false;
  if (ORG_WORDS.test(name)) return false;

  const tokens = name.split(/\s+/);
  if (tokens.length < 2 || tokens.length > 4) return false;

  // An ALL-CAPS token is a headline or an acronym, not a name.
  if (tokens.some((t) => t.length > 2 && t === t.toUpperCase())) return false;

  // A contraction is never part of a name ("I'm Jason Fried", "It's Dave Lee").
  // Real apostrophe names are O'Brien / D'Angelo, where the apostrophe is
  // followed by a capital — not by a lowercase verb ending.
  if (tokens.some((t) => /['’](?:s|m|re|ve|ll|d|t)$/i.test(t))) return false;

  // Odd internal capitals ("AKa", "SmileNow") are web-page artefacts, not
  // names. McDonald / MacLeod / O'Brien / D'Angelo are the legitimate forms.
  if (tokens.some((t) => {
    const rest = t.slice(1);
    if (!/[A-Z]/.test(rest)) return false;
    if (/^(?:Mc|Mac)[A-Z]/.test(t)) return false;
    return !/['’\-][A-Z]/.test(t);          // caps must follow an apostrophe/hyphen
  })) return false;

  // Every token must look like a word (or an initial), and none may be a stop word.
  for (const t of tokens) {
    const bare = t.replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (!bare) return false;
    if (bare.length === 1 && !/^[A-Z]\.?$/.test(t)) return false;
    if (bare.length > 1 && STOP_WORDS.has(bare)) return false;
  }
  // At least one real word is required. Bare initials ("J. R.") can't reach here
  // anyway — NAME ends in a multi-letter WORD — so this only guards odd input.
  if (tokens.filter((t) => t.replace(/[^a-zA-Z]/g, '').length > 1).length < 1) return false;

  // Reject the business's own name echoed back at us.
  const bn = String(businessName || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const ln = name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  if (bn) {
    if (ln === bn) return false;
    if (bn.includes(ln) || ln.includes(bn)) return false;
    // Overlapping word sets ("Perry Homes" vs "Perry Home Group").
    const bTokens = new Set(bn.split(/\s+/).filter((w) => w.length > 2));
    const shared = ln.split(/\s+/).filter((w) => w.length > 2 && bTokens.has(w));
    if (shared.length >= 2) return false;
  }
  return true;
}

// ── Extraction patterns, weakest to strongest ───────────────────────────────
// Each returns [name, title] pairs. `weight` reflects how much the phrasing
// itself implies "this person owns this business".
const PATTERNS = [
  // "Jane Doe - Founder - Acme Dental | LinkedIn" — the single most reliable
  // shape on the open web, because LinkedIn title tags are machine-generated.
  {
    weight: 14,
    re: new RegExp(`(${NAME})\\s*[-–—|]\\s*(?:the\\s+)?(${TITLES})\\b`, 'g'),
    map: (m) => [m[1], m[2]],
  },
  // "The founder of Acme is Jane Doe" / "Acme was founded by Jane Doe".
  // NOTE: no `i` flag on any pattern that embeds NAME — it would make NAME's
  // leading [A-Z] case-insensitive, letting the match run on into trailing
  // lowercase words ("Michael Chen in 2011"). Trigger words carry their own
  // case classes instead.
  {
    weight: 12,
    re: new RegExp(`(?:[Ff]ounder|[Oo]wner|CEO|[Cc]eo|[Pp]roprietor)[^.]{0,80}?\\bis\\s+(${NAME})`, 'g'),
    map: (m) => [m[1], 'Founder/Owner'],
  },
  {
    weight: 12,
    re: new RegExp(`\\b[Ff]ounded (?:and (?:is )?(?:owned|run|led) )?by\\s+(${NAME})`, 'g'),
    map: (m) => [m[1], 'Founder'],
  },
  // "Jane Doe is the owner" / "Jane Doe, who founded"
  {
    weight: 8,
    re: new RegExp(`(${NAME})\\s*,?\\s+(?:is|was)\\s+(?:the\\s+|a\\s+|our\\s+)?(${TITLES})\\b`, 'g'),
    map: (m) => [m[1], m[2]],
  },
  // "Founder: Jane Doe" / "Owner — Jane Doe"
  {
    weight: 7,
    re: new RegExp(`\\b(${TITLES})\\s*[:\\-–—]\\s*(${NAME})`, 'g'),
    map: (m) => [m[2], m[1]],
  },
  // "Jane Doe, Founder" / "Jane Doe (Owner)"
  {
    weight: 6,
    re: new RegExp(`(${NAME})\\s*[,(]\\s*(?:the\\s+)?(${TITLES})\\b`, 'g'),
    map: (m) => [m[1], m[2]],
  },
  // "Dr. Joshua Millsaps". Owner-operated professional practices — dentists,
  // clinics, law firms, vets — are a large share of Ad Library advertisers and
  // almost never print the word "Owner". The named practitioner is normally the
  // owner, and the eponymous bonus below confirms it when the practice carries
  // their surname ("Millsaps Dentistry").
  {
    weight: 4,
    re: new RegExp(`\\b(?:Dr|Doctor|Dra)\\.?\\s+(${NAME})`, 'g'),
    map: (m) => [m[1], 'Doctor'],
  },
  // "Knight, David James, DDS" — the surname-first form professional
  // directories use. Requiring a credential suffix keeps this precise, and the
  // name is re-ordered to First Last. Observed live: this was the actual owner
  // of Knight Pediatric Dentistry, in a listing the other patterns all missed.
  {
    weight: 5,
    re: new RegExp(`\\b(${WORD}),\\s*(${WORD}(?:\\s+${WORD})?),\\s*(?:DDS|DMD|MD|DO|DVM|OD|DPM|PhD|Esq|CPA|LPC|LCSW)\\b`, 'g'),
    map: (m) => [`${m[2]} ${m[1]}`, 'Doctor'],
  },
];

// Words too generic to prove a text is talking about a particular business.
const GENERIC_BIZ_WORDS = new Set([
  'the', 'and', 'for', 'llc', 'inc', 'ltd', 'corp', 'company', 'group', 'holdings',
  'studio', 'studios', 'clinic', 'center', 'centre', 'services', 'service',
  'solutions', 'agency', 'media', 'marketing', 'digital', 'dental', 'dentistry',
  'fitness', 'gym', 'salon', 'spa', 'law', 'legal', 'realty', 'homes', 'home',
  'properties', 'property', 'estate', 'auto', 'cafe', 'restaurant', 'shop',
  'store', 'official', 'page', 'best', 'top', 'new', 'your', 'our',
  // Speciality words: descriptive, not identifying. Dropping them leaves the
  // distinctive part of the name ("Senestraro" in "Senestraro Family
  // Orthodontics"), which is what association should actually key on.
  'orthodontics', 'orthodontist', 'pediatric', 'paediatric', 'family', 'implants',
  'implant', 'cosmetic', 'aesthetic', 'aesthetics', 'wellness', 'surgery',
  'surgical', 'oral', 'smiles', 'smile', 'care', 'health', 'healthcare',
]);

// The distinctive words of a business name — what must show up nearby for a
// piece of text to count as being ABOUT this business.
export function businessTokens(name) {
  return String(name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !GENERIC_BIZ_WORDS.has(w));
}

// Does this window of text actually mention the business? One distinctive word
// is enough when that's all the name has; otherwise require two, so "Smile" on
// its own can't vouch for "Smile Dental Studio".
export function mentionsBusiness(segment, tokens) {
  if (!tokens.length) return true;            // nothing distinctive to test
  const seg = String(segment).toLowerCase();
  const hits = tokens.reduce((n, t) => n + (seg.includes(t) ? 1 : 0), 0);
  return tokens.length === 1 ? hits >= 1 : hits >= 2;
}

// Association is scoped to the SENTENCE containing the match, not a character
// window. Directory pages (Yelp, YellowPages, Glassdoor) list many businesses
// on one page, so a window wide enough to be useful will always straddle a
// neighbouring listing — that's how "our founder Candace ... Knight Pediatric
// Dentistry" produced Candace as Knight's owner. A sentence is the smallest
// unit that reliably talks about one business.
const SENTENCE_SPLIT = /(?<=[.!?])[\s"'’)\]]+|[\n\r]+|\s[|·]\s|\s[—–]\s|\.{3}/g;

function sentenceAt(text, index) {
  SENTENCE_SPLIT.lastIndex = 0;
  let start = 0;
  let m;
  while ((m = SENTENCE_SPLIT.exec(text))) {
    const end = m.index + m[0].length;
    if (index < m.index) return text.slice(start, m.index);
    start = end;
  }
  return text.slice(start);
}

// Pull every candidate {name, title, weight} out of one block of text.
//
// `requireAssociation` is the guard against the worst failure mode: a search
// page mentions some unrelated person as an "Owner", and we confidently report
// them as this business's owner. With it on, a candidate only counts if the
// business is named within ~260 characters of the match. Website pages don't
// need it — being on the company's own domain is the association.
export function harvestCandidates(text, businessName = '', sourceWeight = 0, { requireAssociation = false } = {}) {
  const out = [];
  if (!text) return out;
  const clean = String(text).replace(/\s+/g, ' ').slice(0, 40000);
  const tokens = requireAssociation ? businessTokens(businessName) : [];
  // Surnames the business itself is named after.
  const eponyms = new Set(businessTokens(businessName));

  for (const { re, map, weight } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    let guard = 0;
    while ((m = re.exec(clean)) && guard++ < 400) {
      const [rawName, rawTitle] = map(m);
      const name = cleanName(rawName);
      if (!isPlausibleName(name, businessName)) continue;

      let bonus = 0;
      if (requireAssociation) {
        if (!mentionsBusiness(sentenceAt(clean, m.index), tokens)) continue;
        bonus = 4;                              // named in the same sentence
      }

      // The business carries this person's surname ("Millsaps Dentistry" ->
      // "Dr. Joshua Millsaps"): about as strong as small-business ownership
      // evidence gets, and it ties the person to THIS business unambiguously.
      const surname = name.split(/\s+/).pop().toLowerCase().replace(/[^a-z]/g, '');
      if (surname.length > 2 && eponyms.has(surname)) bonus += 9;

      out.push({
        name,
        title: normalizeTitle(rawTitle),
        weight: weight + sourceWeight + bonus,
      });
    }
  }
  return out;
}

export function normalizeTitle(raw) {
  const t = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!t) return null;
  if (/^co-?founders?$/i.test(t)) return 'Co-Founder';
  if (/^founders?$/i.test(t)) return 'Founder';
  if (/^co-?owner$/i.test(t)) return 'Co-Owner';
  if (/^(ceo|c\.e\.o)$/i.test(t)) return 'CEO';
  if (/^chief executive/i.test(t)) return 'CEO';
  // Title-case a lowercase match so the CSV reads consistently.
  return t.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// Many small advertisers put the owner's name straight in the page name:
// "Dr. Josh Parker Orthodontist", "Joshua M. Millsaps, DDS, PA". That's the
// business telling us who runs it, so it beats anything inferred from search.
//
// Precision comes from requiring an explicit signal — a "Dr." prefix or a
// professional credential. Without that, "Willo Cleans" would read as a person.
const DR_PREFIX_RE = new RegExp(`^\\s*(?:Dr|Dra|Doctor)\\.?\\s+(${NAME})`, 'i');
const CREDENTIAL_RE = new RegExp(`^\\s*(${NAME})\\s*,\\s*(?:DDS|DMD|MD|DO|DVM|OD|DPM|PhD|Esq|CPA|LPC|LCSW|MBA)\\b`, 'i');

export function ownerFromBusinessName(pageName) {
  const raw = String(pageName || '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;

  for (const re of [DR_PREFIX_RE, CREDENTIAL_RE]) {
    const m = raw.match(re);
    if (!m) continue;
    // Drop any trade word trailing the name ("Josh Parker Orthodontist").
    const name = cleanName(m[1])
      .replace(/\s+(?:Orthodontist|Orthodontics|Dentist|Dentistry|DDS|DMD|MD|Attorney|Realtor|Realty|Clinic|Practice|Center|Centre)$/i, '')
      .trim();
    // Deliberately NOT isPlausibleName: that rejects names overlapping the
    // business name, which is precisely the case we're handling here.
    if (!new RegExp(`^${NAME}$`).test(name)) continue;
    if (ORG_WORDS.test(name)) continue;
    return { name, title: /^\s*(?:Dr|Dra|Doctor)\b/i.test(raw) ? 'Doctor' : null };
  }
  return null;
}

// Merge candidates by person and pick the best. A name that appears in several
// places, or under a stronger role, wins.
export function bestCandidate(candidates) {
  if (!candidates?.length) return null;

  const byName = new Map();
  for (const c of candidates) {
    const key = c.name.toLowerCase();
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, {
        name: c.name,
        title: c.title,
        score: c.weight + titleRank(c.title) * 2,
        hits: 1,
        sources: new Set(c.source ? [c.source] : []),
      });
      continue;
    }
    prev.hits++;
    prev.score += 2;                                  // repetition is signal
    if (c.source) prev.sources.add(c.source);
    if (titleRank(c.title) > titleRank(prev.title)) { // keep the strongest role
      prev.title = c.title;
      prev.score += titleRank(c.title) - titleRank(prev.title);
    }
  }

  const ranked = Array.from(byName.values()).map((c) => ({
    ...c,
    // Independent corroboration is the strongest signal of all.
    score: c.score + (c.sources.size > 1 ? c.sources.size * 4 : 0),
    sources: Array.from(c.sources),
  }));

  ranked.sort((a, b) => b.score - a.score || b.hits - a.hits);
  return ranked[0];
}

// Map a raw score onto a 0-100 confidence so the UI and CSV can be filtered.
//
// Deliberately conservative. A name scraped from search text is an INFERENCE:
// business names are not unique (there are many companies called "Basecamp"),
// so even a well-formed "X is the owner of Basecamp" sentence may describe a
// different company with the same name. Only Hunter — which resolves through a
// specific DOMAIN — earns the top of the range, and only corroboration across
// independent sources pushes a scraped answer above CEILING_SINGLE_SOURCE.
export const CEILING_SINGLE_SOURCE = 65;
export const CEILING_CORROBORATED = 80;

export function scoreToConfidence(score, { sources = 1 } = {}) {
  if (!Number.isFinite(score)) return null;
  const raw = Math.round(score * 1.6);
  const ceiling = sources > 1 ? CEILING_CORROBORATED : CEILING_SINGLE_SOURCE;
  return Math.max(5, Math.min(ceiling, raw));
}

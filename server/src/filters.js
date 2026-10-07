import { config } from './config.js';
import { normalizeVerifyFilters } from './verify/gate.js';

// Canonical definitions of every filter the Meta Ad Library exposes, mirrored
// so the app can reproduce any search. The client renders these; urlBuilder.js
// turns a chosen set into a real Ad Library URL.

// ── Countries ────────────────────────────────────────────────────────────────
// Meta lets you scope to one/several countries or "All". This is the full set
// of ISO 3166-1 alpha-2 codes the Ad Library accepts (grouped for readability).
export const COUNTRIES = [
  { code: 'ALL', name: 'All countries' },

  // MENA
  { code: 'AE', name: 'United Arab Emirates' }, { code: 'SA', name: 'Saudi Arabia' },
  { code: 'EG', name: 'Egypt' }, { code: 'QA', name: 'Qatar' }, { code: 'KW', name: 'Kuwait' },
  { code: 'BH', name: 'Bahrain' }, { code: 'OM', name: 'Oman' }, { code: 'JO', name: 'Jordan' },
  { code: 'LB', name: 'Lebanon' }, { code: 'IQ', name: 'Iraq' }, { code: 'MA', name: 'Morocco' },
  { code: 'DZ', name: 'Algeria' }, { code: 'TN', name: 'Tunisia' }, { code: 'LY', name: 'Libya' },

  // North America
  { code: 'US', name: 'United States' }, { code: 'CA', name: 'Canada' }, { code: 'MX', name: 'Mexico' },

  // Europe
  { code: 'GB', name: 'United Kingdom' }, { code: 'IE', name: 'Ireland' }, { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' }, { code: 'ES', name: 'Spain' }, { code: 'PT', name: 'Portugal' },
  { code: 'IT', name: 'Italy' }, { code: 'NL', name: 'Netherlands' }, { code: 'BE', name: 'Belgium' },
  { code: 'CH', name: 'Switzerland' }, { code: 'AT', name: 'Austria' }, { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' }, { code: 'DK', name: 'Denmark' }, { code: 'FI', name: 'Finland' },
  { code: 'PL', name: 'Poland' }, { code: 'CZ', name: 'Czechia' }, { code: 'SK', name: 'Slovakia' },
  { code: 'HU', name: 'Hungary' }, { code: 'RO', name: 'Romania' }, { code: 'BG', name: 'Bulgaria' },
  { code: 'GR', name: 'Greece' }, { code: 'HR', name: 'Croatia' }, { code: 'RS', name: 'Serbia' },
  { code: 'UA', name: 'Ukraine' }, { code: 'TR', name: 'Türkiye' }, { code: 'RU', name: 'Russia' },

  // Asia-Pacific
  { code: 'IN', name: 'India' }, { code: 'PK', name: 'Pakistan' }, { code: 'BD', name: 'Bangladesh' },
  { code: 'LK', name: 'Sri Lanka' }, { code: 'NP', name: 'Nepal' }, { code: 'ID', name: 'Indonesia' },
  { code: 'MY', name: 'Malaysia' }, { code: 'SG', name: 'Singapore' }, { code: 'PH', name: 'Philippines' },
  { code: 'TH', name: 'Thailand' }, { code: 'VN', name: 'Vietnam' }, { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' }, { code: 'CN', name: 'China' }, { code: 'HK', name: 'Hong Kong' },
  { code: 'TW', name: 'Taiwan' }, { code: 'AU', name: 'Australia' }, { code: 'NZ', name: 'New Zealand' },

  // Latin America
  { code: 'BR', name: 'Brazil' }, { code: 'AR', name: 'Argentina' }, { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colombia' }, { code: 'PE', name: 'Peru' }, { code: 'EC', name: 'Ecuador' },
  { code: 'UY', name: 'Uruguay' }, { code: 'PY', name: 'Paraguay' }, { code: 'BO', name: 'Bolivia' },
  { code: 'VE', name: 'Venezuela' }, { code: 'CR', name: 'Costa Rica' }, { code: 'PA', name: 'Panama' },
  { code: 'DO', name: 'Dominican Republic' }, { code: 'GT', name: 'Guatemala' },

  // Africa
  { code: 'ZA', name: 'South Africa' }, { code: 'NG', name: 'Nigeria' }, { code: 'KE', name: 'Kenya' },
  { code: 'GH', name: 'Ghana' }, { code: 'ET', name: 'Ethiopia' }, { code: 'TZ', name: 'Tanzania' },
  { code: 'UG', name: 'Uganda' }, { code: 'CI', name: "Côte d'Ivoire" }, { code: 'SN', name: 'Senegal' },
  { code: 'CM', name: 'Cameroon' }, { code: 'ZW', name: 'Zimbabwe' }, { code: 'ZM', name: 'Zambia' },
];

const COUNTRY_CODES = new Set(COUNTRIES.map(c => c.code));

// ── Ad category (ad_type) ────────────────────────────────────────────────────
// "Properties / Employment / Financial" are legally-mandated categories Meta
// only enforces in a subset of countries; elsewhere it silently rewrites the
// URL, so we grey them out for unsupported countries.
export const AD_CATEGORIES = [
  { value: 'all', label: 'All ads' },
  { value: 'political_and_issue_ads', label: 'Issues, elections or politics' },
  { value: 'housing_ads', label: 'Properties', restrictedTo: ['US', 'CA'] },
  { value: 'employment_ads', label: 'Employment', restrictedTo: ['US', 'CA'] },
  { value: 'credit_ads', label: 'Financial products and services', restrictedTo: ['US', 'CA'] },
];

// ── Active status ──────────────────────────────────────────────────────────—
// Labels mirror Meta's wording exactly.
export const ACTIVE_STATUSES = [
  { value: 'active', label: 'Active ads' },
  { value: 'inactive', label: 'Inactive ads' },
  { value: 'all', label: 'Active and inactive ads' },
];

// ── Media type ───────────────────────────────────────────────────────────────
export const MEDIA_TYPES = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Image' },
  { value: 'meme', label: 'Meme' },
  { value: 'image_and_meme', label: 'Image and meme' },
  { value: 'video', label: 'Video' },
  { value: 'none', label: 'No image or video' },
];

// ── Call to action ───────────────────────────────────────────────────────────
//
// The Ad Library has no CTA filter, so this one is applied after the fact, on
// the `cta_text` the feed already gives us. It is Meta's own fixed button
// vocabulary — the same kind of platform taxonomy as MEDIA_TYPES above, not a
// list of niche words.
//
// `group` is the useful part. The button an advertiser picked says what the ad
// is FOR, which is usually a sharper filter than the keyword: in a live HVAC
// run, "Apply now" was almost entirely contractors recruiting technicians and
// trade schools selling courses, while "Book now" and "Get quote" were the
// businesses actually chasing customers.
export const CTA_ACTIONS = [
  { value: 'book now', label: 'Book now', group: 'Customer' },
  { value: 'get quote', label: 'Get quote', group: 'Customer' },
  { value: 'call now', label: 'Call now', group: 'Customer' },
  { value: 'contact us', label: 'Contact us', group: 'Customer' },
  { value: 'get offer', label: 'Get offer', group: 'Customer' },
  { value: 'get in touch', label: 'Get in touch', group: 'Customer' },
  { value: 'get promotions', label: 'Get promotions', group: 'Customer' },
  { value: 'check availability', label: 'Check availability', group: 'Customer' },
  { value: 'send message', label: 'Send message', group: 'Customer' },
  { value: 'send whatsapp message', label: 'Send WhatsApp message', group: 'Customer' },
  { value: 'get directions', label: 'Get directions', group: 'Customer' },

  { value: 'apply now', label: 'Apply now', group: 'Hiring & courses' },
  { value: 'sign up', label: 'Sign up', group: 'Hiring & courses' },
  { value: 'learn more', label: 'Learn more', group: 'Awareness' },
  { value: 'see details', label: 'See details', group: 'Awareness' },
  { value: 'watch more', label: 'Watch more', group: 'Awareness' },
  { value: 'listen now', label: 'Listen now', group: 'Awareness' },
  { value: 'download', label: 'Download', group: 'Awareness' },
  { value: 'subscribe', label: 'Subscribe', group: 'Awareness' },
  { value: 'like page', label: 'Like Page', group: 'Awareness' },
  { value: 'visit profile', label: 'Visit profile', group: 'Awareness' },
  { value: 'visit instagram profile', label: 'Visit Instagram profile', group: 'Awareness' },
  { value: 'open link', label: 'Open link', group: 'Awareness' },
  { value: 'save', label: 'Save', group: 'Awareness' },
  { value: 'interested', label: 'Interested', group: 'Awareness' },

  { value: 'shop now', label: 'Shop now', group: 'Commerce' },
  { value: 'order now', label: 'Order now', group: 'Commerce' },
  { value: 'install now', label: 'Install now', group: 'Commerce' },

  { value: 'none', label: 'No button', group: 'Other' },
];

const CTA_VALUES = new Set(CTA_ACTIONS.map((c) => c.value));

// An ad with no button is a real result, not missing data, so it gets its own
// value rather than being silently unfilterable.
export const ctaValue = (business = {}) => {
  const text = String(business.cta_text ?? '').trim().toLowerCase();
  return text || 'none';
};

// Empty list means "any CTA" — a filter you did not ask for must never drop a
// lead. Unknown buttons (Meta adds them) are kept unless you narrowed the list.
export function ctaMatches(business, allowed = []) {
  if (!allowed.length) return true;
  return allowed.includes(ctaValue(business));
}

// ── Publisher platforms (multi-select) ───────────────────────────────────────
export const PLATFORMS = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'audience_network', label: 'Audience Network' },
  { value: 'messenger', label: 'Messenger' },
  { value: 'threads', label: 'Threads' },
];
const PLATFORM_VALUES = new Set(PLATFORMS.map(p => p.value));

// ── Content languages (multi-select) ─────────────────────────────────────────
export const LANGUAGES = [
  { value: 'en', label: 'English' }, { value: 'ar', label: 'Arabic' },
  { value: 'es', label: 'Spanish' }, { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' }, { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' }, { value: 'nl', label: 'Dutch' },
  { value: 'sv', label: 'Swedish' }, { value: 'no', label: 'Norwegian' },
  { value: 'da', label: 'Danish' }, { value: 'fi', label: 'Finnish' },
  { value: 'pl', label: 'Polish' }, { value: 'tr', label: 'Turkish' },
  { value: 'ru', label: 'Russian' }, { value: 'uk', label: 'Ukrainian' },
  { value: 'zh', label: 'Chinese' }, { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' }, { value: 'hi', label: 'Hindi' },
  { value: 'ur', label: 'Urdu' }, { value: 'bn', label: 'Bengali' },
  { value: 'id', label: 'Indonesian' }, { value: 'ms', label: 'Malay' },
  { value: 'th', label: 'Thai' }, { value: 'vi', label: 'Vietnamese' },
  { value: 'fa', label: 'Persian' }, { value: 'he', label: 'Hebrew' },
  { value: 'el', label: 'Greek' }, { value: 'ro', label: 'Romanian' },
];
const LANGUAGE_VALUES = new Set(LANGUAGES.map(l => l.value));

// ── Keyword match type (search_type) ─────────────────────────────────────────
export const MATCH_TYPES = [
  { value: 'keyword_unordered', label: 'Broad (any order)' },
  { value: 'keyword_exact_phrase', label: 'Exact phrase' },
];

// ── Sort ─────────────────────────────────────────────────────────────────────
// Meta offers exactly these two and nothing else.
export const SORTS = [
  { value: 'impressions', label: 'Impressions: high to low' },
  { value: 'recent', label: 'Most recent' },
];

// ── Media type ───────────────────────────────────────────────────────────────
// Meta greys out media type for the political/issues category, where it does
// not apply.
export const MEDIA_TYPE_UNAVAILABLE_FOR = ['political_and_issue_ads'];

// Short help text per filter (shown in the UI's "i" tooltips). Mirrors what each
// Meta Ad Library filter actually does.
export const FILTER_HELP = {
  keyword: 'Words that appear in the ad text or the advertiser name. Add as many keywords as you like — each one is searched separately and the results are merged and de-duplicated.',
  matchType: 'Broad matches your words in any order; Exact phrase matches the words together, in order.',
  countries: 'The country/countries where the ads were shown. Choose one or several, or “All countries”.',
  adType: 'Meta’s ad category. “All ads” covers everything. Properties, Employment and Financial products are special transparency categories that only exist in the US and Canada.',
  activeStatus: 'Whether the ad is still running (Active), has stopped (Inactive), or both.',
  mediaType: 'The creative format of the ad — image, video, meme, or none.',
  platforms: 'Where the ad ran: Facebook, Instagram, Messenger, Audience Network or Threads. Leave empty for all.',
  languages: 'The language of the ad’s content. Leave empty for all languages.',
  dateRange: 'Filters by when the ad started running (Meta’s “Impressions by date”). Pick a from/to range.',
  target: 'How many unique businesses to collect before the harvest stops. One ad is kept per business (its longest-running one).',
  ctas: 'The button on the ad. Meta has no CTA filter, so this is applied to the harvested ad — and a rejected ad never uses up your target. The button says what the ad is FOR: “Apply now” is overwhelmingly recruiting and course ads, “Book now” and “Get quote” are businesses chasing customers.',
  verifyOnMaps: 'Look every surviving advertiser up on Google Maps and attach its opening hours, rating, review count, category and Maps link — then drop the ones that do not match. Costs one Maps visit per advertiser, so runs take longer and dig deeper.',
};

// Everything the client needs to render the filter panel, in one payload.
// Long option lists are alphabetized (special defaults kept first).
export const FILTER_META = {
  countries: [
    ...COUNTRIES.filter(c => c.code === 'ALL'),
    ...COUNTRIES.filter(c => c.code !== 'ALL').sort((a, b) => a.name.localeCompare(b.name)),
  ],
  adCategories: AD_CATEGORIES,
  activeStatuses: ACTIVE_STATUSES,
  mediaTypes: MEDIA_TYPES,
  ctas: CTA_ACTIONS,
  platforms: [...PLATFORMS].sort((a, b) => a.label.localeCompare(b.label)),
  languages: [...LANGUAGES].sort((a, b) => a.label.localeCompare(b.label)),
  matchTypes: MATCH_TYPES,
  sorts: SORTS,
  help: FILTER_HELP,
  defaultTarget: 100,
  maxTarget: config.maxTarget,
  // Tells the client which options to disable, and why, so the UI mirrors
  // Meta's own conditional behaviour instead of hardcoding rules twice.
  conditional: {
    adCategoryRestrictedTo: Object.fromEntries(
      AD_CATEGORIES.filter((c) => c.restrictedTo).map((c) => [c.value, c.restrictedTo]),
    ),
    mediaTypeUnavailableFor: MEDIA_TYPE_UNAVAILABLE_FOR,
  },
};

// Coerce an arbitrary request body into a validated, canonical filter object.
export function normalizeFilters(body = {}) {
  const errors = [];

  // Accept `keywords: []` (preferred) or a single `keyword` string. Commas,
  // semicolons and newlines split into separate keywords, so pasting a list
  // works and a comma-separated string never becomes one dead literal query.
  const raw = Array.isArray(body.keywords) ? body.keywords : [body.keywords ?? body.keyword];
  const keywords = raw
    .flatMap((k) => String(k ?? '').split(/[,;\n]/))
    .map((k) => k.trim())
    .filter(Boolean)
    .filter((v, i, a) => a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i)
    .slice(0, 50);
  if (!keywords.length) errors.push('At least one keyword is required');

  let countries = Array.isArray(body.countries) ? body.countries : (body.country ? [body.country] : []);
  countries = countries.map(c => String(c).toUpperCase()).filter(c => COUNTRY_CODES.has(c));
  if (!countries.length) countries = ['US'];

  const adType = AD_CATEGORIES.find(c => c.value === body.adType)?.value || 'all';
  const cat = AD_CATEGORIES.find(c => c.value === adType);
  if (cat?.restrictedTo && !countries.some(c => cat.restrictedTo.includes(c)) && !countries.includes('ALL')) {
    errors.push(`Ad category "${cat.label}" is only available in ${cat.restrictedTo.join(', ')}`);
  }

  const activeStatus = ACTIVE_STATUSES.find(s => s.value === body.activeStatus)?.value || 'active';
  const mediaType = MEDIA_TYPES.find(m => m.value === body.mediaType)?.value || 'all';

  const platforms = (Array.isArray(body.platforms) ? body.platforms : [])
    .map(String).filter(p => PLATFORM_VALUES.has(p));
  const languages = (Array.isArray(body.languages) ? body.languages : [])
    .map(String).filter(l => LANGUAGE_VALUES.has(l));

  const matchType = MATCH_TYPES.find(m => m.value === body.matchType)?.value || 'keyword_unordered';
  const sort = SORTS.find(s => s.value === body.sort)?.value || 'impressions';

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const startDateMin = dateRe.test(body.startDateMin || '') ? body.startDateMin : null;
  const startDateMax = dateRe.test(body.startDateMax || '') ? body.startDateMax : null;
  if (startDateMin && startDateMax && startDateMin > startDateMax) {
    errors.push('The "from" date must be on or before the "to" date');
  }

  // Meta only applies media type outside the political/issues category.
  const effectiveMediaType = MEDIA_TYPE_UNAVAILABLE_FOR.includes(adType) ? 'all' : mediaType;

  // Hard ceiling, so a run can never be asked for more than the app supports.
  const target = Math.max(
    1,
    Math.min(config.maxTarget, Number(body.target) || FILTER_META.defaultTarget),
  );

  // Niche relevance controls. `nicheTerms` widens the niche with the user's own
  // words — data supplied per run, never hardcoded verticals.
  const nicheTerms = (Array.isArray(body.nicheTerms) ? body.nicheTerms : String(body.nicheTerms || '').split(','))
    .map((t) => String(t).trim()).filter(Boolean).slice(0, 25);
  // The ad's button. Meta offers no CTA filter, so this is applied to the
  // harvested ad — and like the niche gate, a rejected ad never consumes the
  // target, so narrowing it makes the list better rather than shorter.
  const ctas = (Array.isArray(body.ctas) ? body.ctas : [])
    .map((c) => String(c).trim().toLowerCase())
    .filter((c) => CTA_VALUES.has(c));

  const relevanceEnabled = body.relevanceEnabled !== false;
  const minRelevance = Number.isFinite(Number(body.minRelevance))
    ? Math.max(0, Math.min(100, Number(body.minRelevance)))
    : undefined;

  return {
    filters: {
      keywords,
      keyword: keywords[0] || '', // convenience/display for single-keyword runs
      countries, adType, activeStatus, mediaType: effectiveMediaType,
      platforms, languages, matchType, sort, startDateMin, startDateMax, target,
      advertiserIds: (Array.isArray(body.advertiserIds) ? body.advertiserIds : []).map(String).slice(0, 50),
      relevanceEnabled, nicheTerms, minRelevance, ctas,
      enrichAdvertisers: body.enrichAdvertisers !== false,
      // Google Maps verification: hours, rating, reviews and the niche check.
      verifyOnMaps: body.verifyOnMaps === true,
      verify: normalizeVerifyFilters(body.verify ?? body),
    },
    errors,
  };
}

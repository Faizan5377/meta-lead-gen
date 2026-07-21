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
export const SORTS = [
  { value: 'relevance', label: 'Most relevant' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
];

// Short help text per filter (shown in the UI's "i" tooltips). Mirrors what each
// Meta Ad Library filter actually does.
export const FILTER_HELP = {
  keyword: 'Words that appear in the ad text or the advertiser name. Meta matches ads containing your keyword.',
  matchType: 'Broad matches your words in any order; Exact phrase matches the words together, in order.',
  countries: 'The country/countries where the ads were shown. Choose one or several, or “All countries”.',
  adType: 'Meta’s ad category. “All ads” covers everything. Properties, Employment and Financial products are special transparency categories that only exist in the US and Canada.',
  activeStatus: 'Whether the ad is still running (Active), has stopped (Inactive), or both.',
  mediaType: 'The creative format of the ad — image, video, meme, or none.',
  platforms: 'Where the ad ran: Facebook, Instagram, Messenger, Audience Network or Threads. Leave empty for all.',
  languages: 'The language of the ad’s content. Leave empty for all languages.',
  dateRange: 'Filters by when the ad started running (Meta’s “Impressions by date”). Pick a from/to range.',
  target: 'How many unique businesses to collect before the harvest stops. One ad is kept per business (its longest-running one).',
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
  platforms: [...PLATFORMS].sort((a, b) => a.label.localeCompare(b.label)),
  languages: [...LANGUAGES].sort((a, b) => a.label.localeCompare(b.label)),
  matchTypes: MATCH_TYPES,
  sorts: SORTS,
  help: FILTER_HELP,
  defaultTarget: 5000,
};

// Coerce an arbitrary request body into a validated, canonical filter object.
export function normalizeFilters(body = {}) {
  const errors = [];

  const keyword = String(body.keyword || '').trim();
  if (!keyword) errors.push('keyword is required');

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
  const sort = SORTS.find(s => s.value === body.sort)?.value || 'relevance';

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const startDateMin = dateRe.test(body.startDateMin || '') ? body.startDateMin : null;
  const startDateMax = dateRe.test(body.startDateMax || '') ? body.startDateMax : null;

  const target = Math.max(1, Math.min(20000, Number(body.target) || FILTER_META.defaultTarget));

  return {
    filters: {
      keyword, countries, adType, activeStatus, mediaType,
      platforms, languages, matchType, sort, startDateMin, startDateMax, target,
    },
    errors,
  };
}

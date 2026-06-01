// Curated subset of Meta Ad Library country options (ISO 3166-1 alpha-2 → display name).
// Focus: Ventix AI primary geos (MENA + North America) first, then the rest of the
// commonly-searched markets. Operator picks one canonical entry per session.
export const LOCATIONS = [
  // Ventix primary geos
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'EG', name: 'Egypt' },
  { code: 'QA', name: 'Qatar' },
  { code: 'KW', name: 'Kuwait' },
  { code: 'BH', name: 'Bahrain' },
  { code: 'OM', name: 'Oman' },
  { code: 'JO', name: 'Jordan' },
  { code: 'LB', name: 'Lebanon' },
  { code: 'MA', name: 'Morocco' },
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },

  // English-speaking markets
  { code: 'GB', name: 'United Kingdom' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'IE', name: 'Ireland' },

  // Europe
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'FI', name: 'Finland' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'BE', name: 'Belgium' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'AT', name: 'Austria' },
  { code: 'GR', name: 'Greece' },
  { code: 'CZ', name: 'Czechia' },
  { code: 'RO', name: 'Romania' },
  { code: 'HU', name: 'Hungary' },
  { code: 'TR', name: 'Türkiye' },

  // Asia-Pacific
  { code: 'IN', name: 'India' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'SG', name: 'Singapore' },
  { code: 'PH', name: 'Philippines' },
  { code: 'TH', name: 'Thailand' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'TW', name: 'Taiwan' },

  // Latin America
  { code: 'MX', name: 'Mexico' },
  { code: 'BR', name: 'Brazil' },
  { code: 'AR', name: 'Argentina' },
  { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colombia' },
  { code: 'PE', name: 'Peru' },

  // Africa
  { code: 'ZA', name: 'South Africa' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'KE', name: 'Kenya' },
  { code: 'GH', name: 'Ghana' },
];

// Meta restricts "Properties / Financial / Employment" categories to countries
// that enforce them via law (US, Canada, and a small set of expanding markets).
// In other countries, Meta silently rewrites our `ad_type` to
// `political_and_issue_ads` (its global fallback) and drops the `q` parameter.
// `restrictedTo: undefined` means "available everywhere".
export const AD_CATEGORIES = [
  { value: 'all', label: 'All ads' },
  { value: 'housing_ads',  label: 'Properties',
    recommended: true, hint: 'Best for real estate keywords (US, CA only)',
    restrictedTo: ['US', 'CA'] },
  { value: 'credit_ads', label: 'Financial products and services',
    recommended: true, hint: 'Best for mortgage keywords (US, CA only)',
    restrictedTo: ['US', 'CA'] },
  { value: 'employment_ads', label: 'Employment',
    hint: 'US, CA only',
    restrictedTo: ['US', 'CA'] },
  { value: 'political_and_issue_ads', label: 'Issues, elections or politics' },
];

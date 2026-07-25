// Build a Meta Ad Library search URL from a normalized filter set. One country
// per URL — the engine iterates multiple selected countries and merges results,
// which avoids guessing Meta's undocumented multi-country array syntax.

export function buildSearchUrl(filters, country, keyword) {
  const params = new URLSearchParams({
    active_status: filters.activeStatus || 'active',
    ad_type: filters.adType || 'all',
    country: country || filters.countries?.[0] || 'US',
    is_targeted_country: 'false',
    media_type: filters.mediaType || 'all',
    q: keyword || filters.keywords?.[0] || filters.keyword || '',
    search_type: filters.matchType || 'keyword_unordered',
  });

  // Publisher platforms and content languages are array params.
  (filters.platforms || []).forEach((p, i) => params.set(`publisher_platforms[${i}]`, p));
  (filters.languages || []).forEach((l, i) => params.set(`content_languages[${i}]`, l));

  // Ad-delivery start-date range.
  if (filters.startDateMin) params.set('start_date[min]', filters.startDateMin);
  if (filters.startDateMax) params.set('start_date[max]', filters.startDateMax);

  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

export function adSnapshotUrl(libraryId) {
  return `https://www.facebook.com/ads/library/?id=${libraryId}`;
}

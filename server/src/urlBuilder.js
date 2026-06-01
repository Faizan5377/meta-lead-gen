export function buildSearchUrl({ country, keyword, adType = 'all' }) {
  const params = new URLSearchParams({
    active_status: 'active',
    ad_type: adType,
    country,
    is_targeted_country: 'false',
    media_type: 'all',
    q: keyword,
    search_type: 'keyword_unordered',
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

export function adSnapshotUrl(libraryId) {
  return `https://www.facebook.com/ads/library/?id=${libraryId}`;
}

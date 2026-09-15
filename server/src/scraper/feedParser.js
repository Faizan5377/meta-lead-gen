// Turn a Meta Ad Library GraphQL response into normalized ad records.
//
// Shape (confirmed by probe):
//   data.ad_library_main.search_results_connection.edges[].node.collated_results[]
// Each collated_results[] entry is one ad; a group ("22 ads use this creative")
// shares a collation_id. We keep ONE representative per group so the harvest is
// unique ads, never the collapsed multi-ad bundles.

import { daysSince, decodeFacebookLink, hostFromUrl, isoFromUnix, snippet } from './parsers.js';

// Locate the edges array defensively (schema can drift / be nested differently).
function findEdges(json) {
  const direct = json?.data?.ad_library_main?.search_results_connection?.edges;
  if (Array.isArray(direct)) return direct;

  // Fallback: breadth-first search for any *_connection.edges whose nodes look
  // like ad results.
  const queue = [json];
  let guard = 0;
  while (queue.length && guard++ < 5000) {
    const cur = queue.shift();
    if (!cur || typeof cur !== 'object') continue;
    if (Array.isArray(cur.edges) && cur.edges.some(e => e?.node?.collated_results || e?.node?.ad_archive_id)) {
      return cur.edges;
    }
    for (const v of Object.values(cur)) if (v && typeof v === 'object') queue.push(v);
  }
  return [];
}

export function extractAdsFromFeed(json) {
  const edges = findEdges(json);
  const out = [];
  for (const edge of edges) {
    const node = edge?.node;
    if (!node) continue;
    const group = Array.isArray(node.collated_results) && node.collated_results.length
      ? node.collated_results
      : [node];
    const rep = group[0];
    if (!rep) continue;
    const groupSize = Number(node.collation_count) || Number(rep.collation_count) || group.length || 1;
    const rec = normalizeFeedAd(rep, groupSize);
    if (rec) out.push(rec);
  }
  return out;
}

// Meta's own platform enum -> the labels we show and filter on.
const PLATFORM_LABEL = {
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  AUDIENCE_NETWORK: 'Audience Network',
  MESSENGER: 'Messenger',
  THREADS: 'Threads',
  WHATSAPP: 'WhatsApp',
};

function normalizePlatforms(raw) {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return Array.from(new Set(list.map((p) => PLATFORM_LABEL[String(p).toUpperCase()] || String(p))));
}

function normalizeFeedAd(r, groupSize) {
  const libraryId = r.ad_archive_id || r.adArchiveID;
  if (!libraryId) return null;
  const s = r.snapshot || {};

  const startDate = isoFromUnix(r.start_date ?? s.start_date);
  const endDate = isoFromUnix(r.end_date ?? s.end_date);
  const linkUrl = decodeFacebookLink(s.link_url) || s.link_url || null;

  const categories = Array.isArray(s.page_categories)
    ? Array.from(new Set(s.page_categories.filter(Boolean)))
    : [];

  const media = normalizeMedia(s);
  const displayDomain = s.caption || hostFromUrl(linkUrl);

  return {
    library_id: String(libraryId),
    page_id: r.page_id != null ? String(r.page_id) : (s.page_id != null ? String(s.page_id) : null),
    page_name: s.page_name || null,
    page_url: s.page_profile_uri || null,
    page_categories: categories,
    // page_like_count is the FACEBOOK follower count — the only follower figure
    // the feed carries. Instagram followers live in the "About the advertiser"
    // modal, which costs a page visit, so they're filled by optional enrichment.
    followers_facebook: numOrNull(s.page_like_count),
    followers_instagram: null,
    instagram_handle: null,
    facebook_handle: null,
    page_category: null,
    advertiser_bio: null,
    page_created_on: null,
    page_profile_picture_url: s.page_profile_picture_url || null,

    // The platforms this ad actually runs on, straight from the feed.
    platforms: normalizePlatforms(r.publisher_platform),

    is_active: r.is_active === true || r.is_active === 'true',
    start_date: startDate,
    end_date: endDate,
    days_running: startDate ? daysSince(startDate) : null,
    total_active_time: numOrNull(r.total_active_time),
    // How many ads share this creative — Meta's "N ads use this creative".
    ads_running: groupSize,
    collation_id: r.collation_id || null,
    // Direct link so the ad can be opened in the Ad Library by hand.
    ad_url: `https://www.facebook.com/ads/library/?id=${libraryId}`,

    cta_text: s.cta_text || null,
    cta_type: s.cta_type || null,
    title: s.title || null,
    body_text: snippet(s.body?.text || s.body?.markup?.__html || '', 400) || null,
    link_url: linkUrl,
    link_description: s.link_description || null,
    display_domain: displayDomain || null,
    display_format: s.display_format || media.kind || null,
    image_url: media.image,
    video_url: media.video,

    // Filled by the relevance gate.
    relevance_score: null,
    relevance_reason: null,
  };
}

function normalizeMedia(s) {
  let image = null, video = null, kind = null;
  const imgs = Array.isArray(s.images) ? s.images : [];
  const vids = Array.isArray(s.videos) ? s.videos : [];
  if (vids.length) {
    kind = 'video';
    video = vids[0].video_hd_url || vids[0].video_sd_url || null;
    image = vids[0].video_preview_image_url || null;
  } else if (imgs.length) {
    kind = 'image';
    image = imgs[0].original_image_url || imgs[0].resized_image_url || null;
  }
  // Carousel cards
  if (!image && !video && Array.isArray(s.cards) && s.cards.length) {
    kind = 'carousel';
    const c = s.cards[0];
    image = c.original_image_url || c.resized_image_url || null;
    video = c.video_hd_url || c.video_sd_url || null;
  }
  return { image, video, kind };
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

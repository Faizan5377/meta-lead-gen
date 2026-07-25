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
    followers: numOrNull(s.page_like_count),

    is_active: r.is_active === true || r.is_active === 'true',
    start_date: startDate,
    end_date: endDate,
    days_running: startDate ? daysSince(startDate) : null,
    total_active_time: numOrNull(r.total_active_time),
    collation_count: groupSize,

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

    // Enrichment slots (filled by later phases).
    contact_email: null, contact_phone: null, contact_website: null, contact_status: 'idle',
    owner_name: null, owner_title: null, owner_source: null, google_status: 'idle',
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

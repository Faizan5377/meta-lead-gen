// Playwright-based scraper. Two passes per keyword:
//   Pass A: scroll and extract card-level data, stream rows as we find them.
//   Pass B: open "See ad details" for one card per unique advertiser, expand
//           "About the advertiser", capture follower data, fan out to all rows.
//
// Selectors are anchored on TEXT/aria, never on Meta's obfuscated class names.
// All structured extraction happens inside one page.evaluate() per pass so the
// DOM walk lives in the browser (faster, fewer round trips).

import { chromium } from 'playwright';
import { config } from '../config.js';
import { adSnapshotUrl, buildSearchUrl } from '../urlBuilder.js';
import { humanScroll, jitter } from './humanize.js';
import {
  daysSince, decodeFacebookLink, pageSlugFromUrl, parseFollowers, parseStartDate, snippet,
} from './parsers.js';

let browserPromise = null;
let contextPromise = null;

export async function getContext() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: !config.headful,
      slowMo: config.slowMoMs,
      args: ['--disable-blink-features=AutomationControlled'],
    });
  }
  const browser = await browserPromise;
  if (!contextPromise) {
    contextPromise = browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      storageState: config.storageState,
    });
  }
  return contextPromise;
}

export async function shutdown() {
  try { (await contextPromise)?.close(); } catch {}
  try { (await browserPromise)?.close(); } catch {}
  browserPromise = null;
  contextPromise = null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Pass A — discover

const EXTRACT_CARDS_SCRIPT = `
(() => {
  // Find all leaf-ish nodes whose text contains "Library ID: <digits>" and walk
  // up to a stable card boundary (the highest ancestor that still contains
  // exactly one "Library ID:" occurrence).
  const libRe = /Library ID:\\s*(\\d+)/;
  const libGlobal = /Library ID:/g;

  const seedNodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  let n;
  while ((n = walker.nextNode())) {
    if (libRe.test(n.nodeValue || '')) seedNodes.push(n.parentElement);
  }

  const cardEls = [];
  const seen = new Set();
  for (const seed of seedNodes) {
    let node = seed;
    while (node && node.parentElement && node !== document.body) {
      const parentText = node.parentElement.textContent || '';
      const count = (parentText.match(libGlobal) || []).length;
      if (count > 1) break;
      node = node.parentElement;
    }
    if (node && node !== document.body && !seen.has(node)) {
      seen.add(node);
      cardEls.push(node);
    }
  }

  const cards = [];
  for (const card of cardEls) {
    const text = (card.innerText || card.textContent || '').replace(/\\u00a0/g, ' ');
    const libMatch = text.match(libRe);
    if (!libMatch) continue;
    const libraryId = libMatch[1];

    const startMatch = text.match(/Started running on ([^\\n]+?)(?:\\s{2,}|\\n|$)/);
    const startedRunningRaw = startMatch ? startMatch[1].trim() : null;

    const creativeMatch = text.match(/(\\d+)\\s+ads use this creative and text/i);
    const creativeAdCount = creativeMatch ? parseInt(creativeMatch[1], 10) : 1;

    const activeStatus = /\\bActive\\b/.test(text) ? 'Active' : /\\bInactive\\b/.test(text) ? 'Inactive' : null;

    // Page link (slug + name)
    const pageLink = card.querySelector('a[href*="facebook.com/"][role="link"], a[href*="facebook.com/"]:not([href*="ads/library"])');
    let pageName = null;
    let pageUrl = null;
    if (pageLink) {
      pageName = (pageLink.innerText || pageLink.textContent || '').trim();
      pageUrl = pageLink.href;
    }

    // Partner (second link near "Sponsored")
    const allPageLinks = Array.from(card.querySelectorAll('a[href*="facebook.com/"]'))
      .filter(a => !/ads\\/library/.test(a.href || ''))
      .filter(a => (a.innerText || '').trim().length > 0);
    let partnerName = null;
    if (allPageLinks.length > 1) {
      partnerName = (allPageLinks[1].innerText || allPageLinks[1].textContent || '').trim();
    }

    // Destination link
    let destinationUrl = null;
    let displayDomain = null;
    let cta = null;
    let headline = null;
    const lLink = card.querySelector('a[href*="l.facebook.com/l.php"]');
    if (lLink) {
      destinationUrl = lLink.href;
      // The CTA button often lives inside or next to this link.
      const ctaEl = lLink.querySelector('[role="button"], [aria-label]') || lLink;
      cta = (ctaEl.innerText || '').trim().split('\\n')[0] || null;
    }

    // Display domain (small uppercase text). Heuristic: a short text node that
    // matches DOMAIN.TLD in caps within the card.
    const domainCandidates = Array.from(card.querySelectorAll('span, div'))
      .map(el => (el.innerText || '').trim())
      .filter(t => /^[A-Z0-9][A-Z0-9.\\-]{2,40}\\.[A-Z]{2,8}$/.test(t));
    if (domainCandidates.length) displayDomain = domainCandidates[0];

    // Headline candidate: text near CTA / display domain that is title-cased and
    // not the ad body. We pick the longest <span> just before the display domain.
    if (displayDomain) {
      const all = Array.from(card.querySelectorAll('span, div'));
      const idx = all.findIndex(el => (el.innerText || '').trim() === displayDomain);
      if (idx > 0) {
        for (let i = idx - 1; i >= Math.max(0, idx - 6); i--) {
          const t = (all[i].innerText || '').trim();
          if (t && t.length > 10 && t.length < 200 && !/^\\d/.test(t) && t !== displayDomain) {
            headline = t.split('\\n')[0];
            break;
          }
        }
      }
    }

    // Ad text snippet — largest text block within the card that isn't header chrome.
    let adText = '';
    const textCandidates = Array.from(card.querySelectorAll('div, span'))
      .map(el => (el.innerText || '').trim())
      .filter(t => t && t.length > 60 && !/Library ID:/.test(t) && !/Started running/.test(t)
        && !/Platforms\\s/.test(t) && !/Categories\\s/.test(t));
    if (textCandidates.length) {
      adText = textCandidates.reduce((a, b) => (b.length > a.length ? b : a), '');
    }

    // Media type
    let mediaType = 'image';
    if (card.querySelector('video')) mediaType = 'video';
    else if (card.querySelectorAll('img[src*="scontent"], img[src*="fbcdn"]').length > 1) mediaType = 'carousel';

    // Platforms — labels live in tooltips / aria-labels of small icons. Best-effort.
    const platformsSet = new Set();
    const platformText = (text.match(/Platforms\\s*\\n*([^\\n]+)/)?.[1] || '').toLowerCase();
    if (platformText.includes('facebook')) platformsSet.add('Facebook');
    if (platformText.includes('instagram')) platformsSet.add('Instagram');
    if (platformText.includes('messenger')) platformsSet.add('Messenger');
    if (platformText.includes('audience network') || platformText.includes('audience_network')) platformsSet.add('Audience Network');
    if (platformText.includes('threads')) platformsSet.add('Threads');
    // Fallback: scan aria-labels
    if (platformsSet.size === 0) {
      const labels = Array.from(card.querySelectorAll('[aria-label]'))
        .map(el => el.getAttribute('aria-label') || '');
      for (const l of labels) {
        const lo = l.toLowerCase();
        if (lo === 'facebook') platformsSet.add('Facebook');
        else if (lo === 'instagram') platformsSet.add('Instagram');
        else if (lo === 'messenger') platformsSet.add('Messenger');
        else if (lo.includes('audience network')) platformsSet.add('Audience Network');
        else if (lo === 'threads') platformsSet.add('Threads');
      }
    }

    const categoriesMatch = text.match(/Categories\\s*\\n+([^\\n]+)/);
    const categories = categoriesMatch ? categoriesMatch[1].trim() : '';

    cards.push({
      library_id: libraryId,
      active_status: activeStatus,
      started_running_raw: startedRunningRaw,
      creative_ad_count: creativeAdCount,
      page_name: pageName,
      page_url: pageUrl,
      partner_name: partnerName,
      raw_destination_link: destinationUrl,
      display_domain: displayDomain,
      cta,
      headline,
      ad_text_raw: adText,
      media_type: mediaType,
      platforms: Array.from(platformsSet),
      categories,
    });
  }
  return cards;
})()
`;

export async function scrapeKeyword({
  page, country, keyword, adType, location, locationCode,
  onLeadDiscovered, onProgress, shouldStop, maxCards,
}) {
  const cap = maxCards || config.maxCardsPerKeyword;
  const url = buildSearchUrl({ country, keyword, adType });
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Let Meta's SPA finish its initial render — typically ~10s before ad cards
  // appear. Also detect the "URL was rewritten" case — Meta silently drops our
  // params (esp. for housing/credit/employment outside US/CA) and lands on the
  // Ad Library home page. We catch that and surface a useful error.
  const waitStart = Date.now();
  const waitDeadline = waitStart + 45000;
  let ready = false;
  let lastSignal = null;
  while (Date.now() < waitDeadline) {
    const status = await page.evaluate(({ wantAdType, wantKeyword }) => {
      const body = document.body;
      if (!body) return { signal: 'no-body' };
      const t = body.innerText || '';
      const libCount = (t.match(/Library ID:/g) || []).length;
      const cur = new URL(location.href);
      const urlAdType = cur.searchParams.get('ad_type');
      const urlQ = cur.searchParams.get('q');
      const onLandingPage = /Search ads.*?Set your location.*?ad category to start your search/is.test(t)
        || (t.length > 50 && t.length < 1500 && !libCount);
      return {
        libCount, bodyLen: t.length, urlAdType, urlQ, onLandingPage,
        adTypeMismatch: urlAdType && wantAdType && urlAdType !== wantAdType,
        keywordDropped: wantKeyword && !urlQ,
      };
    }, { wantAdType: adType, wantKeyword: keyword }).catch(() => ({ signal: 'eval-error' }));
    lastSignal = status;
    if (status?.libCount > 0) { ready = true; break; }
    // Detect Meta rewriting our URL (drops housing_ads outside US/CA, etc.)
    if (status?.adTypeMismatch || (status?.keywordDropped && status?.onLandingPage)) {
      const reason = status.adTypeMismatch
        ? `Meta does not support ad category "${adType}" in ${country} (it was changed to "${status.urlAdType}"). Try "All ads" or pick a US/CA location.`
        : `Meta dropped the keyword search and showed its landing page. Try "All ads" for this country.`;
      throw new Error(reason);
    }
    if (status?.bodyLen && /No ads|No results|0 ads found/i.test(status?.body || '')) break;
    await jitter(700, 1100);
  }
  if (!ready && lastSignal && !lastSignal.libCount) {
    // Page never produced cards — likely a region with very few advertisers
    // for this query, OR a soft block. Caller will see 0 leads and we surface
    // a non-fatal error event from the orchestrator.
  }

  await jitter(500, 1000);

  const seen = new Set();
  let stableScrolls = 0;
  const start = Date.now();

  // Pull whatever is currently rendered into `seen`, streaming new cards.
  const harvest = async () => {
    const cards = await page.evaluate(EXTRACT_CARDS_SCRIPT).catch(() => []);
    let added = 0;
    for (const c of cards) {
      if (seen.has(c.library_id)) continue;
      seen.add(c.library_id);
      added++;
      const lead = normalizeLead(c, { keyword, location, locationCode });
      onLeadDiscovered?.(lead);
    }
    onProgress?.({ cardsFound: seen.size });
    return added;
  };

  // First harvest before any scroll (initial viewport of cards).
  await harvest();

  while (!shouldStop?.()
      && stableScrolls < config.stableScrollsToStop
      && seen.size < cap
      && Date.now() - start < config.maxScrollMs) {

    // Scroll, then PAUSE so Meta's lazy-loader can fetch the next batch — the
    // results jump around a lot while loading, so give them time to settle.
    await humanScroll(page);
    await jitter(config.scrollSettleMs, config.scrollSettleMs + 1200);

    let added = await harvest();

    // If that scroll surfaced nothing new, the page may just be slow. Wait the
    // full grace period (default 8s) and try ONE more harvest before counting
    // this as a "dead" scroll — Meta often back-fills after a beat.
    if (added === 0) {
      await jitter(config.noNewAdsGraceMs, config.noNewAdsGraceMs + 500);
      added = await harvest();
    }

    if (added === 0) stableScrolls++;
    else stableScrolls = 0;
  }

  return Array.from(seen);
}

function normalizeLead(c, { keyword, location, locationCode }) {
  const startedRunning = parseStartDate(c.started_running_raw);
  const destinationUrl = decodeFacebookLink(c.raw_destination_link);
  const pageSlug = pageSlugFromUrl(c.page_url);
  return {
    keyword,
    location,
    location_code: locationCode,
    scraped_at: new Date().toISOString(),

    library_id: c.library_id,
    ad_snapshot_url: adSnapshotUrl(c.library_id),
    active_status: c.active_status,

    page_name: c.page_name,
    page_slug: pageSlug,
    page_url: c.page_url,
    partner_name: c.partner_name,

    started_running: startedRunning,
    days_running: daysSince(startedRunning),

    platforms: c.platforms || [],
    categories: c.categories || '',
    media_type: c.media_type,

    creative_ad_count: c.creative_ad_count || 1,
    company_total_ads: 1,

    ad_text_snippet: snippet(c.ad_text_raw, 300),
    headline: c.headline || null,
    cta: c.cta || null,
    display_domain: c.display_domain || null,
    destination_url: destinationUrl || null,

    fb_handle: null, fb_followers_raw: null, fb_followers: null,
    ig_handle: null, ig_followers_raw: null, ig_followers: null,
    advertiser_category: null, advertiser_about: null,
    enrichment_status: 'pending',

    relevance_score: null, relevance_tier: null, relevance_reasons: null,
    is_lead_gen_ad: null, search_match: null, relevance_status: 'pending',
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Pass B — enrich

const EXTRACT_ADVERTISER_SCRIPT = `
(() => {
  // The drawer renders a heading "About the advertiser" followed by per-platform
  // rows like "Facebook · @handle · 8.7K followers · Estate agent" and a
  // "More info" blurb. We look for the heading element and walk its container.
  const headingEl = Array.from(document.querySelectorAll('span, div, h2, h3'))
    .find(el => (el.innerText || '').trim() === 'About the advertiser');
  if (!headingEl) return null;

  let container = headingEl;
  for (let i = 0; i < 6 && container.parentElement; i++) container = container.parentElement;

  const fullText = (container.innerText || '').replace(/\\u00a0/g, ' ');

  const out = { fb: null, ig: null, category: null, about: null, raw: fullText };

  // Per-platform parse. Each platform appears as a line "Facebook" then below
  // "@handle" "1.2K followers" "Category".
  const lines = fullText.split('\\n').map(l => l.trim()).filter(Boolean);
  const platformIdx = (name) => lines.findIndex(l => l === name);

  function readPlatform(name) {
    const idx = platformIdx(name);
    if (idx === -1) return null;
    const block = lines.slice(idx, idx + 6);
    const handle = block.find(l => /^@[\\w.]+$/i.test(l)) || null;
    const followersLine = block.find(l => /followers?$/i.test(l));
    const followers_raw = followersLine ? followersLine.replace(/\\s*followers?$/i, '').trim() : null;
    // Category: a short non-numeric line that isn't handle/followers
    const skip = new Set([name, handle, followersLine].filter(Boolean));
    const category = block.find(l => !skip.has(l) && l !== name && !/followers?$/i.test(l) && !/^@/.test(l)
      && l.length > 1 && l.length < 60) || null;
    return { handle: handle ? handle.slice(1) : null, followers_raw, category };
  }

  out.fb = readPlatform('Facebook');
  out.ig = readPlatform('Instagram');

  // Category (often shown once at the top under the header avatar)
  if (!out.fb?.category && !out.ig?.category) {
    const headerCategory = lines.slice(0, 6).find(l =>
      l.length > 2 && l.length < 40 && !/About the advertiser/i.test(l) && !/^@/.test(l) && !/followers?/i.test(l)
    );
    out.category = headerCategory || null;
  } else {
    out.category = out.fb?.category || out.ig?.category || null;
  }

  // "More info" blurb
  const moreIdx = lines.findIndex(l => /^More info$/i.test(l));
  if (moreIdx !== -1) {
    out.about = lines.slice(moreIdx + 1, moreIdx + 8).filter(l =>
      l.length > 0 && !/^About ads and data use$/i.test(l)
    ).join(' ').slice(0, 600);
  }

  return out;
})()
`;

export async function enrichAdvertiserByLibraryId(page, libraryId) {
  // Navigate to the ad snapshot URL — it's the most reliable way to land on
  // ONE ad and open its details. The snapshot page directly exposes the
  // "About the advertiser" content without scrolling through a list.
  await page.goto(adSnapshotUrl(libraryId), { waitUntil: 'domcontentloaded' });
  await jitter(700, 1400);

  // Try to expand "About the advertiser" if it's collapsed.
  const headingLocator = page.getByText(/^About the advertiser$/).first();
  try {
    await headingLocator.waitFor({ timeout: 10000 });
    // Some renderings wrap the heading in a button; click on it (or a sibling)
    // to expand if needed. Clicking a heading is safe even if already expanded.
    try { await headingLocator.click({ timeout: 1500 }); } catch {}
    await jitter(400, 900);
  } catch {
    return { enrichment_status: 'failed' };
  }

  const data = await page.evaluate(EXTRACT_ADVERTISER_SCRIPT).catch(() => null);
  if (!data) return { enrichment_status: 'failed' };

  return {
    fb_handle: data.fb?.handle || null,
    fb_followers_raw: data.fb?.followers_raw || null,
    fb_followers: parseFollowers(data.fb?.followers_raw),
    ig_handle: data.ig?.handle || null,
    ig_followers_raw: data.ig?.followers_raw || null,
    ig_followers: parseFollowers(data.ig?.followers_raw),
    advertiser_category: data.category || null,
    advertiser_about: data.about || null,
    enrichment_status:
      data.fb?.followers_raw || data.ig?.followers_raw || data.category ? 'enriched' : 'failed',
  };
}

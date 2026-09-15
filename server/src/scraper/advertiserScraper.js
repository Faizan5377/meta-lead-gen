// Per-advertiser details from the Ad Library's advertiser "About" tab.
//
// The feed gives us Facebook followers (`page_like_count`) but nothing about
// Instagram. Both live on the advertiser's own About tab, which is reachable
// directly by page id — no ad-details modal, no overlay fighting:
//
//   /ads/library/?view_all_page_id=<PAGE_ID>&search_type=page&country=<CC>
//
//   Pages and accounts
//   @DelmarPestControl
//   430 followers
//   •
//   Pest control service
//   @delmarpestcontrol
//   3 followers
//
// It also carries the page creation date and the advertiser's own bio, both of
// which are useful qualifying signals, so we take them while we're here.
//
// Never throws: an advertiser that can't be read simply keeps whatever the feed
// already gave us.

import { jitter } from './humanize.js';

// "118.7K followers" / "1.8M" / "430" -> number
export function parseFollowerCount(raw) {
  if (!raw) return null;
  const m = String(raw).replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1;
  return Math.round(n * mult);
}

const HANDLE_RE = /^@[\w.]+$/;
const FOLLOWERS_RE = /^([\d.,]+\s*[KMB]?)\s*followers?$/i;

// Meta renders the Facebook account first, then Instagram. Each handle line is
// followed by a followers line, optionally then "•" and the page category —
// each on its own line, which is why this walks lines rather than regexing one.
export function parseAboutTab(text) {
  const out = {
    followers_facebook: null,
    followers_instagram: null,
    facebook_handle: null,
    instagram_handle: null,
    page_category: null,
    advertiser_bio: null,
    page_created_on: null,
  };
  if (!text) return out;

  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);

  const start = lines.findIndex((l) => /^Pages and accounts$/i.test(l));
  const end = lines.findIndex((l) => /^Page history$/i.test(l));
  const block = start >= 0 ? lines.slice(start + 1, end > start ? end : undefined) : lines;

  const accounts = [];
  for (let i = 0; i < block.length; i++) {
    if (!HANDLE_RE.test(block[i])) continue;
    const handle = block[i].slice(1);
    let followers = null;
    let category = null;
    // Look a few lines ahead for the follower count and the category.
    for (let j = i + 1; j < Math.min(i + 5, block.length); j++) {
      if (HANDLE_RE.test(block[j])) break;                 // next account
      const fm = block[j].match(FOLLOWERS_RE);
      if (fm && followers === null) { followers = parseFollowerCount(fm[1]); continue; }
      if (block[j] === '•') continue;
      if (followers !== null && !category) category = block[j];
    }
    accounts.push({ handle, followers, category });
  }

  if (accounts[0]) {
    out.facebook_handle = accounts[0].handle;
    out.followers_facebook = accounts[0].followers;
    out.page_category = accounts[0].category;
  }
  if (accounts[1]) {
    out.instagram_handle = accounts[1].handle;
    out.followers_instagram = accounts[1].followers;
  }

  // The bio sits just above "Pages and accounts".
  if (start > 0) {
    const bio = lines[start - 1];
    if (bio && !/transparency/i.test(bio) && bio.length > 15) out.advertiser_bio = bio.slice(0, 400);
  }

  const created = lines.find((l) => /^Page created on /i.test(l));
  if (created) out.page_created_on = created.replace(/^Page created on\s*/i, '').trim();

  return out;
}

const READ_ABOUT = `
(() => {
  const t = document.body?.innerText || '';
  return t;
})()
`;

// Read one advertiser's About tab. `pageId` is the numeric Facebook page id.
export async function scrapeAdvertiserDetails(page, pageId, country = 'US') {
  if (!pageId) return {};

  const url = 'https://www.facebook.com/ads/library/?'
    + `active_status=all&ad_type=all&media_type=all&search_type=page`
    + `&country=${encodeURIComponent(country || 'US')}`
    + `&view_all_page_id=${encodeURIComponent(pageId)}`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch {
    if (!page.url().includes('facebook.com')) return {};
  }
  await jitter(1800, 2600);

  // Dismiss the login modal if it appeared.
  for (const sel of ['div[role="dialog"] [aria-label="Close"]', '[aria-label="Close"]']) {
    const btn = page.locator(sel).first();
    if (await btn.count().then((c) => c > 0).catch(() => false)) {
      try { await btn.click({ timeout: 1200 }); break; } catch {}
    }
  }
  await page.keyboard.press('Escape').catch(() => {});

  // Switch to the About tab. Dispatching on the node avoids Meta's invisible
  // overlays, which intercept a real pointer click.
  const opened = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('div[role="tab"], a, span, div'))
      .find((e) => /^About$/.test((e.textContent || '').trim()));
    if (!el) return false;
    el.click();
    return true;
  }).catch(() => false);
  if (!opened) return {};

  await jitter(1600, 2400);

  const text = await page.evaluate(READ_ABOUT).catch(() => '');
  const parsed = parseAboutTab(text);

  // Only return what we actually found, so enrichment never blanks out data the
  // feed already supplied.
  const patch = {};
  for (const [k, v] of Object.entries(parsed)) if (v !== null && v !== undefined) patch[k] = v;
  return patch;
}

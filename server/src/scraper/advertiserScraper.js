// Optional per-advertiser enrichment.
//
// The feed gives us Facebook followers (`page_like_count`) but nothing about
// Instagram. Those only appear in the ad's "About the advertiser" panel:
//
//   Everything Envy
//     f  @everythingenvy   118.7K followers · Digital creator
//     ig @everythingenvy   1.8M followers
//
// Reaching it costs one page load per advertiser, which is why this phase is
// opt-in rather than part of every run.
//
// Never throws: a business that can't be enriched simply keeps what the feed
// already gave us.

import { jitter } from './humanize.js';

// "118.7K followers" / "1.8M followers" / "531 followers" -> number
export function parseFollowerCount(raw) {
  if (!raw) return null;
  const m = String(raw).replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1;
  return Math.round(n * mult);
}

// The panel renders each platform as an icon + handle + "N followers". We read
// it by locating the handle lines and the follower line that follows each.
export function parseAdvertiserPanel(text) {
  const out = {
    followers_facebook: null,
    followers_instagram: null,
    instagram_handle: null,
    facebook_handle: null,
    page_category: null,
    advertiser_bio: null,
  };
  if (!text) return out;

  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);

  // Each "@handle" line is followed by a "N followers · Category" line.
  const handles = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^@[\w.]+$/.test(lines[i])) continue;
    const next = lines[i + 1] || '';
    const fm = next.match(/([\d.,]+\s*[KMB]?)\s*followers?/i);
    handles.push({
      handle: lines[i].slice(1),
      followers: fm ? parseFollowerCount(fm[1]) : null,
      // "118.7K followers • Digital creator"
      category: (next.split(/[•·]/)[1] || '').trim() || null,
    });
  }

  // Meta renders Facebook first, then Instagram.
  if (handles[0]) {
    out.facebook_handle = handles[0].handle;
    out.followers_facebook = handles[0].followers;
    out.page_category = handles[0].category;
  }
  if (handles[1]) {
    out.instagram_handle = handles[1].handle;
    out.followers_instagram = handles[1].followers;
  }

  const more = lines.findIndex((l) => /^more info$/i.test(l));
  if (more >= 0 && lines[more + 1]) out.advertiser_bio = lines[more + 1].slice(0, 300);

  return out;
}

const PANEL_TEXT = `
(() => {
  const heads = Array.from(document.querySelectorAll('div,span,h2,h3'))
    .filter(el => /^About the advertiser$/i.test((el.textContent || '').trim()));
  for (const h of heads) {
    let n = h;
    for (let i = 0; i < 6 && n; i++) {
      n = n.parentElement;
      const t = (n?.innerText || '');
      if (/@/.test(t) && /follower/i.test(t)) return t;
    }
  }
  return document.body?.innerText || '';
})()
`;

// Open one ad's detail view and read the advertiser panel.
export async function scrapeAdvertiserDetails(page, libraryId) {
  if (!libraryId) return {};
  const url = `https://www.facebook.com/ads/library/?id=${libraryId}`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch {
    if (!page.url().includes('facebook.com')) return {};
  }
  await jitter(1500, 2400);

  // Dismiss the login modal if it appears.
  for (const sel of ['div[role="dialog"] [aria-label="Close"]', '[aria-label="Close"]']) {
    const btn = page.locator(sel).first();
    if (await btn.count().then((c) => c > 0).catch(() => false)) {
      try { await btn.click({ timeout: 1200 }); break; } catch {}
    }
  }
  await page.keyboard.press('Escape').catch(() => {});

  // "See ad details" opens the panel; on a single-ad URL it may already be open.
  const detail = page.getByText(/^See ad details$/i).first();
  if (await detail.count().then((c) => c > 0).catch(() => false)) {
    try { await detail.click({ timeout: 2500 }); await jitter(1400, 2200); } catch {}
  }

  // The "About the advertiser" accordion is collapsed by default.
  const about = page.getByText(/^About the advertiser$/i).first();
  if (await about.count().then((c) => c > 0).catch(() => false)) {
    try { await about.click({ timeout: 2000 }); await jitter(900, 1500); } catch {}
  }

  const text = await page.evaluate(PANEL_TEXT).catch(() => '');
  const parsed = parseAdvertiserPanel(text);

  // Only return fields we actually found, so enrichment never blanks out data
  // the feed already supplied.
  const patch = {};
  for (const [k, v] of Object.entries(parsed)) if (v !== null && v !== undefined) patch[k] = v;
  return patch;
}

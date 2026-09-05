// Owner discovery from the company's own website — the most trustworthy source
// when we know their domain, because an About/Team page states the owner
// outright rather than implying it.
//
// Improvement over a fixed path list: we read the homepage's own navigation to
// find where the About/Team page actually lives (many sites use /pages/our-story,
// /company/leadership, /meet-the-team, …), and only fall back to guessing.

import { bestCandidate, harvestCandidates, scoreToConfidence } from './personNames.js';

const GUESS_PATHS = [
  'about', 'about-us', 'about-me', 'our-team', 'team', 'meet-the-team',
  'leadership', 'our-story', 'who-we-are', 'staff', 'doctors', 'agents', 'contact',
];

const NAV_RE = /about|team|story|who.?we.?are|leadership|staff|meet|founder|owner|doctor|agent/i;

// Read the homepage nav for links that look like an About/Team page.
function collectNavLinks() {
  const out = [];
  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    const text = (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim();
    let href;
    try { href = new URL(a.getAttribute('href'), location.href).toString(); } catch { continue; }
    out.push({ href, text });
    if (out.length >= 300) break;
  }
  return out;
}

function pageText() {
  return (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 40000);
}

async function readCandidates(page, url, businessName, weight) {
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 9000 });
    if (!res || res.status() >= 400) return [];
    await page.waitForTimeout(600);
    const text = await page.evaluate(pageText).catch(() => '');
    return harvestCandidates(text, businessName, weight).map((c) => ({ ...c, source: url }));
  } catch {
    return [];
  }
}

// Find the owner on a company website. Returns a candidate or null; never throws.
export async function ownerFromWebsite(page, website, businessName, deadline) {
  if (!website) return null;

  let origin;
  try { origin = new URL(website).origin; } catch { return null; }

  const all = [];
  const visited = new Set();

  // 1. Homepage — often already says "founded by …", and gives us the real nav.
  let navLinks = [];
  try {
    const res = await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 9000 });
    if (res && res.status() < 400) {
      await page.waitForTimeout(600);
      const text = await page.evaluate(pageText).catch(() => '');
      all.push(...harvestCandidates(text, businessName, 3).map((c) => ({ ...c, source: 'website:home' })));
      navLinks = await page.evaluate(collectNavLinks).catch(() => []);
    }
    visited.add(origin);
  } catch { /* homepage unreachable — fall through to guessed paths */ }

  // 2. Same-origin nav links whose text or path looks like an About/Team page.
  const targets = [];
  for (const { href, text } of navLinks) {
    if (targets.length >= 4) break;
    let u;
    try { u = new URL(href); } catch { continue; }
    if (u.origin !== origin) continue;
    if (u.pathname === '/' || visited.has(u.toString())) continue;
    if (!NAV_RE.test(text) && !NAV_RE.test(u.pathname)) continue;
    visited.add(u.toString());
    targets.push(u.toString());
  }

  // 3. Guessed paths, only for slots the nav didn't fill. Kept small: each miss
  //    costs a page load, and this runs once per harvested business.
  for (const p of GUESS_PATHS) {
    if (targets.length >= 4) break;
    const u = new URL(p, origin + '/').toString();
    if (visited.has(u)) continue;
    visited.add(u);
    targets.push(u);
  }

  for (const url of targets) {
    if (Date.now() > deadline) break;
    // An explicit team/about page outranks the homepage.
    const weight = /team|about|story|leadership|staff/i.test(url) ? 6 : 3;
    all.push(...(await readCandidates(page, url, businessName, weight)));
    const interim = bestCandidate(all);
    if (interim && interim.score >= 34) break;
  }

  const best = bestCandidate(all);
  if (!best) return null;

  // sources[0] is either a full URL (from readCandidates) or the literal
  // 'website:home' (from the homepage pass) — don't prefix the latter twice.
  const raw = best.sources[0] || '';
  const label = raw.startsWith('website:')
    ? raw.slice('website:'.length)
    : ((raw.replace(/^https?:\/\/[^/]+/, '') || '/') === '/'
        ? 'home'
        : raw.replace(/^https?:\/\/[^/]+\//, '').slice(0, 40));
  return {
    name: best.name,
    title: best.title,
    source: `website:${label || 'home'}`,
    // The company's own site is stronger evidence than a search snippet — it is
    // unambiguously about THIS business — so it counts as corroborated.
    confidence: scoreToConfidence(best.score, { sources: 2 }),
  };
}

// Best-effort owner/founder discovery. Searches the web for the business name
// and parses any owner / founder / CEO mention (Google knowledge panel + organic
// results, with a Bing fallback since it blocks automation less aggressively).
//
// This is inherently unreliable — Google throws consent walls and CAPTCHAs and
// most small businesses have no owner data published. Every failure is caught
// and reported as a status, never thrown.

import { jitter } from './humanize.js';

const TITLE_WORDS = 'Founder|Co-?Founder|Co-?founders?|Founders?|CEO|Chief Executive(?: Officer)?|Owner|Co-?Owner|Proprietor|Managing Director|Managing Partner|President|Principal';
const NAME = "[A-Z][a-zA-Z.'’-]+(?:\\s+[A-Z][a-zA-Z.'’-]+){1,3}";

// "Founder: Jane Doe" / "CEO – John Smith" / "Owner Jane Doe"
const TITLE_FIRST = new RegExp(`\\b(${TITLE_WORDS})\\s*[:\\-–—]?\\s*(${NAME})`, 'g');
// "Jane Doe is the founder of ..." / "John Smith, CEO of ..."
const NAME_FIRST = new RegExp(`(${NAME})(?:,| is| ,)?\\s*(?:is\\s+)?(?:the\\s+)?(${TITLE_WORDS})\\b`, 'g');

const TITLE_RANK = (t) => {
  const s = t.toLowerCase();
  if (s.includes('owner') || s.includes('proprietor')) return 5;
  if (s.includes('founder')) return 4;
  if (s.includes('ceo') || s.includes('chief executive')) return 3;
  if (s.includes('managing')) return 2;
  return 1;
};

const BAD_NAME = /(Facebook|Instagram|LinkedIn|Google|Youtube|Twitter|Privacy|Cookie|Terms|About Us|Contact Us|Real Estate|Home Page|United States|Sign In|Learn More)/i;

function extractOwner(text, businessName) {
  if (!text) return null;
  const clean = text.replace(/\s+/g, ' ').slice(0, 20000);
  const candidates = [];
  const push = (name, title) => {
    name = (name || '').trim();
    title = (title || '').trim();
    if (!name || BAD_NAME.test(name)) return;
    if (businessName && name.toLowerCase() === businessName.toLowerCase()) return;
    if (name.split(/\s+/).length < 2) return; // require at least first + last
    candidates.push({ name, title, rank: TITLE_RANK(title) });
  };
  let m;
  while ((m = TITLE_FIRST.exec(clean))) push(m[2], m[1]);
  while ((m = NAME_FIRST.exec(clean))) push(m[1], m[2]);
  TITLE_FIRST.lastIndex = 0; NAME_FIRST.lastIndex = 0;
  if (!candidates.length) return null;

  // Prefer strongest title, then earliest mention.
  candidates.sort((a, b) => b.rank - a.rank);
  const best = candidates[0];
  const others = candidates
    .filter(c => c.name !== best.name)
    .slice(0, 3)
    .map(c => `${c.name}${c.title ? ` (${c.title})` : ''}`);
  return {
    owner_name: best.name,
    owner_title: best.title || null,
    owner_details: others.length ? `Also: ${others.join(', ')}` : null,
  };
}

async function dismissConsent(page) {
  for (const rx of [/^Accept all$/i, /^Reject all$/i, /^I agree$/i, /^Accept$/i, /^Agree$/i, /^Got it$/i]) {
    try {
      const btn = page.getByRole('button', { name: rx }).first();
      if (await btn.count().then(c => c > 0).catch(() => false)) { await btn.click({ timeout: 1500 }); await jitter(400, 700); return; }
    } catch {}
  }
}

async function searchEngine(page, engine, query) {
  const url = engine === 'bing'
    ? `https://www.bing.com/search?setlang=en&q=${encodeURIComponent(query)}`
    : `https://www.google.com/search?hl=en&num=10&q=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await dismissConsent(page);
  await jitter(700, 1300);
  const body = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  const blocked = /unusual traffic|detected unusual|are you a robot|verify you.?re human|captcha|enablejs|To continue, please/i.test(body) || body.length < 200;
  return { body, blocked };
}

// Look up owner/founder info for one business. Never throws.
export async function scrapeOwnerInfo(page, businessName, countryName) {
  const name = (businessName || '').trim();
  if (!name) return { google_status: 'skipped' };
  const query = `${name}${countryName ? ' ' + countryName : ''} owner founder CEO`;

  try {
    let { body, blocked } = await searchEngine(page, 'google', query);
    let owner = blocked ? null : extractOwner(body, name);

    // Fall back to Bing when Google blocks us or finds nothing.
    if (!owner) {
      const bing = await searchEngine(page, 'bing', query).catch(() => ({ body: '', blocked: true }));
      const bingOwner = bing.blocked ? null : extractOwner(bing.body, name);
      if (bingOwner) owner = bingOwner;
      else if (blocked && bing.blocked) return { google_status: 'blocked' };
    }

    if (owner) return { ...owner, google_status: 'enriched' };
    return { google_status: 'not_found' };
  } catch (err) {
    return { google_status: 'failed', google_error: err.message };
  }
}

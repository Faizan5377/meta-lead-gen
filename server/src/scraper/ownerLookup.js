// Best-effort owner / founder discovery.
//
// Google, Bing, DuckDuckGo and Mojeek all block or JS-wall a headless browser,
// so this uses the engines that actually answer (Brave first — it even returns a
// direct "The founder of X is Y" summary — then Ecosia/Startpage), and finally
// falls back to the company's own About/Team page, which is the most reliable
// source of all when we know their website.
//
// Nothing here ever throws: every business gets a status.

import { jitter } from './humanize.js';

const TITLES = 'Founder|Co-?Founder|Co-?Founders|Founders|CEO|Chief Executive(?: Officer)?|Owner|Co-?Owner|Proprietor|Managing Director|Managing Partner|Principal|President|Director';
const NAME = "[A-Z][a-zA-Z.'’-]+(?:\\s+[A-Z][a-zA-Z.'’-]+){1,3}";

// "The founder and owner of X is Jane Doe" / "X was founded by Jane Doe"
const ANSWER_RE = new RegExp(`(?:founder|owner|ceo|founded by|led by)[^.]{0,60}?\\bis\\s+(${NAME})|founded by\\s+(${NAME})`, 'gi');
// "Founder: Jane Doe" / "CEO – Jane Doe"
const TITLE_FIRST = new RegExp(`\\b(${TITLES})\\s*[:\\-–—]\\s*(${NAME})`, 'g');
// "Jane Doe, Founder" / "Jane Doe - CEO - Company | LinkedIn"
const NAME_FIRST = new RegExp(`(${NAME})\\s*[,\\-–—]\\s*(?:the\\s+)?(${TITLES})\\b`, 'g');
// "Jane Doe is the founder"
const NAME_IS = new RegExp(`(${NAME})\\s+(?:is|was)\\s+(?:the\\s+|a\\s+)?(${TITLES})\\b`, 'g');

const TITLE_RANK = (t = '') => {
  const s = t.toLowerCase();
  if (s.includes('owner') || s.includes('proprietor')) return 6;
  if (s.includes('founder')) return 5;
  if (s.includes('ceo') || s.includes('chief executive')) return 4;
  if (s.includes('managing')) return 3;
  if (s.includes('president') || s.includes('principal')) return 2;
  return 1;
};

// Words that are never a person's name.
const BAD_NAME = /\b(Facebook|Instagram|LinkedIn|Google|YouTube|Twitter|Privacy|Cookie|Terms|About|Contact|Home|Search|Sign In|Log In|Read More|Learn More|Our Team|The Company|United States|New York|Real Estate|Chief Executive|Managing Director|Skip To|Main Content)\b/i;
const NAME_OK = /^[A-Z][a-zA-Z.'’-]+(?:\s+[A-Z][a-zA-Z.'’-]+){1,3}$/;
const HONORIFICS = 'Mr|Mrs|Ms|Miss|Dr|Prof|Sir|Eng';
const LEADING_TITLE_RE = new RegExp(`^(?:${TITLES}|${HONORIFICS})\\.?\\s+`, 'i');
const TRAILING_TITLE_RE = new RegExp(`\\s+(?:${TITLES})$`, 'i');

function harvestCandidates(text, businessName) {
  const out = [];
  if (!text) return out;
  const clean = String(text).replace(/\s+/g, ' ').slice(0, 30000);
  const bn = (businessName || '').toLowerCase();

  const push = (name, title, weight) => {
    name = (name || '').trim().replace(/[,.]$/, '');
    // A capitalised title can get swept into the name ("CEO Hayley Sessa",
    // "Hayley Sessa Founder") — strip it from either end.
    name = name
      .replace(LEADING_TITLE_RE, '')
      .replace(TRAILING_TITLE_RE, '')
      .trim();
    if (!name || !NAME_OK.test(name) || BAD_NAME.test(name)) return;
    const lower = name.toLowerCase();
    if (bn && (lower === bn || bn.includes(lower) || lower.includes(bn))) return;
    out.push({ name, title: (title || '').trim(), score: TITLE_RANK(title) + weight });
  };

  let m;
  while ((m = ANSWER_RE.exec(clean))) push(m[1] || m[2], 'Founder/Owner', 10); // direct answers win
  while ((m = TITLE_FIRST.exec(clean))) push(m[2], m[1], 4);
  while ((m = NAME_FIRST.exec(clean))) push(m[1], m[2], 3);
  while ((m = NAME_IS.exec(clean))) push(m[1], m[2], 5);
  ANSWER_RE.lastIndex = TITLE_FIRST.lastIndex = NAME_FIRST.lastIndex = NAME_IS.lastIndex = 0;
  return out;
}

function bestCandidate(candidates) {
  if (!candidates.length) return null;
  // Merge duplicates — a name repeated across the page is a stronger signal.
  const byName = new Map();
  for (const c of candidates) {
    const k = c.name.toLowerCase();
    const prev = byName.get(k);
    if (!prev) byName.set(k, { ...c, hits: 1 });
    else {
      prev.hits++;
      prev.score += 1;
      if (TITLE_RANK(c.title) > TITLE_RANK(prev.title)) prev.title = c.title;
    }
  }
  return Array.from(byName.values()).sort((a, b) => b.score - a.score)[0];
}

const BLOCKED_RE = /unusual traffic|are you a robot|verify you.?re human|captcha|complete the challenge|enablejs/i;
const LOOKUP_BUDGET_MS = 35000; // per business, across all engines + website

async function readPage(page, url, waitMs = 2000) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForTimeout(waitMs);
  const body = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  return { body, blocked: BLOCKED_RE.test(body) || body.length < 400 };
}

// Search engines that survive a headless browser, best first.
const ENGINES = [
  { name: 'brave', url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}` },
  { name: 'ecosia', url: (q) => `https://www.ecosia.org/search?q=${encodeURIComponent(q)}` },
  { name: 'startpage', url: (q) => `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}` },
];

// Common About/Team paths on a company website, best-first.
const ABOUT_PATHS = ['about', 'about-us', 'our-team', 'team', 'leadership'];

async function fromWebsite(page, website, businessName, deadline) {
  if (!website) return null;
  let origin;
  try { origin = new URL(website).origin; } catch { return null; }

  for (const path of ABOUT_PATHS) {
    if (Date.now() > deadline) break;
    try {
      const res = await page.goto(new URL(path, origin + '/').toString(), { waitUntil: 'domcontentloaded', timeout: 12000 });
      if (!res || res.status() >= 400) continue;
      await page.waitForTimeout(700);
      const body = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
      const best = bestCandidate(harvestCandidates(body, businessName));
      if (best) return { ...best, source: `website:${path}` };
    } catch { /* try the next path */ }
  }
  return null;
}

// Look up owner/founder info for one business. Never throws.
export async function scrapeOwnerInfo(page, businessName, countryName, website) {
  const name = (businessName || '').trim();
  if (!name) return { google_status: 'skipped' };

  const query = `"${name}" ${countryName || ''} owner founder CEO`.replace(/\s+/g, ' ').trim();
  let anyEngineWorked = false;
  // Hard per-business budget so one slow/stubborn lookup can't stall the phase
  // (and with it, the export button).
  const deadline = Date.now() + LOOKUP_BUDGET_MS;

  try {
    for (const engine of ENGINES) {
      if (Date.now() > deadline) break;
      let res;
      try { res = await readPage(page, engine.url(query)); }
      catch { continue; }
      if (res.blocked) continue;
      anyEngineWorked = true;

      const best = bestCandidate(harvestCandidates(res.body, name));
      if (best) {
        return {
          owner_name: best.name,
          owner_title: best.title || null,
          owner_source: engine.name,
          google_status: 'enriched',
        };
      }
      await jitter(300, 700);
    }

    // Fall back to the company's own site — the most reliable source we have.
    const fromSite = await fromWebsite(page, website, name, deadline);
    if (fromSite) {
      return {
        owner_name: fromSite.name,
        owner_title: fromSite.title || null,
        owner_source: fromSite.source,
        google_status: 'enriched',
      };
    }

    return { google_status: anyEngineWorked ? 'not_found' : 'blocked' };
  } catch (err) {
    return { google_status: 'failed', owner_source: null, error: err.message };
  }
}

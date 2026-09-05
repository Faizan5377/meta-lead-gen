// Search-engine owner discovery — the fallback for businesses Hunter can't
// resolve.
//
// Why not google.com directly: Google (and Bing, and DuckDuckGo's JS app) serve
// a consent wall or a CAPTCHA to a headless browser, so scraping them yields
// nothing but "unusual traffic" pages. Instead we reach the SAME two indexes
// through front-ends that answer a plain HTTP request:
//
//   startpage  -> Google's index, proxied      (so: Google results, no bot wall)
//   ecosia     -> Bing's index
//   brave      -> Brave's own index, and often a direct "the founder is X" blurb
//   duckduckgo -> the no-JS html endpoint, which does respond headless
//   mojeek     -> a fully independent index, very permissive
//
// Two things make this far more accurate than reading page text:
//   1. Result LINKS are parsed structurally, and a linkedin.com/in result title
//      ("Jane Doe - Founder - Acme | LinkedIn") is machine-generated, so it is
//      the highest-signal string on the open web for this question.
//   2. Several queries and engines are combined, and a name corroborated by two
//      independent engines outranks one seen once.
//
// Never throws. Honors a wall-clock deadline so one business can't stall a run.

import { config } from '../config.js';
import {
  bestCandidate, businessTokens, cleanName, harvestCandidates, isPlausibleName,
  mentionsBusiness, normalizeTitle, scoreToConfidence, TITLES,
} from './personNames.js';
import { serp } from './serp.js';
import { jitter } from '../scraper/humanize.js';

const BLOCKED_RE =
  /unusual traffic|are you a robot|verify you.?re human|captcha|complete the challenge|enablejs|access denied|too many requests|sorry[, ]+we (?:can|could)/i;

const ENGINES = [
  { name: 'startpage', index: 'google', url: (q) => `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}` },
  { name: 'brave', index: 'brave', url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}` },
  { name: 'duckduckgo', index: 'bing', url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}` },
  { name: 'ecosia', index: 'bing', url: (q) => `https://www.ecosia.org/search?q=${encodeURIComponent(q)}` },
  { name: 'mojeek', index: 'mojeek', url: (q) => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}` },
];

// Query templates, best expected value first. `%N` = business name, `%L` = place.
const QUERIES = [
  { tpl: 'site:linkedin.com/in "%N" (owner OR founder OR CEO)', weight: 6 },
  { tpl: '"%N" %L owner founder CEO', weight: 3 },
  { tpl: '"%N" %L "founded by"', weight: 3 },
  { tpl: 'who is the owner of "%N" %L', weight: 2 },
];

// Stop as soon as a candidate is this strong — saves page loads on easy wins.
const GOOD_ENOUGH_SCORE = 30;

// Pull structured results out of whatever engine rendered. Anchor text plus the
// surrounding snippet is far cleaner than the whole page's innerText.
function extractResults() {
  const bad = /^(?:https?:\/\/)?(?:www\.)?(?:startpage|brave|ecosia|mojeek|duckduckgo|google|bing)\./i;
  const seen = new Set();
  const results = [];
  for (const a of Array.from(document.querySelectorAll('a[href^="http"]'))) {
    const href = a.href;
    if (!href || bad.test(href) || seen.has(href)) continue;
    const title = (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim();
    if (!title || title.length < 3) continue;
    seen.add(href);
    // The result snippet lives in the anchor's enclosing result block. Only
    // accept a SMALL block: a bare `div` ancestor can be most of the page, which
    // would let one result's text vouch for another result's link.
    let block = a.closest('li, article, [class*="result"], [data-testid]');
    if (block && (block.innerText || '').length > 1200) block = null;
    const snippet = block ? (block.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600) : '';
    results.push({ href, title, snippet });
    if (results.length >= 40) break;
  }
  return {
    results,
    body: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 12000),
  };
}

// "Jane Doe - Founder - Acme Dental | LinkedIn" -> a high-weight candidate.
const LINKEDIN_TITLE_RE = new RegExp(
  `^\\s*([^|·—–\\-]{3,60}?)\\s*[-–—|·]\\s*([^|·—–]{0,80}?)\\s*(?:[-–—|·]|$)`
);
const TITLE_WORD_RE = new RegExp(`\\b(${TITLES})\\b`, 'i');

function fromLinkedInResult({ href, title, snippet }, businessName, tokens) {
  if (!/linkedin\.com\/in\//i.test(href)) return null;
  // The profile must actually name this business, or it's just some person.
  if (!mentionsBusiness(`${title} ${snippet || ''}`, tokens)) return null;
  const m = title.match(LINKEDIN_TITLE_RE);
  if (!m) return null;
  const name = cleanName(m[1]);
  if (!isPlausibleName(name, businessName)) return null;
  // The role sits in the second segment; if it isn't a role we recognise, the
  // result is still a person but we can't claim they're the owner.
  const roleMatch = (m[2] || '').match(TITLE_WORD_RE) || title.match(TITLE_WORD_RE);
  if (!roleMatch) return null;
  return { name, title: normalizeTitle(roleMatch[1]), weight: 16 };
}

async function runQuery(page, engine, query, businessName) {
  try {
    await page.goto(engine.url(query), { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch {
    return { blocked: true, candidates: [] };
  }
  await page.waitForTimeout(900);

  let payload;
  try {
    payload = await page.evaluate(extractResults);
  } catch {
    return { blocked: true, candidates: [] };
  }
  if (!payload) return { blocked: true, candidates: [] };

  const { results, body } = payload;
  if (BLOCKED_RE.test(body) || (!results.length && body.length < 400)) {
    return { blocked: true, candidates: [] };
  }

  const candidates = [];

  // Every candidate below must be tied to THIS business. Without that guard a
  // page that happens to name any "Owner" hands back a confident wrong answer.
  const tokens = businessTokens(businessName);

  // 1. LinkedIn profile results — the strongest structured signal.
  for (const r of results) {
    const hit = fromLinkedInResult(r, businessName, tokens);
    if (hit) candidates.push({ ...hit, source: `linkedin:${engine.name}` });
  }

  // 2. Result titles + snippets, which are cleaner than raw page text.
  for (const r of results.slice(0, 20)) {
    for (const c of harvestCandidates(`${r.title}. ${r.snippet}`, businessName, 2, { requireAssociation: true })) {
      candidates.push({ ...c, source: engine.name });
    }
  }

  // 3. Whole-page text last — catches Brave's "the founder of X is Y" blurb.
  for (const c of harvestCandidates(body, businessName, 0, { requireAssociation: true })) {
    candidates.push({ ...c, source: engine.name });
  }

  return { blocked: false, candidates };
}

// Turn one SERP-API response into scored candidates, using the same extraction
// and association rules as the scraped path so both are ranked identically.
function candidatesFromSerp({ provider, results, answer }, businessName) {
  const tokens = businessTokens(businessName);
  const out = [];

  // A provider's direct answer ("Basecamp was founded by Jason Fried") is the
  // highest-value string available — it's Google's own answer box or Tavily's
  // synthesised answer, not a guess scraped off a page.
  if (answer) {
    for (const c of harvestCandidates(answer, businessName, 6, { requireAssociation: true })) {
      out.push({ ...c, source: `${provider}:answer` });
    }
  }

  for (const r of results || []) {
    const hit = fromLinkedInResult(r, businessName, tokens);
    if (hit) out.push({ ...hit, source: `linkedin:${provider}` });
    for (const c of harvestCandidates(`${r.title}. ${r.snippet}`, businessName, 2, { requireAssociation: true })) {
      out.push({ ...c, source: provider });
    }
  }
  return out;
}

// Look up the owner of one business across providers, engines and query shapes.
// Returns { name, title, source, confidence, sources } or null.
//
// Order matters: SERP APIs first (reliable JSON, no CAPTCHAs), scraped engines
// only as a fallback when no provider is configured or all are exhausted.
export async function searchOwner(page, { businessName, location = '', deadline, maxPageLoads = 6 }) {
  const name = String(businessName || '').trim();
  if (!name) return null;

  const all = [];

  // ── Phase 1: SERP APIs ────────────────────────────────────────────────────
  if (serp.available().length) {
    for (const q of QUERIES) {
      if (Date.now() > deadline) break;
      const query = q.tpl.replace('%N', name).replace('%L', location || '').replace(/\s+/g, ' ').trim();
      const res = await serp.search(query, { limit: 10 });
      if (!res) break;                       // every provider is unavailable
      all.push(...candidatesFromSerp(res, name));

      const best = bestCandidate(all);
      if (best && best.score >= GOOD_ENOUGH_SCORE) {
        return {
          name: best.name,
          title: best.title,
          source: best.sources[0] || res.provider,
          sources: best.sources,
          confidence: scoreToConfidence(best.score, { sources: best.sources.length }),
          blocked: false,
        };
      }
    }
    // Providers answered but nothing conclusive — return what we have rather
    // than burning scraped page loads on top of paid calls.
    const best = bestCandidate(all);
    if (best) {
      return {
        name: best.name,
        title: best.title,
        source: best.sources[0] || 'serp',
        sources: best.sources,
        confidence: scoreToConfidence(best.score, { sources: best.sources.length }),
        blocked: false,
      };
    }
    if (!config.ownerScrapeFallback) return { name: null, blocked: false };
  }

  // ── Phase 2: scraped engines (fallback) ───────────────────────────────────
  const workingEngines = [];
  let loads = 0;
  let anyEngineAnswered = false;

  outer:
  for (const q of QUERIES) {
    const query = q.tpl.replace('%N', name).replace('%L', location || '').replace(/\s+/g, ' ').trim();

    // After the first query round, only re-use engines that actually answered.
    const pool = workingEngines.length ? workingEngines : ENGINES;

    for (const engine of pool) {
      if (loads >= maxPageLoads || Date.now() > deadline) break outer;
      loads++;

      const { blocked, candidates } = await runQuery(page, engine, query, name);
      if (blocked) continue;

      anyEngineAnswered = true;
      if (!workingEngines.includes(engine)) workingEngines.push(engine);
      all.push(...candidates);

      // Bail out early on a confident, corroborated answer.
      const best = bestCandidate(all);
      if (best && best.score >= GOOD_ENOUGH_SCORE) break outer;

      await jitter(250, 600);
    }
  }

  const best = bestCandidate(all);
  if (!best) return { name: null, blocked: !anyEngineAnswered };

  return {
    name: best.name,
    title: best.title,
    source: best.sources[0] || 'search',
    sources: best.sources,
    confidence: scoreToConfidence(best.score, { sources: best.sources.length }),
    blocked: false,
  };
}

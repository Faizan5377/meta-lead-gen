// Find where Google Maps hides a place's FULL WEEK of opening hours.
//
// The search response only carries today's hours (see maps/parser.js), but the
// 24-hour filter needs Mon-Fri. This locates the hours in whatever payload the
// place panel returns, the same way the search field map was derived: dump the
// live response and hunt for the strings we know must be in it.
//
//   node scripts/probe-place.js "Day & Night Air Conditioning Phoenix"

import fs from 'node:fs';
import { newPage, shutdown } from '../src/scraper/engine.js';
import { parseBody } from '../src/maps/parser.js';
import { jitter } from '../src/scraper/humanize.js';

const query = process.argv[2] || 'Day & Night Air Conditioning, Heating and Plumbing Phoenix';
const PLACE_RE = /\/maps\/preview\/place|\/search\?tbm=map|\/maps\/rpc\/listugcposts/;

// Walk the decoded JSON and report the path of every string that looks like a
// day name or an hours span. The paths are the field map.
function findPaths(node, test, path = [], hits = [], depth = 0) {
  if (depth > 40 || hits.length > 400) return hits;
  if (typeof node === 'string') {
    if (test(node)) hits.push({ path: path.join('.'), value: node.slice(0, 60) });
    return hits;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => findPaths(v, test, path.concat(i), hits, depth + 1));
  } else if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) findPaths(node[k], test, path.concat(k), hits, depth + 1);
  }
  return hits;
}

// The common prefix of several paths is the block that holds them all.
function commonPrefix(paths) {
  if (!paths.length) return '';
  const split = paths.map((p) => p.split('.'));
  const out = [];
  for (let i = 0; i < split[0].length; i++) {
    const seg = split[0][i];
    if (split.every((s) => s[i] === seg)) out.push(seg); else break;
  }
  return out.join('.');
}

const page = await newPage();
const bodies = [];

page.on('response', async (res) => {
  try {
    if (!PLACE_RE.test(res.url())) return;
    const text = await res.text().catch(() => '');
    if (!text || text.length < 500) return;
    const json = parseBody(text);
    if (json) bodies.push({ url: res.url().slice(0, 90), json });
  } catch {}
});

await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en&gl=us`, {
  waitUntil: 'domcontentloaded', timeout: 60000,
});
await jitter(6000, 7000);

// Maps may stop on the results rail rather than opening the place. Click the
// first card so the place panel — and its payload — actually loads.
try {
  const card = page.locator('div[role="feed"] a[href*="/maps/place/"]').first();
  if (await card.count().then((c) => c > 0).catch(() => false)) {
    console.log('(opening first result)');
    await card.click({ timeout: 4000 });
    await jitter(5000, 6000);
  }
} catch {}

console.log(`url after settle: ${page.url().slice(0, 110)}`);
console.log(`captured ${bodies.length} payloads\n`);

const DAYS = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/;
const HOURS = /Open 24 hours|\d\s?(AM|PM)[–-]/i;

for (const { url, json } of bodies) {
  const days = findPaths(json, (s) => DAYS.test(s)).slice(0, 14);
  const spans = findPaths(json, (s) => HOURS.test(s)).slice(0, 14);
  if (!days.length && !spans.length) continue;

  console.log(`--- ${url}`);
  if (days.length) {
    console.log(`  day names at:   ${commonPrefix(days.map((d) => d.path))}`);
    days.slice(0, 7).forEach((d) => console.log(`      ${d.path} = ${d.value}`));
  }
  if (spans.length) {
    console.log(`  hour spans at:  ${commonPrefix(spans.map((s) => s.path))}`);
    spans.slice(0, 7).forEach((s) => console.log(`      ${s.path} = ${s.value}`));
  }
  console.log('');
}

// The DOM is the fallback, and on this page it is anchored on an accessibility
// label rather than a class name, so it survives restyling.
const dom = await page.evaluate(() => {
  const out = { weekLabels: [], table: [] };
  for (const el of document.querySelectorAll('[aria-label*="Open 24 hours"], [aria-label*="Hide open hours"], [aria-label*="Show open hours"]')) {
    const l = el.getAttribute('aria-label') || '';
    if (l.length > 20) out.weekLabels.push(l.slice(0, 300));
  }
  for (const row of document.querySelectorAll('table tr')) {
    const cells = [...row.querySelectorAll('td,th')].map((c) => c.textContent.trim()).filter(Boolean);
    if (cells.length >= 2) out.table.push(cells.join(' | '));
  }
  return out;
}).catch(() => ({ weekLabels: [], table: [] }));

console.log('--- DOM');
console.log('  aria labels:', dom.weekLabels.length ? dom.weekLabels : '(none)');
console.log('  hours table:', dom.table.length ? dom.table.slice(0, 9) : '(none)');

fs.writeFileSync('/tmp/place-bodies.json', JSON.stringify(bodies.map((b) => b.json), null, 1));
console.log('\nfull payloads -> /tmp/place-bodies.json');

await page.close();
await shutdown();

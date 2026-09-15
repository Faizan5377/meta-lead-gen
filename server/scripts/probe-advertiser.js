// Find where the "About the advertiser" panel gets Instagram followers from.
//
// If it comes from a GraphQL call we can replay with a page_id, we can fetch it
// cheaply for every advertiser instead of loading a page each.
//
//   node --experimental-sqlite scripts/probe-advertiser.js <libraryId>

import fs from 'node:fs';
import { newPage, shutdown } from '../src/scraper/engine.js';
import { jitter } from '../src/scraper/humanize.js';

const libraryId = process.argv[2];
if (!libraryId) { console.error('usage: probe-advertiser.js <libraryId>'); process.exit(1); }

const page = await newPage();
const calls = [];

page.on('request', (req) => {
  if (!/\/api\/graphql/i.test(req.url())) return;
  const post = req.postData() || '';
  const name = (post.match(/fb_api_req_friendly_name=([^&]+)/) || [])[1] || '(unnamed)';
  calls.push({ name: decodeURIComponent(name), post });
});

page.on('response', async (res) => {
  if (!/\/api\/graphql/i.test(res.url())) return;
  const text = await res.text().catch(() => '');
  if (!/follower|instagram|ig_username|page_like/i.test(text)) return;
  const req = res.request();
  const post = req.postData() || '';
  const name = decodeURIComponent((post.match(/fb_api_req_friendly_name=([^&]+)/) || [])[1] || '(unnamed)');
  calls.push({ name, post, body: text, MATCH: true });
});

console.log(`opening ad ${libraryId}…`);
await page.goto(`https://www.facebook.com/ads/library/?id=${libraryId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await jitter(2500, 3500);

for (const sel of ['div[role="dialog"] [aria-label="Close"]', '[aria-label="Close"]']) {
  const btn = page.locator(sel).first();
  if (await btn.count().then((c) => c > 0).catch(() => false)) {
    try { await btn.click({ timeout: 1200 }); break; } catch {}
  }
}
await page.keyboard.press('Escape').catch(() => {});
await jitter(800, 1200);

const detail = page.getByText(/^See ad details$/i).first();
if (await detail.count().then((c) => c > 0).catch(() => false)) {
  console.log('clicking "See ad details"…');
  try { await detail.click({ timeout: 3000 }); await jitter(2000, 3000); } catch {}
}

const about = page.getByText(/^About the advertiser$/i).first();
if (await about.count().then((c) => c > 0).catch(() => false)) {
  console.log('expanding "About the advertiser"…');
  try { await about.click({ timeout: 2500 }); await jitter(1800, 2600); } catch {}
}

const matches = calls.filter((c) => c.MATCH);
console.log(`\n${calls.length} graphql calls, ${matches.length} containing follower/instagram data\n`);

console.log('── call names seen ──');
console.log([...new Set(calls.map((c) => c.name))].join('\n'));

if (matches.length) {
  fs.writeFileSync('/tmp/advertiser-calls.json', JSON.stringify(matches, null, 2));
  console.log('\nfull matching calls -> /tmp/advertiser-calls.json');
  for (const m of matches.slice(0, 3)) {
    console.log(`\n=== ${m.name} ===`);
    console.log('doc_id   :', (m.post.match(/doc_id=(\d+)/) || [])[1] || '(none)');
    const vars = (m.post.match(/variables=([^&]+)/) || [])[1];
    if (vars) console.log('variables:', decodeURIComponent(vars).slice(0, 300));
    const i = m.body.search(/follower|ig_username|instagram/i);
    console.log('body near match:', m.body.slice(Math.max(0, i - 250), i + 350).replace(/\s+/g, ' '));
  }
}

// What the panel actually renders, for comparison.
const text = await page.evaluate(() => {
  const heads = Array.from(document.querySelectorAll('div,span,h2,h3'))
    .filter((el) => /^About the advertiser$/i.test((el.textContent || '').trim()));
  for (const h of heads) {
    let n = h;
    for (let i = 0; i < 6 && n; i++) {
      n = n.parentElement;
      const t = n?.innerText || '';
      if (/@/.test(t) && /follower/i.test(t)) return t;
    }
  }
  return '(panel not found)';
}).catch(() => '(eval failed)');
console.log('\n── rendered panel ──\n' + text.slice(0, 500));

await page.close();
await shutdown();

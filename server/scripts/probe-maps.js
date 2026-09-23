// Observe what Google Maps actually requests when you run a search, so the
// scraper can replay it directly instead of parsing HTML.
//
//   node scripts/probe-maps.js "dentist in Austin TX"

import fs from 'node:fs';
import { newPage, shutdown } from '../src/scraper/engine.js';

const query = process.argv[2] || 'dentist in Austin TX';

const page = await newPage();
const hits = [];

page.on('response', async (res) => {
  const url = res.url();
  // The endpoints that carry structured place data.
  if (!/\/search\?tbm=map|\/maps\/preview\/|\/maps\/rpc\//.test(url)) return;
  const body = await res.text().catch(() => '');
  if (body.length < 500) return;
  hits.push({ url, status: res.status(), body });
});

console.log(`searching Maps for: ${query}\n`);
await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en&gl=us`, {
  waitUntil: 'domcontentloaded', timeout: 45000,
});
await page.waitForTimeout(6000);

// Scroll the results rail to trigger the paged fetches.
await page.evaluate(() => {
  const feed = document.querySelector('div[role="feed"]');
  if (feed) feed.scrollTop = feed.scrollHeight;
}).catch(() => {});
await page.waitForTimeout(4000);

console.log(`captured ${hits.length} structured responses\n`);
for (const h of hits.slice(0, 6)) {
  const u = new URL(h.url);
  console.log('──', u.pathname, `(${h.status}, ${(h.body.length / 1024).toFixed(0)}KB)`);
  const pb = u.searchParams.get('pb');
  if (pb) console.log('   pb:', pb.slice(0, 220));
  console.log('   starts:', JSON.stringify(h.body.slice(0, 60)));
}

if (hits.length) {
  const main = hits.find((h) => /\/search\?tbm=map/.test(h.url)) || hits[0];
  fs.writeFileSync('/tmp/maps-raw.txt', main.body);
  fs.writeFileSync('/tmp/maps-url.txt', main.url);
  console.log('\nlargest response -> /tmp/maps-raw.txt');
  console.log('its url          -> /tmp/maps-url.txt');

  // Strip the anti-XSSI prefix and see the top-level shape.
  const cleaned = main.body.replace(/^\)\]\}'\n?/, '').replace(/^\/\*""\*\//, '');
  try {
    const j = JSON.parse(cleaned);
    console.log('\nparsed OK. top-level:', Array.isArray(j) ? `array[${j.length}]` : typeof j);
    fs.writeFileSync('/tmp/maps-parsed.json', JSON.stringify(j, null, 1));
    console.log('parsed -> /tmp/maps-parsed.json');
  } catch (e) {
    console.log('\ndirect JSON.parse failed:', e.message.slice(0, 80));
    const i = cleaned.indexOf('[');
    console.log('first 200 after prefix strip:', JSON.stringify(cleaned.slice(i, i + 200)));
  }
}

await page.close();
await shutdown();

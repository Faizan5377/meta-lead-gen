// SERP provider diagnostic — which providers are configured, how much of their
// monthly cap is used, and whether a live query actually returns results.
//
//   npm run search:check                     # status only, spends nothing
//   npm run search:check -- --live "query"   # runs one real query (costs 1 credit)

import { db } from '../src/db.js';
import { serp } from '../src/enrich/serp.js';

const argv = process.argv.slice(2);
const live = argv.includes('--live');
const query = argv.filter((a) => !a.startsWith('--'))[0]
  || '"Millsaps Dentistry" United States owner founder';

await db.init();

console.log('\n── SERP providers ──────────────────────────────────────────');
const rows = serp.state_();
for (const r of rows) {
  const status = !r.configured ? 'no key'
    : r.exhausted ? 'EXHAUSTED'
    : `${r.spentThisMonth}/${r.cap} used this month`;
  console.log(`${r.name.padEnd(10)} ${r.index.padEnd(10)} ${status}${r.lastError ? `   last error: ${r.lastError}` : ''}`);
}

const usable = serp.available();
console.log(`\nusable now: ${usable.length ? usable.map((p) => p.name).join(', ') : 'none — owner search will fall back to scraping engines'}`);

if (!live) {
  console.log('\nAdd --live "your query" to run one real search (costs 1 credit).\n');
  process.exit(0);
}

if (!usable.length) {
  console.log('\nNothing to test — set SERPER_API_KEY or TAVILY_API_KEY in server/.env\n');
  process.exit(1);
}

console.log(`\n── live query ──────────────────────────────────────────────\n${query}\n`);
const res = await serp.search(query, { limit: 8 });
if (!res) {
  console.log('No provider returned results.');
  process.exit(1);
}
console.log(`provider: ${res.provider}${res.cached ? '  [cached, free]' : '  [1 credit]'}`);
if (res.answer) console.log(`answer  : ${res.answer.slice(0, 240)}`);
console.log(`results : ${res.results.length}\n`);
for (const r of res.results.slice(0, 6)) {
  console.log(`  ${r.title.slice(0, 78)}`);
  console.log(`  ${r.url.slice(0, 78)}`);
  console.log(`  ${(r.snippet || '').slice(0, 140)}\n`);
}

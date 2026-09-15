// Harvest a small live sample and show what the relevance gate keeps vs drops,
// with the reason for each. The fastest way to sanity-check a new niche.
//
//   npm run relevance:check -- plumbing US 25
//   npm run relevance:check -- "home services" US 25

import { config } from '../src/config.js';
import { createRelevanceGate } from '../src/relevance.js';
import { harvest, shutdown } from '../src/scraper/engine.js';

const keyword = process.argv[2] || 'plumbing';
const country = process.argv[3] || 'US';
const sample = Number(process.argv[4] || 25);

const gate = createRelevanceGate({ keywords: [keyword], minScore: config.relevance.minScore });
const seen = [];

console.log(`\nharvesting up to ${sample} ads for "${keyword}" in ${country}…\n`);

await harvest({
  filters: { keywords: [keyword], countries: [country], activeStatus: 'active', adType: 'all', mediaType: 'all', matchType: 'keyword_unordered' },
  shouldStop: () => seen.length >= sample,
  onAd: (rec) => {
    if (seen.length >= sample) return;
    const r = gate.evaluate(rec);
    seen.push({ rec, r });
  },
  onProgress: () => {},
  onError: (e) => console.log('  [warn]', e.scope, e.message),
});

const kept = seen.filter((x) => x.r.decision === 'keep');
const dropped = seen.filter((x) => x.r.decision === 'drop');

const row = (x) => `  ${String(x.r.score).padStart(3)}  ${(x.rec.page_name || '?').slice(0, 36).padEnd(38)} ${(x.rec.page_categories || []).join(', ').slice(0, 34).padEnd(36)} ${x.r.reason}`;

console.log(`\n═══ KEPT (${kept.length}/${seen.length}) ═══`);
kept.forEach((x) => console.log(row(x)));
console.log(`\n═══ DROPPED (${dropped.length}/${seen.length}) ═══`);
dropped.forEach((x) => console.log(row(x)));

console.log(`\nniche terms   : ${gate.terms().join(', ')}`);
console.log(`learned niche : ${JSON.stringify(gate.profile())}`);
console.log();

await shutdown();

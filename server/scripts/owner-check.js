// Live owner-resolution diagnostic. Runs the real chain (Hunter -> search
// engines -> company website) against a handful of businesses, without touching
// the Ad Library, so the enrichment can be tested in seconds instead of via a
// full harvest.
//
//   npm run owner:check
//   npm run owner:check -- "Bright Smile Dental" US https://example.com

import { db } from '../src/db.js';
import { hunter } from '../src/enrich/hunter.js';
import { resolveOwner } from '../src/enrich/ownerResolver.js';
import { newPage, shutdown } from '../src/scraper/engine.js';

const argv = process.argv.slice(2);

// Real businesses with a publicly stated owner, so a correct run is verifiable.
const SAMPLES = argv.length
  ? [{ page_name: argv[0], country: argv[1] || 'US', contact_website: argv[2] || null }]
  : [
      { page_name: 'Basecamp', country: 'US', contact_website: 'https://basecamp.com' },
      { page_name: 'Patagonia', country: 'US', contact_website: 'https://www.patagonia.com' },
      { page_name: 'Ben & Jerry\'s', country: 'US', contact_website: 'https://www.benjerry.com' },
    ];

const COUNTRY_NAME = { US: 'United States', GB: 'United Kingdom', AE: 'United Arab Emirates', NL: 'Netherlands' };

await db.init();
await hunter.preflight();
console.log(`\nHunter: ${hunter.enabled ? 'active' : `disabled (${hunter.disabledReason || 'no key'})`}\n`);

const page = await newPage();
try {
  for (const biz of SAMPLES) {
    const started = Date.now();
    const patch = await resolveOwner(page, biz, {
      countryCode: biz.country,
      countryName: COUNTRY_NAME[biz.country] || biz.country,
      log: (m) => console.log(`    · ${m}`),
    });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`── ${biz.page_name}  (${secs}s)`);
    console.log(`   status      ${patch.owner_status}`);
    console.log(`   owner       ${patch.owner_name || '—'}${patch.owner_title ? ` (${patch.owner_title})` : ''}`);
    console.log(`   source      ${patch.owner_source || '—'}   confidence ${patch.owner_confidence ?? '—'}`);
    if (patch.owner_email) console.log(`   owner email ${patch.owner_email}`);
    if (patch.company_domain) console.log(`   domain      ${patch.company_domain} (${patch.company_domain_source})`);
    console.log();
  }
} finally {
  await page.close().catch(() => {});
  await shutdown();
}

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

// Real advertisers harvested from the Ad Library. Deliberately small local
// businesses rather than global brands: brand names like "Basecamp" are shared
// by many companies, so they measure name ambiguity rather than lookup quality.
const SAMPLES = argv.length
  ? [{ page_name: argv[0], country: argv[1] || 'US', contact_website: argv[2] || null }]
  : [
      { page_name: 'Knight Pediatric Dentistry', country: 'US', contact_website: null },
      { page_name: 'Joshua M. Millsaps, DDS, PA', country: 'US', contact_website: 'http://millsapsdentistry.com/' },
      { page_name: 'Hetrick Family Dentistry', country: 'US', contact_website: 'https://www.hetrickfamilydentistry.com/' },
      { page_name: 'Seaside Dental of Jacksonville Beach', country: 'US', contact_website: 'https://www.seasidedentaljax.com/' },
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

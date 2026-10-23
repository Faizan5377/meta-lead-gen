// No duplicate leads — within a run, and against everything collected before.
//
// Business-level dedup is by Facebook page, which is not the same as by
// company. A live export carried ~20 "Service Experts" franchise pages and a
// dozen "Aire Serv of …", each a separate advertiser, all pointing at one
// domain. Without this, Hunter is paid once per page and returns the same
// person every time.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DROP, enrichLeads } from '../src/enrich/phase.js';

const lead = (name, website) => ({ business_name: name, website });

// Stand-in for Hunter: every domain has one owner, derived from the domain.
const fakeHunter = (calls) => async (domain) => {
  calls.push(domain);
  return {
    people: [{
      email: `owner@${domain}`, first_name: 'A', last_name: 'B',
      position: 'Owner', confidence: 90,
    }],
    charged: true,
  };
};

async function run(leads, opts = {}) {
  const calls = [];
  const res = await enrichLeads(leads, {
    apiKey: 'test', concurrency: 1, lookup: fakeHunter(calls), ...opts,
  });
  return { ...res, calls };
}

describe('one lead per company', () => {
  it('keeps the first franchise page and drops the rest', async () => {
    const { kept, dropped, calls } = await run([
      lead('Service Experts Nashville', 'https://serviceexpertsnow.com/nashville'),
      lead('Service Experts Buffalo', 'https://serviceexpertsnow.com/buffalo'),
      lead('Service Experts Savannah', 'serviceexpertsnow.com'),
    ]);
    assert.equal(kept.length, 1);
    assert.equal(dropped.length, 2);
    assert.ok(dropped.every((d) => d.reason === DROP.DUPLICATE_DOMAIN));
  });

  it('pays for one search, not twenty', async () => {
    const leads = Array.from({ length: 20 }, (_, i) =>
      lead(`Aire Serv of Town ${i}`, 'aireserv.com'));
    const { calls, creditsUsed } = await run(leads);
    assert.equal(calls.length, 1);
    assert.equal(creditsUsed, 1);
  });

  it('still keeps genuinely different companies', async () => {
    const { kept } = await run([
      lead('Bourque Heating', 'bourqueheating.com'),
      lead('Pike Plumbing', 'pikeplumbing.com'),
    ]);
    assert.equal(kept.length, 2);
  });
});

describe('no duplicate of something already collected', () => {
  it('skips a company an earlier run already produced', async () => {
    const { kept, dropped, calls } = await run(
      [lead('Acme Air (new page)', 'acmeair.com')],
      { known: { domains: new Set(['acmeair.com']), emails: new Set() } },
    );
    assert.equal(kept.length, 0);
    assert.equal(dropped[0].reason, DROP.DUPLICATE_DOMAIN);
    assert.equal(calls.length, 0, 'must not spend a credit on a known company');
  });

  it('skips a person an earlier run already produced, under a new domain', async () => {
    // Acquired brands: different site, same human.
    const { kept, dropped } = await run(
      [lead('Acme Air', 'acme-air-hvac.com')],
      { known: { domains: new Set(), emails: new Set(['owner@acme-air-hvac.com']) } },
    );
    assert.equal(kept.length, 0);
    assert.equal(dropped[0].reason, DROP.DUPLICATE_EMAIL);
  });

  it('is unaffected when nothing was collected before', async () => {
    const { kept } = await run([lead('Acme Air', 'acmeair.com')], { known: null });
    assert.equal(kept.length, 1);
  });
});

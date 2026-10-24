// What the target counts.
//
// It counts FINISHED leads — verified on Google and carrying a decision maker —
// not advertisers pulled off the feed. "150 leads" has meant both things in this
// project's history, and the difference is the whole run: a measured HVAC funnel
// turned 150 advertisers into 17 leads, so a target read as "advertisers to
// collect" silently delivers a ninth of what was asked for.
//
// The harvest therefore has to be free to admit far more candidates than the
// target, and the run still has to be incapable of returning more leads than it.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { config } from '../src/config.js';
import { store } from '../src/store.js';

const ad = (i) => ({
  library_id: `lib${i}`,
  page_id: `page${i}`,
  page_name: `Business ${i}`,
  page_url: `https://facebook.com/biz${i}`,
  keyword: 'dentist',
  is_active: true,
  start_date: '2026-01-01',
  days_running: 100,
});

// A run shaped like the real one: Maps verification on, contacts required.
const newRun = (target) => {
  const run = store.create({ target, keywords: ['dentist'], countries: ['US'], verifyOnMaps: true });
  run.contactsRequired = true;
  return run;
};

const finish = (run, b, email) => {
  b.verify_status = 'kept';
  b.contact_status = 'kept';
  b.owner_email = email;
  store.recount(run);
};

describe('the target counts finished leads, not advertisers', () => {
  it('admits far more candidates than the target, because most will not finish', () => {
    const run = newRun(3);
    const statuses = [];
    for (let i = 0; i < 25; i++) statuses.push(store.considerAd(run, ad(i)).status);

    assert.equal(statuses.filter((s) => s === 'added').length, 25);
    assert.equal(run.counts.harvested, 25);
    // …and none of them is a lead yet.
    assert.equal(run.counts.kept, 0);
    assert.equal(store.keptBusinesses(run).length, 0);
  });

  it('counts a candidate only once it has cleared BOTH gates', () => {
    const run = newRun(3);
    const a = store.considerAd(run, ad(1)).business;
    const b = store.considerAd(run, ad(2)).business;

    a.verify_status = 'kept';                 // Google said yes…
    assert.equal(store.recount(run), 0);      // …but there is nobody to email

    b.owner_email = 'dan@b.com';              // an email without a listing…
    b.verify_status = 'pending';
    assert.equal(store.recount(run), 0);      // …is not a verified lead

    finish(run, a, 'ann@a.com');
    assert.equal(run.counts.kept, 1);
  });

  it('stops admitting at the candidate ceiling, not at the target', () => {
    const run = newRun(2);
    assert.equal(run.candidateCeiling, Math.max(500, 2 * config.candidatesPerLead));

    let res;
    for (let i = 0; i < run.candidateCeiling + 5; i++) res = store.considerAd(run, ad(i));

    assert.equal(run.counts.harvested, run.candidateCeiling);
    assert.equal(res.status, 'skipped');
    assert.equal(res.atCeiling, true);
  });

  it('still updates a business already kept once the ceiling is reached', () => {
    const run = newRun(1);
    run.candidateCeiling = 1;
    store.considerAd(run, ad(1));
    // Same business, different keyword — must still record the extra keyword
    // even though no new candidate can be admitted.
    const res = store.considerAd(run, { ...ad(1), library_id: 'lib1b', keyword: 'implants' });
    assert.equal(res.status, 'updated');
    assert.deepEqual(run.businesses[0].keywords, ['dentist', 'implants']);
    assert.equal(run.businesses.length, 1);
  });

  it('keeps fewer than the target when supply runs out', () => {
    const run = newRun(10);
    for (let i = 0; i < 4; i++) store.considerAd(run, ad(i));
    assert.equal(run.counts.harvested, 4);
    assert.equal(run.counts.kept, 0);
  });
});

describe('leads that die on the way out', () => {
  it('drops a lead with no decision maker and names why, grouped', () => {
    const run = newRun(5);
    const a = store.considerAd(run, ad(1)).business;
    const b = store.considerAd(run, ad(2)).business;
    a.verify_status = 'kept';
    b.verify_status = 'kept';

    store.dropContact(run, a, 'Hunter found nobody at this domain');
    store.dropContact(run, b, 'Hunter found nobody at this domain');

    assert.equal(run.businesses.length, 0);
    assert.equal(run.counts.skippedNoContact, 2);
    // Grouped on the wording, so the summary points at the cause.
    assert.equal(run.contactDrops.get('Hunter found nobody at this domain'), 2);
    // And never offered again this run — a second lookup buys the same answer.
    assert.ok(run.rejectedKeys.has(a.business_key));
  });

  it('collapses error wording so one tally is not fifty distinct strings', () => {
    const run = newRun(5);
    for (const i of [1, 2]) {
      const b = store.considerAd(run, ad(i)).business;
      b.verify_status = 'kept';
      store.dropContact(run, b, `lookup failed: timeout after ${i}s`);
    }
    assert.equal(run.contactDrops.get('lookup failed'), 2);
  });

  it('purges everything still unfinished when the run ends', () => {
    const run = newRun(2);
    const done = store.considerAd(run, ad(1)).business;
    const verifiedOnly = store.considerAd(run, ad(2)).business;
    store.considerAd(run, ad(3));             // never even checked

    finish(run, done, 'ann@a.com');
    verifiedOnly.verify_status = 'kept';

    assert.equal(store.purgeIncomplete(run), 2);
    assert.deepEqual(run.businesses, [done]);
    assert.equal(run.counts.kept, 1);
  });

});

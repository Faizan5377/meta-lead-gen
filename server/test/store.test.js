// The run target is a hard ceiling: a run must never return more businesses
// than were asked for. Fewer is allowed only when the Ad Library runs out.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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

describe('run target is a hard ceiling', () => {
  it('never keeps more businesses than the target', () => {
    const run = store.create({ target: 3, keywords: ['dentist'], countries: ['US'] });
    const statuses = [];
    for (let i = 0; i < 25; i++) statuses.push(store.considerAd(run, ad(i)).status);

    assert.equal(run.businesses.length, 3);
    assert.equal(run.counts.kept, 3);
    assert.equal(statuses.filter((s) => s === 'added').length, 3);
    // Everything past the target is skipped, not kept.
    assert.ok(statuses.slice(3).every((s) => s === 'skipped'));
  });

  it('flags over-target skips distinctly from duplicates', () => {
    const run = store.create({ target: 1, keywords: ['dentist'], countries: ['US'] });
    store.considerAd(run, ad(1));
    const res = store.considerAd(run, ad(2));
    assert.equal(res.status, 'skipped');
    assert.equal(res.atTarget, true);
  });

  it('still updates a business already kept once at the target', () => {
    const run = store.create({ target: 1, keywords: ['dentist'], countries: ['US'] });
    store.considerAd(run, ad(1));
    // Same business, different keyword — must still record the extra keyword
    // even though the run is full.
    const res = store.considerAd(run, { ...ad(1), library_id: 'lib1b', keyword: 'implants' });
    assert.equal(res.status, 'updated');
    assert.deepEqual(run.businesses[0].keywords, ['dentist', 'implants']);
    assert.equal(run.businesses.length, 1);
  });

  it('keeps fewer than the target when supply runs out', () => {
    const run = store.create({ target: 10, keywords: ['dentist'], countries: ['US'] });
    for (let i = 0; i < 4; i++) store.considerAd(run, ad(i));
    assert.equal(run.businesses.length, 4);
  });
});

// Lead-quality gate. Every rejection must carry a reason, and the defaults
// must let everything through — a filter you didn't ask for is a bug.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_QUALITY, isActive, judge, normalizeQuality, termList } from '../src/maps/quality.js';

const place = (o = {}) => ({
  name: 'Acme Plumbing', category: 'Plumber', categories: ['Plumber'],
  rating: 4.5, review_count: 200, phone: '(555) 123-4567',
  website: 'https://acme.com', open_state: 'Open · Closes 5 PM', ...o,
});

describe('defaults', () => {
  it('keep everything when nothing is configured', () => {
    assert.equal(judge(place(), DEFAULT_QUALITY).keep, true);
    assert.equal(judge(place({ phone: null, website: null, rating: null, review_count: null }), DEFAULT_QUALITY).keep, true);
    assert.equal(isActive(DEFAULT_QUALITY), false);
  });
});

describe('phone and website modes', () => {
  it('required drops the ones missing it', () => {
    const q = normalizeQuality({ phone: 'required', website: 'required' });
    assert.equal(judge(place({ phone: null }), q).reason, 'no phone');
    assert.equal(judge(place({ website: null }), q).reason, 'no website');
    assert.equal(judge(place(), q).keep, true);
  });

  it('"none" finds businesses WITHOUT one — the website-selling case', () => {
    const q = normalizeQuality({ website: 'none' });
    assert.equal(judge(place(), q).reason, 'has a website');
    assert.equal(judge(place({ website: null }), q).keep, true);
  });

  it('still honours the older requirePhone/requireWebsite booleans', () => {
    const q = normalizeQuality({ requirePhone: true, requireWebsite: true });
    assert.equal(q.phone, 'required');
    assert.equal(q.website, 'required');
  });
});

describe('rating and review ranges', () => {
  it('filters on a minimum', () => {
    const q = normalizeQuality({ minRating: 4.5, minReviews: 100 });
    assert.equal(judge(place({ rating: 4.2 }), q).keep, false);
    assert.equal(judge(place({ review_count: 20 }), q).keep, false);
    assert.equal(judge(place(), q).keep, true);
  });

  it('filters on a maximum — smaller businesses are often better prospects', () => {
    const q = normalizeQuality({ maxRating: 4.0, maxReviews: 50 });
    assert.equal(judge(place({ rating: 4.8 }), q).keep, false);
    assert.equal(judge(place({ review_count: 500 }), q).keep, false);
    assert.equal(judge(place({ rating: 3.5, review_count: 20 }), q).keep, true);
  });

  it('can exclude places with no rating yet', () => {
    assert.equal(judge(place({ rating: null }), normalizeQuality({ unratedOk: false })).reason, 'not rated yet');
    assert.equal(judge(place({ rating: null }), normalizeQuality({})).keep, true);
  });
});

describe('name and category filters', () => {
  it('excludes chains by name', () => {
    const q = normalizeQuality({ excludeNames: 'roto-rooter, mr. electric' });
    assert.equal(judge(place({ name: 'Roto-Rooter Plumbing' }), q).reason, 'name excluded');
    assert.equal(judge(place(), q).keep, true);
  });

  it('excludes unwanted categories', () => {
    const q = normalizeQuality({ excludeCategories: 'hardware store' });
    assert.equal(judge(place({ categories: ['Plumber', 'Hardware store'] }), q).reason, 'category excluded');
  });

  it('restricts to an allow-list when one is given', () => {
    const q = normalizeQuality({ onlyCategories: 'plumber' });
    assert.equal(judge(place(), q).keep, true);
    assert.equal(judge(place({ category: 'Electrician', categories: ['Electrician'] }), q).reason, 'category not in list');
  });
});

describe('open now', () => {
  it('keeps only currently-open places', () => {
    const q = normalizeQuality({ openNow: true });
    assert.equal(judge(place(), q).keep, true);
    assert.equal(judge(place({ open_state: 'Closed · Opens 8 AM' }), q).reason, 'closed now');
  });
});

describe('termList', () => {
  it('splits and lowercases, ignoring blanks', () => {
    assert.deepEqual(termList('Roto-Rooter, ARS ;\n Mr. Rooter'), ['roto-rooter', 'ars', 'mr. rooter']);
    assert.deepEqual(termList(''), []);
    assert.deepEqual(termList(undefined), []);
  });
});

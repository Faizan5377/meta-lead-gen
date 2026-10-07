// The category census.
//
// Fixture counts are the real distribution from a live Maps census of "HVAC"
// (119 businesses), so these tests fail if the vote rule stops matching how
// Google actually spreads categories across a trade.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { censusCategories } from '../src/verify/niche.js';

const sample = (counts) => Object.entries(counts)
  .flatMap(([category, n]) => Array.from({ length: n }, () => ({ category })));

const HVAC = {
  'HVAC contractor': 105,
  'Air conditioning contractor': 8,
  'Heating contractor': 4,
  'Air conditioning repair service': 1,
  'Mechanical contractor': 1,
};

describe('censusCategories', () => {
  it('learns the trade, commonest first, lowercased', () => {
    assert.deepEqual(censusCategories(sample(HVAC)),
      ['hvac contractor', 'air conditioning contractor', 'heating contractor']);
  });

  it('keeps the long tail that genuine contractors sit in', () => {
    // "Heating contractor" is only 4 of 119 — furnace-led northern businesses.
    // Losing it would quietly drop a real slice of the market.
    assert.ok(censusCategories(sample(HVAC)).includes('heating contractor'));
  });

  it('excludes the adjacent trade that appeared once', () => {
    assert.ok(!censusCategories(sample(HVAC)).includes('mechanical contractor'));
  });

  it('needs two businesses before a category counts', () => {
    assert.deepEqual(censusCategories(sample({ 'Plumber': 1, 'Technical school': 1 })), []);
    assert.deepEqual(censusCategories(sample({ 'Plumber': 2 })), ['plumber']);
  });

  it('caps the list so a vague keyword cannot allow everything', () => {
    const many = {};
    for (let i = 0; i < 30; i++) many[`Trade ${i}`] = 2;
    assert.equal(censusCategories(sample(many)).length, 10);
  });

  it('survives places with no category and an empty census', () => {
    assert.deepEqual(censusCategories([{ category: null }, { category: '  ' }, {}]), []);
    assert.deepEqual(censusCategories([]), []);
  });
});

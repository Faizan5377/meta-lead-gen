// Advice when a run finishes short.
//
// Google's supply for one search is finite, so stopping short is not a failure
// — but finishing at 9 of 100 with no explanation is indistinguishable from a
// bug. The notice has to name the lever worth pulling, and it must be the one
// that actually cost the most.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adviseOnShortfall } from '../src/maps/orchestrator.js';

const run = ({
  kept = 9, filtered = 0, known = 0, reasons = {}, filters = {},
  harvested = 0, ceiling = 5000, noContact = 0, credits = 0, drops = {},
} = {}) => ({
  id: 'test-run', target: 100, candidateCeiling: ceiling,
  counts: {
    found: kept + filtered + known, kept, harvested,
    skippedKnown: known, skippedFiltered: filtered,
    skippedNoContact: noContact, creditsUsed: credits,
  },
  rejectReasons: new Map(Object.entries(reasons)),
  contactDrops: new Map(Object.entries(drops)),
  filters: { autoExpand: true, expandRing: 2, ...filters },
  errors: [],
});

// The notice is pushed onto the run as well as emitted, so read it back there.
function advise(r, contacts) {
  adviseOnShortfall(r, contacts);
  return r.errors.at(-1);
}

describe('adviseOnShortfall', () => {
  it('always says where it got to, and files itself as a notice not an error', () => {
    const note = advise(run({ kept: 9 }));
    assert.match(note.message, /finished with 9 of 100/);
    assert.equal(note.kind, 'notice');
    assert.equal(note.scope, 'shortfall');
  });

  it('names the wall it hit, because a short list has several explanations', () => {
    // Out of credits is a different problem from a thin niche, and the fix is
    // different too — saying "Google had no more results" when the real cause
    // was the credit cap sends you widening a search that was working.
    assert.match(
      advise(run({ kept: 40, credits: 400 }), { exhausted: true }).message,
      /Hunter credit cap \(400 searches\)/,
    );
    assert.match(
      advise(run({ kept: 12, harvested: 5000, ceiling: 5000 })).message,
      /5000 places were checked without finding enough decision makers/,
    );
    assert.match(advise(run({ kept: 9 })).message, /Google had no more results/);
  });

  it('blames the contact lookup when that is what ate the list', () => {
    const note = advise(run({
      kept: 9, noContact: 220,
      drops: { 'Hunter found nobody at this domain': 190, 'no usable website': 30 },
    }));
    assert.match(note.message, /220 places had no decision maker/);
    assert.match(note.message, /Hunter found nobody at this domain/);
    assert.ok(!/mostly “no usable website”/.test(note.message));
  });

  it('names the filter that cost the most, not just the total', () => {
    const note = advise(run({
      kept: 9,
      filtered: 300,
      reasons: { 'N reviews < N': 240, 'no website': 45, 'rating N < N': 15 },
    }));
    assert.match(note.message, /300 were dropped/);
    assert.match(note.message, /reviews < N/);
    assert.match(note.message, /\(240\)/);
    // The runner-up must not be the one blamed.
    assert.ok(!/mostly “no website”/.test(note.message));
  });

  it('stays quiet about filters that barely fired', () => {
    const note = advise(run({ kept: 40, filtered: 3, reasons: { 'no phone': 3 } }));
    assert.ok(!/dropped by your quality gates/.test(note.message));
  });

  it('mentions the library only when it really ate the results', () => {
    assert.match(advise(run({ kept: 5, known: 80 })).message, /80 were already in your library/);
    assert.ok(!/already in your library/.test(advise(run({ kept: 50, known: 2 })).message));
  });

  it('points at widening first when widening is switched off', () => {
    const note = advise(run({ filters: { autoExpand: false } }));
    assert.match(note.message, /widen the search/i);
  });

  it('suggests going further out while there is further to go', () => {
    assert.match(advise(run({ filters: { expandRing: 1 } })).message, /further out/);
    // At the widest setting, geography is exhausted — more terms is all that's left.
    const widest = advise(run({ filters: { expandRing: 3 } })).message;
    assert.ok(!/further out/.test(widest));
    assert.match(widest, /more search terms/);
  });
});
